/**
 * Arena — Full-screen battle page
 *
 * Player-initiated combat: pick a monster from the grid, fight it.
 * Other players arriving mid-fight see the active encounter and can join.
 */

import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useEncounterEvents } from '../components/EncounterBanner';
import '../styles/arena.css';
import RollResultOverlay from '../components/RollResultOverlay';
import AchievementToast from '../components/AchievementToast';
import QuestToast from '../components/QuestToast';
import LevelUpOverlay from '../components/LevelUpOverlay';
import { useUiSounds } from '../hooks/useUiSounds';
import { useArenaSounds, clearArenaBuffers } from '../hooks/useArenaSounds';
import SceneAudio from './scenes/SceneAudio';
import { reportMetric } from '../lib/memoryTracker';

const DiceOverlay = lazy(() => import('../components/DiceOverlay'));
import EmotePopup from '../components/EmotePopup';
import ArenaEmoteGrid from '../components/ArenaEmoteGrid';
import DmRollControl from '../components/DmRollControl';
import FateOverlay from '../components/FateOverlay';
import { clearDiceBuffers, preloadDiceSounds } from '../lib/diceAudio';
import { createLogger } from '../utils/debug';

const logArena = createLogger('arena');
const logWs = createLogger('ws');

const EMOTE_SOUND_MAP = {
  crying: 'emoteCrying',
  party_face: 'emoteParty',
  screaming: 'emoteScream',
  ember_laugh: 'emoteGoblinLaugh',
};

const CONCENTRATION_SPELL_NAMES = {
  hunters_mark: "Hunter's Mark",
  ensnaring_strike: 'Ensnaring Strike',
};

// ── Confetti canvas for victory screen (same effect as arena location transition) ──
const CONFETTI_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff',
];

function VictoryConfetti() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Cap DPR at 2 to avoid huge canvases on 3x iOS devices
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const startTime = Date.now();
    const RAIN_DURATION = 30000; // confetti rains for 30s, then stops spawning
    let draining = false;

    particlesRef.current = Array.from({ length: 60 }, () => ({
      x: Math.random() * w,
      y: Math.random() * -h,
      width: Math.random() * 10 + 8,
      height: Math.random() * 6 + 4,
      speedY: Math.random() * 2 + 1.5,
      wobbleSpeed: Math.random() * 0.06 + 0.03,
      wobbleAmp: Math.random() * 40 + 20,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.12,
      flipPhase: Math.random() * Math.PI * 2,
      flipSpeed: Math.random() * 0.08 + 0.04,
      life: Math.random() * Math.PI * 2,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      opacity: Math.random() * 0.3 + 0.7,
      dead: false,
    }));

    function animate() {
      if (!draining && Date.now() - startTime > RAIN_DURATION) draining = true;

      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of particlesRef.current) {
        if (p.dead) continue;
        p.life += p.wobbleSpeed;
        p.x += Math.sin(p.life) * p.wobbleAmp * 0.02;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;
        p.flipPhase += p.flipSpeed;
        if (p.y > h + 20) {
          if (draining) { p.dead = true; continue; }
          p.y = -10; p.x = Math.random() * w;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(Math.cos(p.flipPhase), 1);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        ctx.restore();
        alive++;
      }
      // All confetti has fallen off — release canvas memory and stop
      if (draining && alive === 0) {
        canvas.width = 0;
        canvas.height = 0;
        animRef.current = null;
        return;
      }
      animRef.current = requestAnimationFrame(animate);
    }
    animate();
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      // Release canvas memory on unmount
      canvas.width = 0;
      canvas.height = 0;
    };
  }, []);

  return <canvas ref={canvasRef} className="arena-victory-confetti" />;
}

const ARENA_AUDIO_CONFIGS = {
  crowd: { ambient: [{ src: '/sounds/arena/crowd-ambient.mp3', volume: 0.4 }] },
  battle: { music: { src: '/sounds/arena/battle-music.mp3', volume: 0.15 } },
  battleIntense: { music: { src: '/sounds/arena/battle-music-intense.mp3', volume: 0.22 } },
  victory: { music: { src: '/sounds/arena/victory.mp3', volume: 0.4 } },
  defeat: { music: { src: '/sounds/arena/defeat.mp3', volume: 0.35 } },
};

export default function Arena() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const playSound = useUiSounds();
  const playArenaSound = useArenaSounds();
  const playArenaSoundRef = useRef(playArenaSound);
  playArenaSoundRef.current = playArenaSound;
  const locationId = 'the_arena';

  // Free arena + dice audio buffers when leaving the arena.
  // These are module-level singletons that persist across mounts —
  // without cleanup they accumulate ~35MB of decoded AudioBuffers.
  // On mount, re-preload dice sounds (they may have been cleared on previous exit).
  useEffect(() => {
    preloadDiceSounds();
    return () => {
      clearArenaBuffers();
      clearDiceBuffers();
    };
  }, []);

  // Monster selection state
  const [monsters, setMonsters] = useState(null);
  const [spawning, setSpawning] = useState(null); // monsterId being spawned
  const [selectedMonster, setSelectedMonster] = useState(null);

  // Encounter state via shared hook
  const {
    encounter: activeEncounter,
    setEncounter: setActiveEncounter,
    encounterMap,
    initEncounterMap,
    resultScreen: encounterResult,
    clearResult: clearEncounterResult,
    narrations: encounterNarrations,
    handleEncounterEvent,
    monsterRollRequest,
    clearMonsterRollRequest,
    monsterSaveRequest,
    clearMonsterSaveRequest,
    monsterEscapeRequest,
    clearMonsterEscapeRequest,
    conSaveRequest,
    clearConSaveRequest,
    initiativeResults,
    setInitiativeResults,
    currentTurn,
    setCurrentTurn,
  } = useEncounterEvents(locationId, user?.id);

  // Combat UI state
  const [actionChosen, setActionChosen] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [joining, setJoining] = useState(false);
  const [rollPhase, setRollPhase] = useState(null);
  const [attackResult, setAttackResult] = useState(null);
  const [monsterRollStatus, setMonsterRollStatus] = useState(null);
  const [actionTooltip, setActionTooltip] = useState(null);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  const tooltipTimerRef = useRef(null);
  const timerRef = useRef(null);
  const timerPauseStartRef = useRef(null);
  const timerPauseOffsetRef = useRef(0);
  const rollActiveRef = useRef(false);
  const monsterRollActiveRef = useRef(false);
  const monsterSaveActiveRef = useRef(false);
  const monsterEscapeActiveRef = useRef(false);
  const conSaveActiveRef = useRef(false);
  const combatLogRef = useRef(null);
  const [logOpen, setLogOpen] = useState(false);
  const [turnAnnouncement, setTurnAnnouncement] = useState(null);
  const turnAnnouncementTimer = useRef(null);
  const lastAnnouncedTurnRef = useRef(null);
  const [bonusResultBanner, setBonusResultBanner] = useState(null);
  const bonusResultTimerRef = useRef(null);
  const [monsterSkipBanner, setMonsterSkipBanner] = useState(null);
  const monsterSkipTimerRef = useRef(null);

  // Dice cosmetic state ('default' maps to 'white' for dice-box library)
  const [myDiceColorset, setMyDiceColorset] = useState('white');

  // Potion system state
  const [potions, setPotions] = useState([]);
  const [potionModalOpen, setPotionModalOpen] = useState(false);
  const [potionTargetModal, setPotionTargetModal] = useState(null); // { potion, targets }
  const [helpTargetModal, setHelpTargetModal] = useState(false);
  // Divine Smite, Bardic Inspiration & Lay on Hands
  const [smitePrompt, setSmitePrompt] = useState(null); // { slots, monsterType, isNat20, resolve }
  const [inspirationPrompt, setInspirationPrompt] = useState(null); // { die, total, ac, resolve }
  const [lohModalOpen, setLohModalOpen] = useState(false); // target + amount modal
  const [lohTarget, setLohTarget] = useState(null); // selected target in LoH modal
  // Bonus action state
  const [bonusActionPhase, setBonusActionPhase] = useState(false);
  const [availableBonusActions, setAvailableBonusActions] = useState([]);
  const [inspirationTargetModal, setInspirationTargetModal] = useState(false);
  const [lohAmount, setLohAmount] = useState(1);
  // Spell casting state
  const [spellModalOpen, setSpellModalOpen] = useState(false);
  const [availableSpells, setAvailableSpells] = useState([]);
  const [castingSpell, setCastingSpell] = useState(null);
  const [healingWordTargetModal, setHealingWordTargetModal] = useState(false);
  const [healSpellTargetModal, setHealSpellTargetModal] = useState(null);
  const [vineEffect, setVineEffect] = useState(false);
  // Stunning Strike toggle (Monk)
  const [stunningStrikeToggle, setStunningStrikeToggle] = useState(false);
  // Ensnaring Strike toggle (Ranger — client-side until attack resolves)
  const [ensnaringStrikeToggle, setEnsnaringStrikeToggle] = useState(false);
  const ensnaringStrikeToggleRef = useRef(false);
  useEffect(() => { ensnaringStrikeToggleRef.current = ensnaringStrikeToggle; }, [ensnaringStrikeToggle]);
  // Concentration conflict confirmation
  const [concentrationConflict, setConcentrationConflict] = useState(null);
  // Weapon picker state
  const [weaponModalOpen, setWeaponModalOpen] = useState(false);
  const [availableWeapons, setAvailableWeapons] = useState([]);

  // Initiative state
  const [myInitRoll, setMyInitRoll] = useState(null);
  const initiativeRollRef = useRef(false);
  const [pendingJoinEncounterId, setPendingJoinEncounterId] = useState(null);
  const [myDexMod, setMyDexMod] = useState(0);

  // DM Roll Control ("Fate's Hand") state
  const isDM = user?.isDM || false;
  const [dmRollControlEnabled, setDmRollControlEnabled] = useState(false);
  const [dmPendingRoll, setDmPendingRoll] = useState(null);
  const [fateOverlayVisible, setFateOverlayVisible] = useState(false);

  // Admin sprite editor state
  const ADMIN_IDS = ['424061511833747467'];
  const isAdmin = ADMIN_IDS.includes(user?.id || '');
  const [editMode, setEditMode] = useState(false);
  const [editSpriteSettings, setEditSpriteSettings] = useState(null);
  const [editArenaConfig, setEditArenaConfig] = useState(null);
  const [arenaConfig, setArenaConfig] = useState({ playerTileSize: 160, playerTileGap: 10, playerOffsetY: 0 });
  const [editSaving, setEditSaving] = useState(false);

  // Viewport scale — all sprite pixel values scale relative to a reference height
  const REFERENCE_HEIGHT = 850;
  const [viewScale, setViewScale] = useState(() => window.innerHeight / REFERENCE_HEIGHT);
  useEffect(() => {
    const update = () => setViewScale(window.innerHeight / REFERENCE_HEIGHT);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Dice overlay state
  const [diceRoll, setDiceRoll] = useState(null);
  const diceRollRef = useRef(null);
  diceRollRef.current = diceRoll;
  const encounterDiceRef = useRef(null);
  const diceRollKeyRef = useRef(0);

  // Spectator dice queue (3D dice overlay for other players' rolls)
  const spectatorQueueRef = useRef([]);
  const [spectatorRoll, setSpectatorRoll] = useState(null);
  const spectatorRollRef = useRef(null);
  spectatorRollRef.current = spectatorRoll;
  const [queueTick, setQueueTick] = useState(0);

  // Roll result overlay (promise-based: show data, resolve on dismiss)
  const [rollResultOverlay, setRollResultOverlay] = useState(null);
  const rollResultResolveRef = useRef(null);
  const rollResultOverlayRef = useRef(null);
  rollResultOverlayRef.current = rollResultOverlay;

  // Emote state
  const [activeEmotes, setActiveEmotes] = useState([]);
  const [emoteGridOpen, setEmoteGridOpen] = useState(false);
  const [emoteCatalog, setEmoteCatalog] = useState([]);
  const [favoriteEmotes, setFavoriteEmotes] = useState([]);
  const emoteCooldownRef = useRef(false);

  // ── Memory tracking ──
  useEffect(() => {
    reportMetric('arena.emotes', activeEmotes.length);
  }, [activeEmotes.length]);

  // Hide result screen while dice are still animating
  const showResult = encounterResult && !diceRoll && !spectatorRoll;

  // Once the result screen is showing (dice done), release the encounter data
  // and free combat audio buffers — the result screen only needs victory/defeat music.
  // This prevents the ~35MB of arena SFX + dice buffers from competing with the
  // confetti canvas + achievement overlays for memory on iPhones.
  // Delay buffer cleanup by 4s so victory/defeat stings finish playing first.
  useEffect(() => {
    if (!showResult) return;
    setActiveEncounter(null);
    spectatorQueueRef.current = [];
    const timer = setTimeout(() => {
      clearArenaBuffers();
      clearDiceBuffers();
    }, 4000);
    return () => clearTimeout(timer);
  }, [showResult]);

  // Achievement toast queue
  const [achievementQueue, setAchievementQueue] = useState([]);
  const dismissAchievement = useCallback(() => {
    setAchievementQueue(prev => prev.slice(1));
  }, []);

  // Quest completion toast queue
  const [questQueue, setQuestQueue] = useState([]);
  const dismissQuest = useCallback(() => {
    setQuestQueue(prev => prev.slice(1));
  }, []);

  // Level-up overlay state
  const [levelUp, setLevelUp] = useState(null);

  // Queue only this player's achievements when result screen appears
  useEffect(() => {
    if (!encounterResult?.achievements || !user?.id) return;
    const myAchs = encounterResult.achievements[user.id];
    if (myAchs?.length > 0) setAchievementQueue(myAchs);
  }, [encounterResult?.achievements, user?.id]);

  // Queue this player's completed arena daily goals
  useEffect(() => {
    if (!encounterResult?.completedGoals || !user?.id) return;
    const myGoals = encounterResult.completedGoals[user.id];
    if (myGoals?.length > 0) setQuestQueue(myGoals);
  }, [encounterResult?.completedGoals, user?.id]);

  // Extract level-up from encounter rewards for this player
  useEffect(() => {
    if (!encounterResult?.rewards || !user?.id) return;
    const myReward = encounterResult.rewards[user.id];
    if (myReward?.levelUp?.newLevel) {
      setLevelUp(prev => Math.max(prev || 0, myReward.levelUp.newLevel));
    }
  }, [encounterResult?.rewards, user?.id]);

  // Play victory/defeat sting when result appears
  useEffect(() => {
    if (!encounterResult) return;
    if (encounterResult.type === 'victory') {
      playArenaSoundRef.current('crowdCheer');
      playArenaSoundRef.current('youWin');
    } else {
      playArenaSoundRef.current('defeatSting');
      playArenaSoundRef.current('crowdGasp');
      playArenaSoundRef.current('youLose');
    }
  }, [encounterResult?.type]);

  // Play crowd cheer when the match starts (initiative → action phase)
  const prevPhaseRef = useRef(null);
  useEffect(() => {
    const phase = activeEncounter?.phase;
    if (prevPhaseRef.current === 'initiative_rolling' && phase === 'action') {
      playArenaSoundRef.current('crowdCheer');
    }
    prevPhaseRef.current = phase || null;
  }, [activeEncounter?.phase]);

  // Join overlay: fetched encounter details (participants with avatars)
  const [overlayEncounter, setOverlayEncounter] = useState(null);

  // Presence
  const [presence, setPresence] = useState([]);

  // ── Fetch encounter details when overlay opens for an active fight ──
  useEffect(() => {
    if (!selectedMonster) { setOverlayEncounter(null); return; }
    const activeFight = encounterMap[selectedMonster.id];
    if (!activeFight?.encounterId) { setOverlayEncounter(null); return; }
    api(`/api/encounters/active/${locationId}`).then(data => {
      const enc = (data.encounters || []).find(e => e.id === activeFight.encounterId);
      setOverlayEncounter(enc || null);
    }).catch(() => setOverlayEncounter(null));
  }, [selectedMonster, encounterMap, locationId]);

  // ── Fetch monster list ──
  useEffect(() => {
    api('/api/encounters/monsters/arena')
      .then(data => setMonsters(data.monsters || []))
      .catch(() => setMonsters([]));
    api('/api/admin/arena-config')
      .then(setArenaConfig)
      .catch(() => { });
    // Fetch DEX modifier for initiative display (before joining)
    api('/api/character-sheet/me')
      .then(data => {
        const dex = data.characterSheet?.stats?.find(s => s.abbr === 'DEX');
        setMyDexMod(dex?.modifier || 0);
      })
      .catch(() => { });
    // Fetch equipped dice colorset ('default' → 'white' for dice-box)
    api('/api/dice/equipped')
      .then(data => {
        const cs = data.colorset || 'default';
        setMyDiceColorset(cs === 'default' ? 'white' : cs);
      })
      .catch(() => { });
  }, []);

  // ── Check for active encounters on mount ──
  useEffect(() => {
    api(`/api/encounters/active/${locationId}`).then(data => {
      const encounters = data.encounters || [];
      initEncounterMap(encounters);
      // Restore player's own encounter if they were in one
      const myEnc = encounters.find(e => e.participants?.[user?.id]);
      if (myEnc) setActiveEncounter(myEnc);
    }).catch(() => { });
  }, []);

  // ── Fetch potions when entering an active encounter ──
  useEffect(() => {
    if (!activeEncounter?.id) { setPotions([]); return; }
    api(`/api/encounters/${activeEncounter.id}/potions`)
      .then(data => setPotions(data.potions || []))
      .catch(() => setPotions([]));
  }, [activeEncounter?.id]);

  // ── Fetch emote catalog ──
  useEffect(() => {
    api('/api/emotes/catalog')
      .then(data => setEmoteCatalog(data.emotes || []))
      .catch(() => setEmoteCatalog([]));
  }, []);

  // ── Fetch emote favorites ──
  useEffect(() => {
    api('/api/emotes/favorites')
      .then(data => setFavoriteEmotes(data.favorites || []))
      .catch(() => setFavoriteEmotes([]));
  }, []);

  // ── Resolve favorites to emote objects, fill remaining from catalog defaults ──
  const quickBarEmotes = useMemo(() => {
    if (!emoteCatalog.length) return [];
    const resolved = favoriteEmotes
      .map(id => emoteCatalog.find(e => e.id === id))
      .filter(Boolean);
    if (resolved.length >= 4) return resolved.slice(0, 4);
    const remaining = emoteCatalog.filter(e => !favoriteEmotes.includes(e.id));
    return [...resolved, ...remaining].slice(0, 4);
  }, [emoteCatalog, favoriteEmotes]);

  // ── Toggle emote favorite ──
  const handleToggleFavorite = useCallback(async (emoteId) => {
    try {
      const data = await api('/api/emotes/favorites', {
        method: 'POST',
        body: JSON.stringify({ emoteId }),
      });
      setFavoriteEmotes(data.favorites);
    } catch { }
  }, []);

  // ── WebSocket ──
  // Use refs so the WS effect doesn't reconnect when callbacks change
  const handleEncounterEventRef = useRef(handleEncounterEvent);
  handleEncounterEventRef.current = handleEncounterEvent;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const activeEncounterRef = useRef(activeEncounter);
  activeEncounterRef.current = activeEncounter;
  const pendingJoinRef = useRef(pendingJoinEncounterId);
  pendingJoinRef.current = pendingJoinEncounterId;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '3420' : window.location.port;
    const wsUrl = `${protocol}//${host}${port ? `:${port}` : ''}/ws`;

    let active = true;
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        // Identify this connection for targeted DM broadcasts
        if (userIdRef.current) {
          ws.send(JSON.stringify({ type: 'identify', userId: userIdRef.current, currentLocation: locationId }));
        }
      };
      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.locationId !== locationId) return;
          if (payload.type?.startsWith('encounter_')) {

            try { handleEncounterEventRef.current(payload); } catch (e) { console.error('[Arena WS] handler error:', e); logWs('arena handler error:', e); }
          }
          // Bonus action phase detection — clear main action state so bonus UI shows
          if (payload.type === 'encounter_bonus_phase' && payload.userId === userIdRef.current) {
            setBonusActionPhase(true);
            setAvailableBonusActions(payload.availableBonusActions || []);
            setActionChosen(null);
            setRollPhase(null);
            setAttackResult(null);
            rollActiveRef.current = false;
          }
          if (payload.type === 'encounter_bonus_result' || payload.type === 'encounter_turn_start' || payload.type === 'encounter_turn_skip' || payload.type === 'encounter_monster_turn_skipped') {
            setBonusActionPhase(false);
            setAvailableBonusActions([]);
            setInspirationTargetModal(false);
            setHealingWordTargetModal(false);
            setHealSpellTargetModal(null);
          }
          // Play bardic inspiration sound for other players
          if (payload.type === 'encounter_bonus_result' && payload.result?.type === 'bardic_inspiration' && payload.result?.userId !== userIdRef.current) {
            playArenaSoundRef.current('bardicInspiration');
          }
          // Show brief banner for Patient Defense / Hunter's Mark result
          if (payload.type === 'encounter_bonus_result' && (payload.result?.type === 'patient_defense' || payload.result?.type === 'hunters_mark')) {
            setBonusResultBanner(payload.result);
            if (bonusResultTimerRef.current) clearTimeout(bonusResultTimerRef.current);
            bonusResultTimerRef.current = setTimeout(() => setBonusResultBanner(null), 3000);
          }
          // Show banner when monster turn is skipped (stunned)
          if (payload.type === 'encounter_monster_turn_skipped') {
            // Clear the turn announcement so it doesn't overlap the stun banner
            if (turnAnnouncementTimer.current) clearTimeout(turnAnnouncementTimer.current);
            setTurnAnnouncement(null);
            setMonsterSkipBanner({ monsterName: payload.monsterName, reason: payload.reason });
            if (monsterSkipTimerRef.current) clearTimeout(monsterSkipTimerRef.current);
            monsterSkipTimerRef.current = setTimeout(() => setMonsterSkipBanner(null), 3000);
          }
          // Play ensnaring strike sound + vine animation when monster fails a restraining save
          if (payload.type === 'encounter_turn_result' && payload.result?.ensnaringStrikeResult?.saved === false) {
            playArenaSoundRef.current('ensnaringStrike');
            setVineEffect(true);
          }
          // Play stun sound when stunning strike lands
          if (payload.type === 'encounter_turn_result' && payload.result?.stunningStrikeResult?.saved === false) {
            playArenaSoundRef.current('crowdCheer');
          }
          if (payload.type === 'encounter_turn_result' && payload.result?.subAction === 'natures_wrath' && payload.result?.saved === false) {
            playArenaSoundRef.current('ensnaringStrike');
            setVineEffect(true);
          }
          if (payload.senderId !== userIdRef.current && activeEncounterRef.current?.participants?.[userIdRef.current]) {
            const enc = activeEncounterRef.current;
            const onInitScreen = pendingJoinRef.current || enc?.phase === 'initiative_rolling' || enc?.participants?.[userIdRef.current]?.needsInitiativeRoll;
            if (!onInitScreen) {
              if (payload.type === 'arena_dice_roll') {
                spectatorQueueRef.current.push({ id: Date.now() + Math.random(), ...payload });
                setQueueTick(t => t + 1);
              } else if (payload.type === 'arena_roll_result') {
                spectatorQueueRef.current.push({ id: Date.now() + Math.random(), queueType: 'roll_result', data: payload.resultData });
                setQueueTick(t => t + 1);
              }
            }
          }
          // Emote from another player
          if (payload.type === 'emote' && payload.userId !== userIdRef.current) {
            setActiveEmotes(prev => [...prev, {
              key: Date.now() + Math.random(),
              image: payload.emoteImage,
              characterName: payload.characterName,
              left: 20 + Math.random() * 60,
            }]);
            const emoteSound = EMOTE_SOUND_MAP[payload.emoteId];
            if (emoteSound) playArenaSoundRef.current(emoteSound);
          }
          // DM Roll Control events ("Fate's Hand")
          if (payload.type === 'dm_roll_pending') {
            setDmPendingRoll(payload.pendingRoll);
          }
          if (payload.type === 'fate_deliberation_start') {
            setFateOverlayVisible(true);
          }
          if (payload.type === 'fate_deliberation_end') {
            setFateOverlayVisible(false);
          }
        } catch (wsErr) { console.error('[Arena WS] message error:', wsErr); logWs('arena message error:', wsErr); }
      };
      ws.onclose = () => {
        if (!active) return;
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      active = false;
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [locationId]);

  // ── Presence ──
  useEffect(() => {
    api('/api/presence/join', {
      method: 'POST',
      body: JSON.stringify({ locationId })
    }).catch(() => { });

    const fetchPresence = () => {
      api('/api/presence').then(data => {
        setPresence(data?.presence?.[locationId] || []);
      }).catch(() => { });
    };
    fetchPresence();

    const interval = setInterval(() => {
      api('/api/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ locationId })
      }).catch(() => { });
      fetchPresence();
    }, 10000);

    return () => {
      clearInterval(interval);
      const token = localStorage.getItem('dh_token');
      const blob = new Blob(
        [JSON.stringify({ token })],
        { type: 'application/json' }
      );
      navigator.sendBeacon('/api/presence/leave', blob);
    };
  }, [locationId]);

  // ── Sync encounter state → reset action state when it's my turn ──
  useEffect(() => {
    if (activeEncounter?.phase === 'action') {
      const turnEntry = activeEncounter.initiativeOrder?.[activeEncounter.currentTurnIndex];
      if (turnEntry?.id === user?.id) {
        // It's my turn — reset action state so buttons are active
        setActionChosen(null);
        setRollPhase(null);
        setAttackResult(null);
        setMonsterRollStatus(null);
        rollActiveRef.current = false;
        setBonusActionPhase(false);
        setAvailableBonusActions([]);
        setInspirationTargetModal(false);
        setCastingSpell(null);
        setSpellModalOpen(false);
        setHealingWordTargetModal(false);
        setHealSpellTargetModal(null);
        setStunningStrikeToggle(false);
        setEnsnaringStrikeToggle(false);
      }
    }
    // Reset initiative state when entering a fresh encounter
    if (activeEncounter?.phase === 'initiative_rolling') {
      setMyInitRoll(null);
      initiativeRollRef.current = false;
      // Clear stale overlays from any previous encounter
      setRollResultOverlay(null);
      setSpectatorRoll(null);
      spectatorQueueRef.current = [];
    }
  // NOTE: turnDeadline intentionally excluded — DM roll control extends the deadline
  // mid-turn, which would reset action state and cause players to re-roll.
  }, [activeEncounter?.phase, activeEncounter?.currentTurnIndex, user?.id]);

  // ── Countdown timer (per-turn: 90s, pauses during dice rolls & result screens) ──
  useEffect(() => {
    // Stop ticking once the encounter has ended (result screen showing)
    if (encounterResult) return;
    if (!activeEncounter || activeEncounter.phase !== 'action' || !activeEncounter.turnDeadline) return;
    // Reset pause tracking on new turn
    timerPauseStartRef.current = null;
    timerPauseOffsetRef.current = 0;
    const tick = () => {
      const isPaused = !!diceRollRef.current || !!rollResultOverlayRef.current;
      if (isPaused) {
        if (!timerPauseStartRef.current) {
          timerPauseStartRef.current = Date.now();
        }
        return; // freeze timeLeft
      }
      // Accumulate pause duration when unpausing
      if (timerPauseStartRef.current) {
        timerPauseOffsetRef.current += Date.now() - timerPauseStartRef.current;
        timerPauseStartRef.current = null;
      }
      setTimeLeft(Math.max(0, activeEncounter.turnDeadline + timerPauseOffsetRef.current - Date.now()));
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => clearInterval(timerRef.current);
  }, [activeEncounter?.turnDeadline, activeEncounter?.phase, encounterResult]);

  // ── Turn announcement ("Tyren's Turn", "Goblin's Turn") ──
  // Waits for spectator dice from the previous turn to finish first.
  // Tracks the last announced turn to avoid re-announcing on timer resets
  // (e.g. pre-bonus actions like Ensnaring Strike reset turnDeadline).
  useEffect(() => {
    const phase = activeEncounter?.phase;
    if (!activeEncounter || !phase) return;
    if (phase !== 'action' && phase !== 'monster_rolling' && phase !== 'monster_turn') return;
    const entry = activeEncounter.initiativeOrder?.[activeEncounter.currentTurnIndex];
    if (!entry) return;

    // Skip if we already announced this exact turn
    const turnKey = `${activeEncounter.id}_${activeEncounter.round}_${activeEncounter.currentTurnIndex}`;
    if (lastAnnouncedTurnRef.current === turnKey) return;

    let cancelled = false;
    (async () => {
      // Wait for spectator dice + roll result overlays to finish
      let settled = false;
      while (!settled) {
        while (spectatorQueueRef.current.length > 0 || spectatorRollRef.current || rollResultOverlayRef.current) {
          if (cancelled) return;
          await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 500));
        if (cancelled) return;
        if (spectatorQueueRef.current.length === 0 && !spectatorRollRef.current && !rollResultOverlayRef.current) {
          settled = true;
        }
      }
      if (cancelled) return;
      lastAnnouncedTurnRef.current = turnKey;
      setTurnAnnouncement({ name: entry.name, type: entry.type });
      // Play turn announcement sound
      if (entry.id === userIdRef.current) playArenaSoundRef.current('yourTurn');
      else if (entry.type === 'monster') playArenaSoundRef.current('monsterTurn');
      else playArenaSoundRef.current('allyTurn');
      turnAnnouncementTimer.current = setTimeout(() => setTurnAnnouncement(null), 1500);
    })();
    return () => {
      cancelled = true;
      if (turnAnnouncementTimer.current) clearTimeout(turnAnnouncementTimer.current);
      setTurnAnnouncement(null);
    };
  }, [activeEncounter?.turnDeadline]);

  // ── Auto-scroll combat log ──
  useEffect(() => {
    const el = combatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [encounterNarrations]);

  // ── Dice roll promise pattern ──
  const requestDiceRoll = useCallback((notation, colorset, modifier, forcedValues, material, advantageType, label, forcedTotal) => {
    // Dismiss spectator overlay to free the dice canvas for the local roll
    setSpectatorRoll(null);
    return new Promise((resolve) => {
      encounterDiceRef.current = { resolve, rolls: null };
      diceRollKeyRef.current += 1;
      setDiceRoll({
        notation,
        colorset: colorset || 'white',
        material: material || 'plastic',
        modifier: modifier || 0,
        forcedValues: forcedValues || null,
        forcedTotal: forcedTotal ?? null,
        advantageType: advantageType || null,
        label: label || null,
        key: diceRollKeyRef.current,
      });

      // Safety timeout — if DiceOverlay crashes (e.g. iOS WebGL failure),
      // fall back to forced values (if available) or random rolls
      setTimeout(() => {
        if (encounterDiceRef.current?.resolve === resolve) {
          logArena('dice roll timed out, generating fallback rolls');
          encounterDiceRef.current = null;
          setDiceRoll(null);
          if (forcedValues) {
            resolve(forcedValues);
          } else {
            const match = notation.match(/(\d+)d(\d+)/i);
            const count = match ? parseInt(match[1]) : 1;
            const sides = match ? parseInt(match[2]) : 20;
            const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
            resolve(rolls);
          }
        }
      }, 12000);
    });
  }, []);

  const handleDiceResult = useCallback((rolls) => {
    if (encounterDiceRef.current) {
      encounterDiceRef.current.rolls = rolls;
    }
  }, []);

  const handleDiceDone = useCallback(() => {
    if (encounterDiceRef.current) {
      const { resolve, rolls } = encounterDiceRef.current;
      encounterDiceRef.current = null;
      setDiceRoll(null);
      if (resolve) resolve(rolls || []);
      return;
    }
    setDiceRoll(null);
  }, []);

  // ── Send emote ──
  const handleArenaEmote = useCallback(async (emoteId) => {
    if (emoteCooldownRef.current) return;
    emoteCooldownRef.current = true;
    setTimeout(() => { emoteCooldownRef.current = false; }, 5000);
    setEmoteGridOpen(false);
    try {
      const data = await api('/api/emotes/send', {
        method: 'POST',
        body: JSON.stringify({ emoteId, locationId })
      });
      if (data.success) {
        setActiveEmotes(prev => [...prev, {
          key: Date.now(),
          image: data.emoteImage,
          characterName: user?.characterName || user?.global_name || user?.username || 'You',
          left: 20 + Math.random() * 60,
        }]);
        const emoteSound = EMOTE_SOUND_MAP[emoteId];
        if (emoteSound) playArenaSoundRef.current(emoteSound);
      }
    } catch { }
  }, [user, locationId]);

  // ── Broadcast a dice roll to all arena spectators ──
  // Returns a promise so callers can await it to guarantee ordering
  const broadcastRoll = useCallback((notation, modifier, total, color, label) => {
    return api('/api/encounters/roll-broadcast', {
      method: 'POST',
      body: JSON.stringify({ notation, modifier, total, color, label, locationId }),
    }).catch(() => { });
  }, [locationId]);

  // ── Request server-generated dice roll, broadcast to spectators, animate locally ──
  const requestServerRoll = useCallback(async (notation, modifier, color, label, colorset, material, advantageType, { rollingLabel } = {}) => {
    const rollConfig = { notation, modifier, color, label, locationId, colorset: colorset || 'white', material: material || 'plastic', advantageType: advantageType || undefined };
    const data = await api('/api/encounters/roll-broadcast', {
      method: 'POST',
      body: JSON.stringify(rollConfig),
    });
    const { rolls, total } = data;
    await requestDiceRoll(notation, rollConfig.colorset, modifier, rolls, material, advantageType, rollingLabel || label, total);
    return { rolls, total };
  }, [locationId, requestDiceRoll]);

  // ── DM Roll Control handlers ──
  // Resolve encounterId from active encounter or encounter map (DM may not be a participant)
  const dmEncounterId = activeEncounter?.id || (encounterMap && Object.values(encounterMap)[0]?.encounterId) || null;

  const handleDmToggle = useCallback(async (enabled) => {
    if (!dmEncounterId) return;
    setDmRollControlEnabled(enabled);
    try {
      await api(`/api/encounters/${dmEncounterId}/dm-roll-control`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setDmRollControlEnabled(!enabled); // revert on failure
    }
  }, [dmEncounterId]);

  const handleDmResolve = useCallback(async (chosenRolls) => {
    if (!dmPendingRoll) return;
    try {
      await api('/api/encounters/dm-roll-resolve', {
        method: 'POST',
        body: JSON.stringify({
          encounterId: dmPendingRoll.encounterId,
          pendingRollId: dmPendingRoll.id,
          chosenRolls,
        }),
      });
    } catch { }
    setDmPendingRoll(null);
  }, [dmPendingRoll]);

  // Sync dmRollControl state from encounter public state
  useEffect(() => {
    if (activeEncounter?.dmRollControl !== undefined) {
      setDmRollControlEnabled(activeEncounter.dmRollControl);
    }
  }, [activeEncounter?.dmRollControl]);

  // Clear fate overlay when encounter ends
  useEffect(() => {
    if (!activeEncounter || activeEncounter.phase === 'ended') {
      setFateOverlayVisible(false);
      setDmPendingRoll(null);
    }
  }, [activeEncounter?.phase]);

  // ── Broadcast a roll result overlay to all arena spectators ──
  const broadcastRollResult = useCallback((resultData) => {
    api('/api/encounters/result-broadcast', {
      method: 'POST',
      body: JSON.stringify({ locationId, resultData }),
    }).catch(() => { });
  }, [locationId]);

  // ── Roll result overlay (promise-based) ──
  const showRollResult = useCallback((data) => {
    return new Promise((resolve) => {
      rollResultResolveRef.current = resolve;
      setRollResultOverlay(data);
    });
  }, []);

  const dismissRollResult = useCallback(() => {
    setRollResultOverlay(null);
    if (rollResultResolveRef.current) {
      rollResultResolveRef.current();
      rollResultResolveRef.current = null;
    }
  }, []);

  // ── Initiative roll handler (atomic join + initiative) ──
  const handleInitiativeRoll = useCallback(async () => {
    if (initiativeRollRef.current) return;

    const encId = pendingJoinEncounterId || activeEncounter?.id;
    if (!encId) return;

    initiativeRollRef.current = true;

    try {
      const dexMod = myDexMod;
      const rolls = await requestDiceRoll('1d20', myDiceColorset || '#eab308', dexMod, null, null, null, 'Rolling initiative');
      playArenaSound('initiativeHorn');
      const roll = rolls[0];
      const total = roll + dexMod;
      setMyInitRoll({ roll, modifier: dexMod, total });

      // Atomic join + initiative
      const data = await api(`/api/encounters/${encId}/join`, {
        method: 'POST',
        body: JSON.stringify({ roll }),
      });

      if (data.encounter) {
        setActiveEncounter(data.encounter);
        setPendingJoinEncounterId(null);
      }
    } catch (err) {
      console.error('Failed initiative roll:', err);
      initiativeRollRef.current = false;
    }
  }, [pendingJoinEncounterId, activeEncounter, requestDiceRoll, myDexMod]);

  // ── Spectator dice queue: show next queued roll when nothing else is rolling ──
  const onInitiativeScreen = pendingJoinEncounterId || activeEncounter?.phase === 'initiative_rolling' || activeEncounter?.participants?.[user?.id]?.needsInitiativeRoll;
  useEffect(() => {
    if (onInitiativeScreen) {
      spectatorQueueRef.current = [];
      return;
    }
    if (!diceRoll && !spectatorRoll && !rollResultOverlay && spectatorQueueRef.current.length > 0) {
      const next = spectatorQueueRef.current.shift();
      if (next.queueType === 'roll_result') {
        if (next.data.sounds) next.data.sounds.forEach(s => playArenaSoundRef.current(s));
        setRollResultOverlay(next.data);
      } else {
        setSpectatorRoll(next);
      }
    }
  }, [diceRoll, spectatorRoll, rollResultOverlay, queueTick, onInitiativeScreen]);

  const handleSpectatorDone = useCallback(() => {
    setSpectatorRoll(null);
  }, []);

  // Safety timeout: if a spectator DiceOverlay crashes (e.g. WebAssembly OOM),
  // onDone never fires and spectatorRoll gets stuck. Auto-dismiss after 5s.
  useEffect(() => {
    if (!spectatorRoll) return;
    const timeout = setTimeout(() => {
      logArena('spectator roll timed out, auto-dismissing');
      setSpectatorRoll(null);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [spectatorRoll]);

  // ── Monster dice rolling ──
  useEffect(() => {
    if (!monsterRollRequest || monsterRollActiveRef.current) return;
    if (monsterRollRequest.rollerId !== user?.id) return;

    monsterRollActiveRef.current = true;
    setRollPhase('monster_rolling');

    async function rollMonsterAttacks() {
      // Wait for spectator dice (e.g. previous player's attack rolls) to finish
      // before claiming the dice canvas for monster rolls.
      // There's a brief React render gap between one spectator roll finishing
      // and the next being dequeued, so we settle-check after the queue appears empty.
      let settled = false;
      while (!settled) {
        while (spectatorQueueRef.current.length > 0 || spectatorRollRef.current || rollResultOverlayRef.current) {
          await new Promise(r => setTimeout(r, 300));
        }
        // Allow React to dequeue the next spectator roll if any
        await new Promise(r => setTimeout(r, 500));
        if (spectatorQueueRef.current.length === 0 && !spectatorRollRef.current && !rollResultOverlayRef.current) {
          settled = true;
        }
      }
      // Breathing room so the player can absorb the last roll before monster attacks
      await new Promise(r => setTimeout(r, 1200));

      const results = [];
      // Track accumulated damage per target (server doesn't update HP mid-turn)
      const accumulatedDmg = {};
      let dotRolls = null;

      // Roll DoT damage dice first (e.g. ensnared → green d6)
      let totalDotDamage = 0;
      if (monsterRollRequest.pendingDots && monsterRollRequest.pendingDots.length > 0) {
        dotRolls = {};
        for (const dot of monsterRollRequest.pendingDots) {
          setMonsterRollStatus(`\u{1FAB4} ${dot.name} \u2014 ${monsterRollRequest.monsterName} takes ${dot.type} damage!`);
          const { total } = await requestServerRoll(
            dot.dice, 0, '#22c55e', `${dot.name} \u2014 ${dot.type} damage`, '#22c55e'
          );
          dotRolls[dot.conditionId] = total;
          totalDotDamage += total;
          await new Promise(r => setTimeout(r, 800));
        }
      }

      // If DoT killed the monster, skip attack rolls and submit immediately
      const monsterHp = activeEncounterRef.current?.monster?.currentHp || 0;
      if (totalDotDamage > 0 && monsterHp - totalDotDamage <= 0) {
        setMonsterRollStatus('The vines finish their work...');
        try {
          await api(`/api/encounters/${monsterRollRequest.encounterId}/monster-rolls`, {
            method: 'POST',
            body: JSON.stringify({ rolls: [{ index: 0, attackRoll: 0, damageTotal: 0, dotRolls }] }),
          });
        } catch (err) {
          console.error('Failed to submit DoT-kill monster rolls:', err);
        }
        setRollPhase(null);
        setMonsterRollStatus(null);
        monsterRollActiveRef.current = false;
        clearMonsterRollRequest?.();
        return;
      }

      // Optimistically update monster HP to reflect DoT damage
      if (totalDotDamage > 0) {
        setActiveEncounter(prev => prev ? {
          ...prev,
          monster: { ...prev.monster, currentHp: Math.max(0, prev.monster.currentHp - totalDotDamage) },
        } : prev);
      }

      for (const attack of monsterRollRequest.attacks) {
        playArenaSoundRef.current('monsterGrowl');
        setMonsterRollStatus(`${monsterRollRequest.monsterName} attacks ${attack.targetName}! Rolling d20...`);

        // 5e Disadvantage: if target is dodging, roll 2d20 and take lower
        const hasDisadvantage = attack.disadvantage;
        const atkNotation = hasDisadvantage ? '2d20' : '1d20';

        // Server generates the d20 roll(s), broadcasts to spectators, animates locally
        const { rolls: atkRolls, total: rawTotal } = await requestServerRoll(
          atkNotation, attack.bonus, '#ef4444', `${monsterRollRequest.monsterName} attacks ${attack.targetName}`, '#ef4444', undefined, hasDisadvantage ? 'disadvantage' : undefined
        );

        let d20, d20b, usedD20;
        if (hasDisadvantage && atkRolls.length >= 2) {
          d20 = atkRolls[0];
          d20b = atkRolls[1];
          usedD20 = Math.min(d20, d20b);
        } else {
          d20 = atkRolls[0];
          d20b = null;
          usedD20 = d20;
        }

        const total = usedD20 + attack.bonus;
        const isNat20 = usedD20 === 20;
        const isNat1 = usedD20 === 1;
        const isHit = isNat20 || (!isNat1 && total >= attack.targetAC);
        // Monster attack result sound + crowd reaction (reversed — gasp on monster crit, cheer on fumble)
        if (isNat20) { playArenaSoundRef.current('attackCrit'); playArenaSoundRef.current('crowdGasp'); }
        else if (isNat1) { playArenaSoundRef.current('attackFumble'); playArenaSoundRef.current('crowdCheer'); }
        else if (isHit) playArenaSoundRef.current('attackHit');
        else playArenaSoundRef.current('attackMiss');

        // Show attack result overlay with disadvantage info
        const monsterImg = activeEncounterRef.current?.monster?.image;
        const targetParticipant = activeEncounterRef.current?.participants?.[attack.targetId];
        const monsterAtkOverlay = {
          type: 'attack',
          total,
          breakdown: `${usedD20} + ${attack.bonus}`,
          targetAC: attack.targetAC,
          isHit,
          isCrit: isNat20,
          isFumble: isNat1,
          attacker: { name: monsterRollRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
          defender: { name: attack.targetName, avatar: targetParticipant?.avatar },
          advantageType: hasDisadvantage ? 'disadvantage' : undefined,
          roll1: d20,
          roll2: d20b,
          attackBonus: attack.bonus,
          sounds: isNat20 ? ['attackCrit', 'crowdGasp'] : isNat1 ? ['attackFumble', 'crowdCheer'] : isHit ? ['attackHit'] : ['attackMiss'],
        };
        broadcastRollResult(monsterAtkOverlay);
        await showRollResult(monsterAtkOverlay);

        let damageTotal = 0;

        if (isHit) {
          setMonsterRollStatus(`${monsterRollRequest.monsterName} hits ${attack.targetName}! Rolling damage...`);

          const { dice, modifier } = parseDamageNotation(attack.damageDice);
          const mCritLabel = isNat20 ? `${monsterRollRequest.monsterName} crits!` : `${monsterRollRequest.monsterName} rolls damage`;

          playArenaSoundRef.current('monsterHit');
          const { total: dmgTotal } = await requestServerRoll(
            isNat20 ? doubleDice(dice) : dice, modifier, '#ef4444', mCritLabel, '#ef4444'
          );
          damageTotal = dmgTotal;
          if (damageTotal >= 20 && damageTotal < 30) playArenaSoundRef.current('bigDamage');
          if (damageTotal >= 30) playArenaSoundRef.current('massiveDamage');
          // Show damage result overlay (track accumulated damage for multi-attacks)
          const dmgTargetP = activeEncounterRef.current?.participants?.[attack.targetId];
          const baseHp = dmgTargetP?.currentHp || 0;
          const priorDmg = accumulatedDmg[attack.targetId] || 0;
          const effectiveHp = Math.max(0, baseHp - priorDmg);
          accumulatedDmg[attack.targetId] = priorDmg + damageTotal;
          const monsterDmgSounds = [];
          if (damageTotal >= 20 && damageTotal < 30) monsterDmgSounds.push('bigDamage');
          if (damageTotal >= 30) monsterDmgSounds.push('massiveDamage');
          const monsterDmgOverlay = {
            type: 'damage',
            damage: damageTotal,
            isCrit: isNat20,
            monsterHp: effectiveHp,
            newHp: Math.max(0, effectiveHp - damageTotal),
            attacker: { name: monsterRollRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
            defender: { name: attack.targetName, avatar: dmgTargetP?.avatar },
            sounds: monsterDmgSounds,
          };
          broadcastRollResult(monsterDmgOverlay);
          await showRollResult(monsterDmgOverlay);
        }

        results.push({ index: attack.index, attackRoll: usedD20, attackRoll2: d20b, damageTotal, dotRolls: dotRolls || undefined });
        // Only include dotRolls on the first result entry, then clear
        dotRolls = null;
      }

      setMonsterRollStatus('Resolving monster attacks...');
      try {
        await api(`/api/encounters/${monsterRollRequest.encounterId}/monster-rolls`, {
          method: 'POST',
          body: JSON.stringify({ rolls: results }),
        });
      } catch (err) {
        console.error('Failed to submit monster rolls:', err);
      }

      setRollPhase(null);
      setMonsterRollStatus(null);
      monsterRollActiveRef.current = false;
      clearMonsterRollRequest?.();
    }

    rollMonsterAttacks();
  }, [monsterRollRequest, user?.id, requestServerRoll, clearMonsterRollRequest, broadcastRollResult]);

  // ── Monster end-of-turn save rolling ──
  useEffect(() => {
    if (!monsterSaveRequest || monsterSaveActiveRef.current) return;
    if (monsterSaveRequest.rollerId !== user?.id) return;

    monsterSaveActiveRef.current = true;
    setRollPhase('monster_saving');

    async function rollMonsterSaves() {
      // Wait for any active spectator or roll overlays to finish
      let settled = false;
      while (!settled) {
        while (spectatorQueueRef.current.length > 0 || spectatorRollRef.current || rollResultOverlayRef.current) {
          await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 500));
        if (spectatorQueueRef.current.length === 0 && !spectatorRollRef.current && !rollResultOverlayRef.current) {
          settled = true;
        }
      }
      await new Promise(r => setTimeout(r, 800));

      const saveResults = [];
      const monsterImg = activeEncounterRef.current?.monster?.image;

      for (const save of monsterSaveRequest.pendingSaves) {
        const saveLabel = `${monsterSaveRequest.monsterName} ${save.saveAbility} save vs DC ${save.saveDC}`;
        setMonsterRollStatus(`${monsterSaveRequest.monsterName} rolls ${save.saveAbility} save...`);

        const { rolls } = await requestServerRoll(
          '1d20', save.saveBonus, '#ef4444', saveLabel, '#ef4444',
          undefined, undefined, { rollingLabel: saveLabel }
        );
        const saveRoll = rolls[0];
        const total = saveRoll + save.saveBonus;
        const saved = total >= save.saveDC;

        // Show save result overlay
        const saveOverlay = {
          type: 'spell_save',
          spellName: save.conditionName,
          saveAbility: save.saveAbility,
          saveRoll, saveBonus: save.saveBonus, saveTotal: total,
          saveDC: save.saveDC, saved,
          attacker: { name: monsterSaveRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
          defender: { name: monsterSaveRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
          sounds: saved ? ['spellFail'] : ['crowdCheer'],
        };
        broadcastRollResult(saveOverlay);
        await showRollResult(saveOverlay);

        saveResults.push({ conditionId: save.conditionId, roll: saveRoll });
        await new Promise(r => setTimeout(r, 400));
      }

      // Submit save results to server
      try {
        await api(`/api/encounters/${monsterSaveRequest.encounterId}/monster-saves`, {
          method: 'POST',
          body: JSON.stringify({ saveRolls: saveResults }),
        });
      } catch (err) {
        console.error('Failed to submit monster saves:', err);
      }

      setRollPhase(null);
      setMonsterRollStatus(null);
      monsterSaveActiveRef.current = false;
      clearMonsterSaveRequest?.();
    }

    rollMonsterSaves();
  }, [monsterSaveRequest, user?.id, requestServerRoll, clearMonsterSaveRequest, broadcastRollResult, showRollResult]);

  // ── Player CON save rolling (concentration) ──
  useEffect(() => {
    if (!conSaveRequest || conSaveActiveRef.current) return;

    // Only the affected player rolls their own save
    const myPendingSaves = (conSaveRequest.pendingConSaves || []).filter(s => s.userId === user?.id);
    if (myPendingSaves.length === 0) return;

    conSaveActiveRef.current = true;
    setRollPhase('con_saving');

    async function rollConSaves() {
      // Wait for any active spectator or roll overlays to finish
      let settled = false;
      while (!settled) {
        while (spectatorQueueRef.current.length > 0 || spectatorRollRef.current || rollResultOverlayRef.current) {
          await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 500));
        if (spectatorQueueRef.current.length === 0 && !spectatorRollRef.current && !rollResultOverlayRef.current) {
          settled = true;
        }
      }
      await new Promise(r => setTimeout(r, 800));

      const saveResults = [];

      for (const save of myPendingSaves) {
        const saveLabel = `${save.playerName} CON save vs DC ${save.dc}`;
        setMonsterRollStatus(`${save.playerName} rolls CON save...`);

        const { rolls } = await requestServerRoll(
          '1d20', save.conMod, '#eab308', saveLabel, myDiceColorset,
          undefined, undefined, { rollingLabel: saveLabel }
        );
        const saveRoll = rolls[0];
        const total = saveRoll + save.conMod;
        const saved = total >= save.dc;

        // Concentration result sounds
        if (saved) playArenaSound('crowdCheer');
        else playArenaSound('attackFumble');

        const playerParticipant = activeEncounterRef.current?.participants?.[save.userId];
        const playerAvatar = playerParticipant?.avatar || (playerParticipant?.sprite && `/players/${playerParticipant.sprite}`);

        const saveOverlay = {
          type: 'spell_save',
          isConcentration: true,
          spellName: save.spellName,
          saveAbility: 'CON',
          saveRoll, saveBonus: save.conMod, saveTotal: total,
          saveDC: save.dc, saved,
          attacker: { name: save.spellName, avatar: playerAvatar },
          defender: { name: save.playerName, avatar: playerAvatar },
          sounds: saved ? ['crowdCheer'] : ['attackFumble'],
        };
        broadcastRollResult(saveOverlay);
        await showRollResult(saveOverlay);

        saveResults.push({ userId: save.userId, roll: saveRoll });
        await new Promise(r => setTimeout(r, 400));
      }

      // Submit to server
      if (saveResults.length > 0) {
        try {
          await api(`/api/encounters/${conSaveRequest.encounterId}/con-saves`, {
            method: 'POST',
            body: JSON.stringify({ saveRolls: saveResults }),
          });
        } catch (err) {
          console.error('Failed to submit con saves:', err);
        }
      }

      setRollPhase(null);
      setMonsterRollStatus(null);
      conSaveActiveRef.current = false;
      clearConSaveRequest?.();
    }

    rollConSaves();
  }, [conSaveRequest, user?.id, requestServerRoll, clearConSaveRequest, broadcastRollResult, showRollResult, myDiceColorset]);

  // ── Monster escape check rolling ──
  useEffect(() => {
    if (!monsterEscapeRequest || monsterEscapeActiveRef.current) return;
    if (monsterEscapeRequest.rollerId !== user?.id) return;

    monsterEscapeActiveRef.current = true;
    setRollPhase('monster_escaping');

    async function rollMonsterEscape() {
      // Wait for any active spectator or roll overlays to finish
      let settled = false;
      while (!settled) {
        while (spectatorQueueRef.current.length > 0 || spectatorRollRef.current || rollResultOverlayRef.current) {
          await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 500));
        if (spectatorQueueRef.current.length === 0 && !spectatorRollRef.current && !rollResultOverlayRef.current) {
          settled = true;
        }
      }
      await new Promise(r => setTimeout(r, 800));

      const escapeResults = [];
      const monsterImg = activeEncounterRef.current?.monster?.image;
      let dotRolls = null;

      // Roll DoT damage dice first (e.g. ensnared → 1d6 piercing)
      let totalDotDamage = 0;
      let currentMonsterHp = activeEncounterRef.current?.monster?.currentHp ?? 0;
      if (monsterEscapeRequest.pendingDots && monsterEscapeRequest.pendingDots.length > 0) {
        dotRolls = {};
        for (const dot of monsterEscapeRequest.pendingDots) {
          setMonsterRollStatus(`\u{1FAB4} ${dot.name} \u2014 ${monsterEscapeRequest.monsterName} takes ${dot.type} damage!`);
          const { total } = await requestServerRoll(
            dot.dice, 0, '#22c55e', `${dot.name} \u2014 ${dot.type} damage`, '#22c55e'
          );
          dotRolls[dot.conditionId] = total;
          totalDotDamage += total;

          // Show damage overlay for the DoT
          const hpBefore = currentMonsterHp;
          currentMonsterHp = Math.max(0, currentMonsterHp - total);
          const dotDmgOverlay = {
            type: 'damage',
            damage: total,
            damageType: dot.type,
            monsterHp: hpBefore,
            newHp: currentMonsterHp,
            attacker: { name: dot.name, avatar: monsterImg && `/monsters/${monsterImg}` },
            defender: { name: monsterEscapeRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
            sounds: currentMonsterHp <= 0 ? ['bigDamage'] : ['attackHit'],
          };
          broadcastRollResult(dotDmgOverlay);
          await showRollResult(dotDmgOverlay);
        }
      }

      // Optimistic HP update so HP bar drops visually before escape check
      if (totalDotDamage > 0) {
        setActiveEncounter(prev => prev ? {
          ...prev,
          monster: { ...prev.monster, currentHp: Math.max(0, prev.monster.currentHp - totalDotDamage) },
        } : prev);
      }

      // If DoT killed the monster, skip escape checks — server will handle defeat
      if (currentMonsterHp > 0) {
        for (const esc of monsterEscapeRequest.pendingEscapes) {
          const escLabel = `${monsterEscapeRequest.monsterName} ${esc.checkAbility} check vs DC ${esc.saveDC}`;
          setMonsterRollStatus(`${monsterEscapeRequest.monsterName} struggles to break free...`);

          const { rolls } = await requestServerRoll(
            '1d20', esc.checkBonus, '#ef4444', escLabel, '#ef4444',
            undefined, undefined, { rollingLabel: escLabel }
          );
          const escRoll = rolls[0];
          const total = escRoll + esc.checkBonus;
          const escaped = total >= esc.saveDC;

          // Show escape result overlay (reuse spell_save type)
          const escOverlay = {
            type: 'spell_save',
            spellName: esc.conditionName,
            saveAbility: esc.checkAbility,
            saveRoll: escRoll, saveBonus: esc.checkBonus, saveTotal: total,
            saveDC: esc.saveDC, saved: escaped,
            attacker: { name: monsterEscapeRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
            defender: { name: monsterEscapeRequest.monsterName, avatar: monsterImg && `/monsters/${monsterImg}` },
            sounds: escaped ? ['spellFail'] : ['crowdCheer'],
          };
          broadcastRollResult(escOverlay);
          await showRollResult(escOverlay);

          escapeResults.push({ conditionId: esc.conditionId, roll: escRoll });
          await new Promise(r => setTimeout(r, 400));
        }
      }

      // Submit escape results + DoT rolls to server
      try {
        await api(`/api/encounters/${monsterEscapeRequest.encounterId}/monster-escape`, {
          method: 'POST',
          body: JSON.stringify({ escapeRolls: escapeResults, dotRolls: dotRolls || undefined }),
        });
      } catch (err) {
        console.error('Failed to submit monster escape:', err);
      }

      setRollPhase(null);
      setMonsterRollStatus(null);
      monsterEscapeActiveRef.current = false;
      clearMonsterEscapeRequest?.();
    }

    rollMonsterEscape();
  }, [monsterEscapeRequest, user?.id, requestServerRoll, clearMonsterEscapeRequest, broadcastRollResult, showRollResult]);

  // ── Join an existing encounter by ID ──
  const handleJoinExisting = useCallback((encounterId) => {
    if (pendingJoinEncounterId || !encounterId) return;
    setPendingJoinEncounterId(encounterId);
    setMyInitRoll(null);
    initiativeRollRef.current = false;
    setSelectedMonster(null);
  }, [pendingJoinEncounterId]);

  // ── Spawn + show initiative (from monster selection) ──
  const handleSpawnAndJoin = useCallback(async () => {
    if (spawning || !selectedMonster) return;
    const monsterId = selectedMonster.id;
    setSpawning(monsterId);
    try {
      const data = await api('/api/encounters/spawn', {
        method: 'POST',
        body: JSON.stringify({ locationId, monsterId }),
      });
      if (data.encounter) {
        // Show initiative screen — don't join yet
        setPendingJoinEncounterId(data.encounter.id);
        setMyInitRoll(null);
        initiativeRollRef.current = false;
      }
    } catch (err) {
      // Race condition: another player may have spawned same monster — try to join it
      const existing = encounterMap[monsterId];
      if (existing?.encounterId) {
        setPendingJoinEncounterId(existing.encounterId);
        setMyInitRoll(null);
        initiativeRollRef.current = false;
      } else {
        console.error('Failed to spawn encounter:', err);
      }
    } finally {
      setSpawning(null);
      setSelectedMonster(null);
    }
  }, [spawning, selectedMonster, locationId, encounterMap]);

  // ── Submit action ──
  const handleAction = useCallback(async (action, selectedWeapon) => {
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;
    const isParticipant = activeEncounter.participants?.[user?.id];
    if (!isParticipant) return;

    setActionChosen(action);

    if (action === 'attack') {
      rollActiveRef.current = true;
      const myStats = activeEncounter.participants[user.id];
      // Use selected weapon stats if provided, otherwise fall back to defaults
      const wpn = selectedWeapon || null;

      try {
        setRollPhase('attack_roll');
        const atkBonus = wpn ? wpn.attackBonus : (myStats.attackBonus || 0);
        const pName = myStats.name || user?.characterName || user?.username || 'Player';

        // 5e Advantage/Disadvantage: check if player has advantage on attack
        // Also check monster conditions (stunned/restrained grant attackers advantage)
        const monsterGivesAdv = (activeEncounter.monster?.conditions || []).some(c =>
          c.id === 'stunned' || c.id === 'restrained'
        );
        const hasAdvantage = myStats.advantageOnNextAttack || monsterGivesAdv;
        const advantageType = hasAdvantage ? 'advantage' : 'normal';
        const diceNotation = advantageType !== 'normal' ? '2d20' : '1d20';

        // Server generates the dice roll(s), broadcasts to spectators, animates locally
        const advParam = advantageType !== 'normal' ? advantageType : undefined;
        const { rolls: atkRolls, total: rawTotal } = await requestServerRoll(
          diceNotation, atkBonus, '#eab308', `${pName} rolls to attack`, myDiceColorset, undefined, advParam
        );

        let roll, roll2, usedRoll;
        if (advantageType !== 'normal' && atkRolls.length >= 2) {
          roll = atkRolls[0];
          roll2 = atkRolls[1];
          usedRoll = advantageType === 'advantage' ? Math.max(roll, roll2) : Math.min(roll, roll2);
        } else {
          roll = atkRolls[0];
          roll2 = null;
          usedRoll = roll;
        }

        let total = usedRoll + atkBonus;
        const isNat20 = usedRoll === 20;
        const isNat1 = usedRoll === 1;
        let isHit = isNat20 || (!isNat1 && total >= activeEncounter.monster.ac);

        // Bardic Inspiration decision — only on near-misses where the die could turn it into a hit
        let inspirationData = undefined;
        const inspMaxValue = myStats.inspirationDie ? parseInt(myStats.inspirationDie.replace('d', '')) : 0;
        if (myStats.inspirationDie && !isNat1 && !isHit && total + inspMaxValue >= activeEncounter.monster.ac) {
          const useInspiration = await new Promise((resolve) => {
            setInspirationPrompt({
              die: myStats.inspirationDie,
              total,
              ac: activeEncounter.monster.ac,
              isHit,
              resolve,
            });
          });
          setInspirationPrompt(null);

          if (useInspiration) {
            // Roll the inspiration die with 3D dice
            setRollPhase('inspiration_roll');
            playArenaSound('bardicInspiration');
            const { total: inspTotal } = await requestServerRoll(
              `1${myStats.inspirationDie}`, 0, '#c084fc', `${pName} uses Bardic Inspiration!`, '#c084fc'
            );
            total += inspTotal;
            isHit = total >= activeEncounter.monster.ac;
            inspirationData = { roll: inspTotal };
          }
        }

        setAttackResult({ roll: usedRoll, total, isHit, isNat20, isNat1 });
        setRollPhase('attack_result');
        // Attack result sound + crowd reaction
        if (isNat20) { playArenaSound('attackCrit'); playArenaSound('crowdCheer'); }
        else if (isNat1) { playArenaSound('attackFumble'); playArenaSound('crowdGasp'); playArenaSound('youSuck'); }
        else if (isHit) playArenaSound('attackHit');
        else playArenaSound('attackMiss');

        // Show attack result overlay with advantage info
        const attackOverlayData = {
          type: 'attack',
          total,
          breakdown: inspirationData
            ? `${usedRoll} + ${atkBonus} + ${inspirationData.roll}`
            : `${usedRoll} + ${atkBonus}`,
          targetAC: activeEncounter.monster.ac,
          isHit,
          isCrit: isNat20,
          isFumble: isNat1,
          attacker: { name: pName, avatar: myStats.avatar || (myStats.sprite && `/players/${myStats.sprite}`) },
          defender: { name: monster.name, avatar: monster.image && `/monsters/${monster.image}` },
          advantageType: advantageType !== 'normal' ? advantageType : undefined,
          roll1: roll,
          roll2,
          attackBonus: atkBonus,
          sounds: isNat20 ? ['attackCrit', 'crowdCheer'] : isNat1 ? ['attackFumble', 'crowdGasp', 'youSuck'] : isHit ? ['attackHit'] : ['attackMiss'],
        };
        broadcastRollResult(attackOverlayData);
        await showRollResult(attackOverlayData);

        let damageTotal = 0;
        let smiteData = undefined;
        let sneakAttackData = undefined;
        let huntersMarkData = undefined;
        let ensnaringStrikeSaveRoll;
        let stunningStrikeSaveRoll;

        if (isHit) {
          // Divine Smite decision — BEFORE rolling damage
          let smiteChoice = null;
          const hasSmite = (myStats.classFeatures || []).includes('Divine Smite');
          const availableSlots = (myStats.spellSlots || []).filter(s => s.used < s.total);

          if (hasSmite && availableSlots.length > 0) {
            smiteChoice = await new Promise((resolve) => {
              setSmitePrompt({
                slots: availableSlots,
                monsterType: activeEncounter.monster.creatureType,
                isNat20,
                resolve,
              });
            });
            setSmitePrompt(null);
          }

          // Roll weapon damage dice (player's colorset)
          setRollPhase('damage_roll');
          const dmgMod = wpn ? wpn.damageMod : (myStats.damageMod || 0);
          const baseDmgNotation = wpn ? wpn.dice : (myStats.damageNotation || '1d4');
          const weaponNotation = isNat20 ? doubleDice(baseDmgNotation) : baseDmgNotation;
          const critLabel = isNat20 ? `${pName} crits!` : `${pName} rolls damage`;

          playArenaSound('damageImpact');
          const { total: dmgTotal } = await requestServerRoll(
            weaponNotation, dmgMod, '#eab308', critLabel, myDiceColorset
          );
          damageTotal = dmgTotal;

          // Roll smite dice separately (gold metal) if smite was chosen
          if (smiteChoice) {
            setRollPhase('smite_roll');
            const baseDice = 2 + (smiteChoice.slotLevel - 1);
            const isUndeadFiend = ['undead', 'fiend'].includes(activeEncounter.monster.creatureType);
            const bonusDice = isUndeadFiend ? 1 : 0;
            let totalSmiteDice = baseDice + bonusDice;
            if (isNat20) totalSmiteDice *= 2;
            const smiteNotation = `${totalSmiteDice}d8`;

            playArenaSound('divineSmite');
            const { total: smiteTotal } = await requestServerRoll(
              smiteNotation, 0, '#FFD700', 'DIVINE SMITE!', '#FFD700', 'perfectmetal'
            );
            damageTotal += smiteTotal;
            playArenaSound('crowdCheer');
            smiteData = { slotLevel: smiteChoice.slotLevel, smiteDamage: smiteTotal };
          }

          // Sneak Attack — auto-roll when eligible (Rogue feature)
          if (myStats.sneakAttackDice > 0 && wpn && (wpn.finesse || wpn.ranged)) {
            const hasAlly = Object.entries(activeEncounter.participants)
              .some(([uid, p]) => uid !== user.id && !p.knockedOut);
            const isEligible = advantageType === 'advantage' || hasAlly;
            if (isEligible) {
              setRollPhase('sneak_attack_roll');
              let saDiceCount = myStats.sneakAttackDice;
              if (isNat20) saDiceCount *= 2;
              const saNotation = `${saDiceCount}d6`;
              const { total: saTotal } = await requestServerRoll(
                saNotation, 0, '#10b981', 'SNEAK ATTACK!', '#10b981', 'glass'
              );
              damageTotal += saTotal;
              sneakAttackData = { sneakAttackDamage: saTotal };
              playArenaSound('crowdCheer');
            }
          }

          // Hunter's Mark — auto-roll 1d6 bonus damage when active
          // Skip if Ensnaring Strike toggled — casting it drops Hunter's Mark concentration
          if (myStats.huntersMarkActive && !ensnaringStrikeToggleRef.current) {
            setRollPhase('hunters_mark_roll');
            playArenaSound('damageImpact');
            const { total: hmTotal } = await requestServerRoll(
              '1d6', 0, '#a855f7', "HUNTER'S MARK!", '#a855f7', 'glass'
            );
            damageTotal += hmTotal;
            huntersMarkData = { damage: hmTotal };
          }

          // Show damage result overlay
          if (damageTotal >= 20 && damageTotal < 30) playArenaSound('bigDamage');
          if (damageTotal >= 30) playArenaSound('massiveDamage');
          const dmgSounds = [];
          if (damageTotal >= 20 && damageTotal < 30) dmgSounds.push('bigDamage');
          if (damageTotal >= 30) dmgSounds.push('massiveDamage');
          if (smiteData) dmgSounds.push('divineSmite', 'crowdCheer');
          if (sneakAttackData) dmgSounds.push('crowdCheer');
          const damageOverlayData = {
            type: 'damage',
            damage: damageTotal,
            isCrit: isNat20,
            smiteDamage: smiteData?.smiteDamage,
            sneakAttackDamage: sneakAttackData?.sneakAttackDamage,
            huntersMarkDamage: huntersMarkData?.damage,
            monsterHp: activeEncounter.monster.currentHp,
            newHp: Math.max(0, activeEncounter.monster.currentHp - damageTotal),
            attacker: { name: pName, avatar: myStats.avatar || (myStats.sprite && `/players/${myStats.sprite}`) },
            defender: { name: monster.name, avatar: monster.image && `/monsters/${monster.image}` },
            sounds: dmgSounds,
          };
          broadcastRollResult(damageOverlayData);
          await showRollResult(damageOverlayData);

          // Ensnaring Strike — if toggled and monster survives, roll visible STR save
          // Skip if damage kills the monster (no point saving against vines on a corpse)
          const monsterSurvives = activeEncounter.monster.currentHp - damageTotal > 0;
          if (ensnaringStrikeToggleRef.current && monsterSurvives) {
            // Optimistically update HP so the bar reflects damage while save rolls
            setActiveEncounter(prev => prev ? {
              ...prev,
              monster: { ...prev.monster, currentHp: Math.max(0, prev.monster.currentHp - damageTotal) },
            } : prev);

            const { saveRoll } = await rollMonsterSave({
              saveAbility: 'STR',
              spellName: 'Ensnaring Strike',
              castSound: 'spellCast',
            });
            ensnaringStrikeSaveRoll = saveRoll;
          }

          // Stunning Strike — if toggled and monster survives, roll visible CON save
          if (stunningStrikeToggle && monsterSurvives && myStats.hasKiPoints && myStats.kiPointsUsed < myStats.kiPointsMax) {
            // Optimistically update HP so the bar reflects damage while save rolls
            if (!ensnaringStrikeToggleRef.current) {
              setActiveEncounter(prev => prev ? {
                ...prev,
                monster: { ...prev.monster, currentHp: Math.max(0, prev.monster.currentHp - damageTotal) },
              } : prev);
            }

            const { saveRoll: ssRoll } = await rollMonsterSave({
              saveAbility: 'CON',
              spellName: 'Stunning Strike',
              castSound: 'spellCast',
            });
            stunningStrikeSaveRoll = ssRoll;
          }
        }

        // Capture toggle values before clearing
        const wasEnsnaringStrike = ensnaringStrikeToggleRef.current;
        const wasStunningStrike = stunningStrikeToggle;

        // Reset toggles after use
        setStunningStrikeToggle(false);
        setEnsnaringStrikeToggle(false);
        ensnaringStrikeToggleRef.current = false;

        setRollPhase('submitting');
        await api(`/api/encounters/${activeEncounter.id}/action`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'attack',
            attackRoll: usedRoll,
            attackRoll2: roll2,
            damageTotal,
            smiteData,
            sneakAttackData,
            huntersMarkData,
            inspirationData,
            weaponId: wpn?.id,
            ensnaringStrike: wasEnsnaringStrike || undefined,
            ensnaringStrikeSaveRoll,
            stunningStrike: wasStunningStrike || undefined,
            stunningStrikeSaveRoll,
          }),
        });

        setRollPhase(null);
      } catch (err) {
        console.error('Failed to complete attack:', err);
        setActionChosen(null);
        setRollPhase(null);
        setAttackResult(null);
      } finally {
        rollActiveRef.current = false;
      }
    } else if (action === 'potion') {
      // Potion flow handled by handlePotionUse, not here
    } else {
      try {
        await api(`/api/encounters/${activeEncounter.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
      } catch (err) {
        console.error('Failed to submit action:', err);
        setActionChosen(null);
      }
    }
  }, [activeEncounter, actionChosen, user?.id, requestServerRoll, broadcastRollResult, stunningStrikeToggle]);

  // ── Dismiss result → back to monster picker ──
  const handleDismissResult = useCallback(() => {
    clearEncounterResult();
    setActionChosen(null);
    setRollPhase(null);
    setAttackResult(null);
    setMonsterRollStatus(null);
    setLevelUp(null);
    // Clear stale overlays from the finished encounter
    setRollResultOverlay(null);
    setSpectatorRoll(null);
    spectatorQueueRef.current = [];
  }, [clearEncounterResult]);

  // ── Action tooltip (long-press) ──
  const ACTION_TOOLTIPS = {
    attack: 'Roll d20 + attack bonus vs monster AC. On hit, roll damage dice. Nat 20 = critical hit (double damage). Nat 1 = fumble (auto-miss).',
    defend: 'Take the Dodge action. All attacks against you have disadvantage until your next turn.',
    help: 'Help an ally. They gain advantage on their next attack roll.',
    flee: 'Attempt to escape the encounter. You leave the fight immediately but forfeit any rewards.',
    potion: 'Use a healing potion from your inventory. Heals yourself or revives a knocked out ally. Uses your action.',
    layonhands: 'Channel divine energy to heal a target. Choose a specific amount from your healing pool. Uses your action.',
    stunning_strike: 'Toggle ON before attacking. On hit, spend 1 Ki to force a CON save. On fail, the target is Stunned until your next turn (can\'t act, auto-fail STR/DEX saves, attacks against it have advantage).',
    patient_defense: 'Spend 1 Ki as a bonus action to take the Dodge action. All attacks against you have disadvantage until your next turn.',
    fist_of_unbroken_air: 'Spend 2 Ki to blast a creature with compressed air. STR save vs Ki DC. On fail: 3d10 bludgeoning + knocked prone. On save: half damage.',
    concentration: "You can only concentrate on one spell at a time. Taking damage forces a CON save (DC 10 or half damage taken). Casting another concentration spell ends this one.",
    hunters_mark: "Hunter's Mark (1st level, Concentration). Mark a target — deal +1d6 bonus damage on every hit. Lasts the whole encounter. Casting another concentration spell (like Ensnaring Strike) ends it.",
    ensnaring_strike: "Ensnaring Strike (1st level, Concentration). On your next hit, thorny vines erupt — the target must make a STR save or become Ensnared (restrained, takes 1d6 piercing/turn). Tap to cancel before attacking.",
  };

  const tooltipShownRef = useRef(false);

  const startTooltip = useCallback((action) => {
    tooltipShownRef.current = false;
    tooltipTimerRef.current = setTimeout(() => {
      tooltipShownRef.current = true;
      setActionTooltip(action);
    }, 400);
  }, []);

  const cancelTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setActionTooltip(null);
  }, []);

  const handleActionClick = useCallback((action) => {
    // Suppress click if tooltip was shown (long-press)
    if (tooltipShownRef.current) {
      tooltipShownRef.current = false;
      return;
    }
    handleAction(action);
  }, [handleAction]);

  // ── Weapon picker (attack) ──
  const handleAttackClick = useCallback(async () => {
    if (tooltipShownRef.current) {
      tooltipShownRef.current = false;
      return;
    }
    if (!activeEncounter) return;
    try {
      const data = await api(`/api/encounters/${activeEncounter.id}/weapons`);
      const weapons = data.weapons || [];
      if (weapons.length === 0) {
        // No weapons at all — proceed with fists
        handleAction('attack', null);
      } else {
        // Always show weapon picker so player can see stats
        setAvailableWeapons(weapons);
        setWeaponModalOpen(true);
      }
    } catch (err) {
      console.error('Failed to load weapons:', err);
    }
  }, [activeEncounter?.id, handleAction]);

  const handleWeaponSelect = useCallback((weapon) => {
    setWeaponModalOpen(false);
    handleAction('attack', weapon);
  }, [handleAction]);

  // ── Potion use flow ──
  const handlePotionUse = useCallback(async (potion, targetId) => {
    setPotionTargetModal(null);
    setPotionModalOpen(false);
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;

    setActionChosen('potion');
    rollActiveRef.current = true;

    try {
      setRollPhase('potion_roll');
      const myP = activeEncounter.participants[user.id];
      const pName = myP?.name || 'Player';
      const healDice = potion.heal_dice || '2d4+2';
      const { dice, modifier } = parseDamageNotation(healDice);

      const { total: healTotal } = await requestServerRoll(
        dice, modifier, '#22c55e', `${pName} uses ${potion.name}`, myDiceColorset
      );

      // Determine target info for overlay
      const targetP = activeEncounter.participants[targetId];
      const targetName = targetId === user.id ? pName : (targetP?.name || 'Ally');
      const targetMaxHp = targetId === user.id ? myP.maxHp : (targetP?.maxHp || 0);
      const targetCurrentHp = targetId === user.id ? myP.currentHp : (targetP?.currentHp || 0);
      const isRevive = targetP?.knockedOut;
      playArenaSound(isRevive ? 'revive' : 'healGulp');
      if (isRevive) playArenaSound('crowdCheer');
      const newHp = isRevive ? healTotal : Math.min(targetMaxHp, targetCurrentHp + healTotal);

      // Show heal result overlay
      const healOverlay = {
        type: 'heal',
        healAmount: healTotal,
        potionName: potion.name,
        healer: { name: pName, avatar: myP?.avatar || (myP?.sprite && `/players/${myP.sprite}`) },
        target: { name: targetName, avatar: targetP?.avatar || (targetP?.sprite && `/players/${targetP.sprite}`) },
        newHp,
        maxHp: targetMaxHp,
        revived: isRevive,
        sounds: isRevive ? ['revive', 'crowdCheer'] : ['healGulp'],
      };
      broadcastRollResult(healOverlay);
      await showRollResult(healOverlay);

      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'potion',
          potionId: potion.item_id,
          targetId,
          healRoll: healTotal,
        }),
      });

      // Refresh potions after use
      api(`/api/encounters/${activeEncounter.id}/potions`)
        .then(data => setPotions(data.potions || []))
        .catch(() => { });

      setRollPhase(null);
    } catch (err) {
      console.error('Failed to use potion:', err);
      setActionChosen(null);
      setRollPhase(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, actionChosen, user?.id, requestServerRoll, broadcastRollResult]);

  const handlePotionSelect = useCallback((potion) => {
    // Show all allies as potential targets (including downed allies for revival)
    const allies = Object.entries(activeEncounter?.participants || {})
      .filter(([uid, p]) => uid !== user?.id && (p.knockedOut || p.currentHp < p.maxHp))
      .map(([uid, p]) => ({ id: uid, name: p.name, avatar: p.avatar || (p.sprite && `/players/${p.sprite}`), currentHp: p.currentHp, maxHp: p.maxHp }));

    if (allies.length > 0) {
      // Show target picker: self + all living allies
      setPotionModalOpen(false);
      const myP = activeEncounter.participants[user.id];
      setPotionTargetModal({
        potion, targets: [
          { id: user.id, name: 'Yourself', currentHp: myP?.currentHp, maxHp: myP?.maxHp },
          ...allies,
        ]
      });
    } else {
      // Solo encounter — auto-target self
      setPotionModalOpen(false);
      handlePotionUse(potion, user.id);
    }
  }, [activeEncounter, user?.id, handlePotionUse]);

  // ── Help action flow ──
  const handleHelpSelect = useCallback(async (targetId) => {
    setHelpTargetModal(false);
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;

    setActionChosen('help');
    try {
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'help', helpTargetId: targetId }),
      });
    } catch (err) {
      console.error('Failed to submit help action:', err);
      setActionChosen(null);
    }
  }, [activeEncounter, actionChosen]);

  const handleHelpClick = useCallback(() => {
    // Get valid allies (alive, not KO, not self)
    const allies = Object.entries(activeEncounter?.participants || {})
      .filter(([uid, p]) => uid !== user?.id && !p.knockedOut)
      .map(([uid, p]) => ({ id: uid, name: p.name, avatar: p.avatar }));

    if (allies.length === 0) return;
    if (allies.length === 1) {
      // Only one valid ally — auto-select
      handleHelpSelect(allies[0].id);
    } else {
      setHelpTargetModal(true);
    }
  }, [activeEncounter, user?.id, handleHelpSelect]);

  // ── Lay on Hands flow ──
  const handleLayOnHandsClick = useCallback(() => {
    const myP = activeEncounter?.participants?.[user?.id];
    const remaining = (myP?.layOnHandsPool || 0) - (myP?.layOnHandsUsed || 0);
    if (remaining <= 0) return;

    // Valid targets: self (if hurt) or hurt/KO allies
    const targets = [];
    for (const [uid, p] of Object.entries(activeEncounter?.participants || {})) {
      if (p.knockedOut || p.currentHp < p.maxHp) {
        targets.push({ id: uid, name: uid === user?.id ? 'Yourself' : p.name, avatar: p.avatar, knockedOut: p.knockedOut, currentHp: p.currentHp, maxHp: p.maxHp });
      }
    }
    if (targets.length === 0) return;
    setLohTarget(null);
    setLohAmount(1);
    setLohModalOpen(true);
  }, [activeEncounter, user?.id]);

  const handleLayOnHandsConfirm = useCallback(async (targetId, amount) => {
    setLohModalOpen(false);
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;

    setActionChosen('lay_on_hands');
    try {
      const myP = activeEncounter.participants[user.id];
      const pName = myP?.name || 'Player';
      const targetP = activeEncounter.participants[targetId];
      const targetName = targetId === user.id ? pName : (targetP?.name || 'Ally');
      const isRevive = targetP?.knockedOut;
      const targetMaxHp = targetId === user.id ? myP.maxHp : (targetP?.maxHp || 0);
      const targetCurrentHp = targetId === user.id ? myP.currentHp : (targetP?.currentHp || 0);
      const newHp = isRevive ? amount : Math.min(targetMaxHp, targetCurrentHp + amount);
      playArenaSound(isRevive ? 'revive' : 'healShimmer');
      if (isRevive) playArenaSound('crowdCheer');

      // Show heal overlay (no dice roll needed)
      const healOverlay = {
        type: 'heal',
        healAmount: amount,
        potionName: 'Lay on Hands',
        healer: { name: pName, avatar: myP?.avatar || (myP?.sprite && `/players/${myP.sprite}`) },
        target: { name: targetName, avatar: targetP?.avatar || (targetP?.sprite && `/players/${targetP.sprite}`) },
        newHp,
        maxHp: targetMaxHp,
        revived: isRevive,
        sounds: isRevive ? ['revive', 'crowdCheer'] : ['healShimmer'],
      };
      broadcastRollResult(healOverlay);
      await showRollResult(healOverlay);

      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'lay_on_hands',
          targetId,
          healAmount: amount,
        }),
      });
      setRollPhase(null);
    } catch (err) {
      console.error('Failed lay on hands:', err);
      setActionChosen(null);
      setRollPhase(null);
    }
  }, [activeEncounter, actionChosen, user?.id, broadcastRollResult]);

  // ── Monster save roll helper (used by Nature's Wrath, spell casters, etc.) ──
  const rollMonsterSave = useCallback(async ({ saveAbility, spellName, castSound, failSound }) => {
    const monsterData = activeEncounter.monster;
    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';

    setRollPhase('spell_save_roll');
    const saveBonus = monsterData.savingThrows?.[saveAbility] ?? 0;
    const saveLabel = `${monsterData.name} rolls ${saveAbility} save`;
    const { rolls: saveRolls } = await requestServerRoll(
      '1d20', saveBonus, '#ef4444', saveLabel, '#ef4444',
      undefined, undefined, { rollingLabel: saveLabel }
    );
    const saveRoll = saveRolls[0];
    const saveTotal = saveRoll + saveBonus;
    const saveDC = myStats?.spellSaveDC || myStats?.kiSaveDC || 0;
    const saved = saveTotal >= saveDC;

    const failSounds = failSound ? [castSound, failSound] : [castSound, 'crowdCheer'];
    const saveOverlay = {
      type: 'spell_save',
      spellName,
      saveAbility,
      saveRoll, saveBonus, saveTotal, saveDC, saved,
      attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
      defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
      sounds: saved ? [castSound, 'spellFail', 'crowdGasp'] : failSounds,
    };
    broadcastRollResult(saveOverlay);
    if (saved) { playArenaSound('spellFail'); playArenaSound('crowdGasp'); }
    else { playArenaSound(failSound || 'crowdCheer'); }
    await showRollResult(saveOverlay);

    return { saveRoll, saveTotal, saveBonus, saveDC, saved };
  }, [activeEncounter, user?.id, requestServerRoll, broadcastRollResult, showRollResult]);

  // ── Nature's Wrath handler ──
  const handleNaturesWrath = useCallback(async () => {
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;
    setActionChosen('channel_divinity');
    rollActiveRef.current = true;

    try {
      const monsterData = activeEncounter.monster;
      // Monster picks best save (STR or DEX — whichever bonus is higher)
      const strBonus = monsterData.savingThrows?.STR ?? 0;
      const dexBonus = monsterData.savingThrows?.DEX ?? 0;
      const saveAbility = strBonus >= dexBonus ? 'STR' : 'DEX';

      const { saveRoll, saved } = await rollMonsterSave({
        saveAbility,
        spellName: "Nature's Wrath",
        castSound: 'ensnaringStrike',
      });

      // Show vine animation on failed save (same as Ensnaring Strike)
      if (!saved) setVineEffect(true);

      // Submit to server with the visual roll value
      setRollPhase('submitting');
      const res = await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'channel_divinity',
          subAction: 'natures_wrath',
          saveRoll,
        }),
      });
      if (res.error) {
        setActionChosen(null);
      }
      setRollPhase(null);
    } catch (err) {
      console.error('Failed Nature\'s Wrath:', err);
      setActionChosen(null);
      setRollPhase(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, actionChosen, rollMonsterSave, broadcastRollResult, showRollResult]);

  // ── Ensnaring Strike handler (works as both pre-bonus and post-action bonus) ──
  const handleEnsnaringStrike = useCallback(async () => {
    if (!activeEncounter) return;
    const endpoint = bonusActionPhase
      ? `/api/encounters/${activeEncounter.id}/bonus-action`
      : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;
    try {
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ bonusAction: 'ensnaring_strike' }),
      });
      if (res.error) {
        console.error('Ensnaring Strike failed:', res.error);
      }
      if (bonusActionPhase) {
        setBonusActionPhase(false);
        setAvailableBonusActions([]);
      }
    } catch (err) {
      console.error('Failed Ensnaring Strike:', err);
    }
  }, [activeEncounter, bonusActionPhase]);

  // ── Hunter's Mark handler (works as both pre-bonus and post-action bonus) ──
  const handleHuntersMark = useCallback(async () => {
    if (!activeEncounter) return;
    // Concentration conflict check
    const myS = activeEncounter.participants[user.id];
    if (myS?.concentration && myS.concentration.spellId !== 'hunters_mark') {
      const currentName = CONCENTRATION_SPELL_NAMES[myS.concentration.spellId] || myS.concentration.spellId;
      setConcentrationConflict({
        currentSpell: currentName,
        newSpell: "Hunter's Mark",
        onConfirm: () => handleHuntersMark(),
      });
      return;
    }
    setEnsnaringStrikeToggle(false);
    const endpoint = bonusActionPhase
      ? `/api/encounters/${activeEncounter.id}/bonus-action`
      : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;
    try {
      playArenaSound('spellCast');
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ bonusAction: 'hunters_mark' }),
      });
      if (res.error) {
        console.error("Hunter's Mark failed:", res.error);
      }
      if (bonusActionPhase) {
        setBonusActionPhase(false);
        setAvailableBonusActions([]);
      }
    } catch (err) {
      console.error("Failed Hunter's Mark:", err);
    }
  }, [activeEncounter, bonusActionPhase]);

  // ── Drop Concentration handler (voluntarily end Hunter's Mark / Ensnaring Strike) ──
  const handleDropConcentration = useCallback(async () => {
    if (!activeEncounter) return;
    try {
      playSound('buttonTap');
      const res = await api(`/api/encounters/${activeEncounter.id}/drop-concentration`, {
        method: 'POST',
      });
      if (res.error) {
        console.error('Drop concentration failed:', res.error);
      }
    } catch (err) {
      console.error('Failed to drop concentration:', err);
    }
  }, [activeEncounter]);

  // ── Fist of Unbroken Air handler (Way of the Four Elements, main action, 2 ki) ──
  const handleFistOfUnbrokenAir = useCallback(async () => {
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;
    setActionChosen('ki_ability');
    rollActiveRef.current = true;

    try {
      const myStats = activeEncounter.participants[user.id];
      const pName = myStats?.name || 'Player';
      const monsterData = activeEncounter.monster;

      // Roll STR save (visible d20)
      const { saveRoll, saved } = await rollMonsterSave({
        saveAbility: 'STR',
        spellName: 'Fist of Unbroken Air',
        castSound: 'spellCast',
      });

      // Roll 3d10 damage (visible dice — golden ki color)
      setRollPhase('damage_roll');
      playArenaSound('fistOfUnbrokenAir');
      const { total: rawDamage } = await requestServerRoll(
        '3d10', 0, '#f0c040', saved ? `${pName} — half damage` : `${pName} — full damage!`, myDiceColorset
      );
      const damageTotal = saved ? Math.floor(rawDamage / 2) : rawDamage;
      if (damageTotal >= 20) playArenaSound('bigDamage');

      const dmgOverlay = {
        type: 'damage',
        damage: damageTotal,
        isCrit: false,
        monsterHp: monsterData.currentHp,
        newHp: Math.max(0, monsterData.currentHp - damageTotal),
        attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
        defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
        sounds: damageTotal >= 20 ? ['bigDamage'] : [],
      };
      broadcastRollResult(dmgOverlay);
      await showRollResult(dmgOverlay);

      // Submit to server
      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'ki_ability',
          subAction: 'fist_of_unbroken_air',
          saveRoll,
          damageTotal: rawDamage, // send raw — server halves on save
        }),
      });

      setRollPhase(null);
    } catch (err) {
      console.error('Failed Fist of Unbroken Air:', err);
      setActionChosen(null);
      setRollPhase(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, actionChosen, user?.id, rollMonsterSave, requestServerRoll, broadcastRollResult, showRollResult, myDiceColorset]);

  // ── Flurry of Blows handler (Monk, post-attack bonus — 2 visible unarmed strikes) ──
  const handleFlurryOfBlows = useCallback(async () => {
    if (!activeEncounter || rollActiveRef.current) return;
    setActionChosen('flurry_of_blows');
    setBonusActionPhase(false);
    setAvailableBonusActions([]);

    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';
    const monsterData = activeEncounter.monster;
    const unarmed = (myStats.weapons || []).find(w => w.id === 'unarmed_strike')
      || { attackBonus: myStats.attackBonus || 2, damageMod: myStats.damageMod || 0, dice: '1d4' };

    // Check if monster has conditions that grant attackers advantage (e.g. stunned, restrained)
    const monsterGivesAdvantage = (monsterData.conditions || []).some(c =>
      c.id === 'stunned' || c.id === 'restrained'
    );
    const flurryAdvantage = monsterGivesAdvantage || myStats.advantageOnNextAttack;
    const flurryDiceNotation = flurryAdvantage ? '2d20' : '1d20';

    rollActiveRef.current = true;
    const clientStrikes = [];

    try {
      for (let i = 0; i < 2; i++) {
        const strikeLabel = i === 0 ? 'Flurry — Strike 1' : 'Flurry — Strike 2';

        // Roll attack d20 (2d20 with advantage if monster is stunned/restrained)
        setRollPhase('attack_roll');
        const { rolls: atkRolls } = await requestServerRoll(
          flurryDiceNotation, unarmed.attackBonus, '#f0c040', `${pName} ${strikeLabel}`, myDiceColorset,
          undefined, flurryAdvantage ? 'advantage' : undefined
        );
        let usedRoll;
        if (flurryAdvantage && atkRolls.length >= 2) {
          usedRoll = Math.max(atkRolls[0], atkRolls[1]);
        } else {
          usedRoll = atkRolls[0];
        }
        const total = usedRoll + unarmed.attackBonus;
        const isNat20 = usedRoll === 20;
        const isNat1 = usedRoll === 1;
        const isHit = isNat20 || (!isNat1 && total >= monsterData.ac);

        // Sound + overlay
        if (isNat20) { playArenaSound('attackCrit'); playArenaSound('crowdCheer'); }
        else if (isNat1) { playArenaSound('attackFumble'); playArenaSound('crowdGasp'); playArenaSound('youSuck'); }
        else if (isHit) playArenaSound('attackHit');
        else playArenaSound('attackMiss');

        const attackOverlay = {
          type: 'attack',
          total,
          breakdown: `${usedRoll} + ${unarmed.attackBonus}`,
          targetAC: monsterData.ac,
          isHit, isCrit: isNat20, isFumble: isNat1,
          label: strikeLabel,
          attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
          defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
          advantageType: flurryAdvantage ? 'advantage' : undefined,
          roll1: flurryAdvantage ? atkRolls[0] : undefined,
          roll2: flurryAdvantage && atkRolls.length >= 2 ? atkRolls[1] : undefined,
          attackBonus: unarmed.attackBonus,
          sounds: isNat20 ? ['attackCrit', 'crowdCheer'] : isNat1 ? ['attackFumble', 'crowdGasp', 'youSuck'] : isHit ? ['attackHit'] : ['attackMiss'],
        };
        broadcastRollResult(attackOverlay);
        await showRollResult(attackOverlay);

        let damageTotal = 0;
        if (isHit) {
          setRollPhase('damage_roll');
          const baseDmgNotation = unarmed.dice;
          const weaponNotation = isNat20 ? doubleDice(baseDmgNotation) : baseDmgNotation;
          const critLabel = isNat20 ? `${pName} crits!` : `${pName} rolls damage`;

          playArenaSound('damageImpact');
          const { total: dmgTotal } = await requestServerRoll(
            weaponNotation, unarmed.damageMod, '#f0c040', critLabel, myDiceColorset
          );
          damageTotal = dmgTotal;

          const dmgOverlay = {
            type: 'damage',
            damage: damageTotal,
            isCrit: isNat20,
            monsterHp: monsterData.currentHp,
            newHp: Math.max(0, monsterData.currentHp - damageTotal),
            attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
            defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
            sounds: [],
          };
          broadcastRollResult(dmgOverlay);
          await showRollResult(dmgOverlay);

          // Optimistically update monster HP for next strike's overlay
          monsterData.currentHp = Math.max(0, monsterData.currentHp - damageTotal);

          // Monster killed — skip remaining strikes
          if (monsterData.currentHp <= 0) {
            clientStrikes.push({ attackRoll: usedRoll, damageTotal });
            break;
          }
        }

        clientStrikes.push({ attackRoll: usedRoll, damageTotal });
      }

      // Submit to server with client-provided rolls
      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/bonus-action`, {
        method: 'POST',
        body: JSON.stringify({
          bonusAction: 'flurry_of_blows',
          strikes: clientStrikes,
        }),
      });

      setRollPhase(null);
    } catch (err) {
      console.error('Failed Flurry of Blows:', err);
      setRollPhase(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, requestServerRoll, broadcastRollResult, showRollResult, myDiceColorset]);

  // ── Patient Defense handler (Monk, pre or post bonus action) ──
  const handlePatientDefense = useCallback(async () => {
    if (!activeEncounter) return;
    const endpoint = bonusActionPhase
      ? `/api/encounters/${activeEncounter.id}/bonus-action`
      : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;
    try {
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ bonusAction: 'patient_defense' }),
      });
      if (res.error) {
        console.error('Patient Defense failed:', res.error);
      }
      if (bonusActionPhase) {
        setBonusActionPhase(false);
        setAvailableBonusActions([]);
      }
    } catch (err) {
      console.error('Failed Patient Defense:', err);
    }
  }, [activeEncounter, bonusActionPhase]);

  // ── Bonus action handlers ──
  const handleBonusActionSkip = useCallback(async () => {
    if (!activeEncounter) return;
    try {
      await api(`/api/encounters/${activeEncounter.id}/bonus-action`, {
        method: 'POST',
        body: JSON.stringify({ bonusAction: 'skip' }),
      });
      setBonusActionPhase(false);
      setAvailableBonusActions([]);
    } catch (err) {
      console.error('Failed to skip bonus action:', err);
    }
  }, [activeEncounter]);

  const handleBonusPotionSelf = useCallback(async (potion) => {
    setPotionModalOpen(false);
    if (!activeEncounter || rollActiveRef.current) return;

    rollActiveRef.current = true;
    try {
      setRollPhase('potion_roll');
      const myP = activeEncounter.participants[user.id];
      const pName = myP?.name || 'Player';
      const healDice = potion.heal_dice || '2d4+2';
      const { dice, modifier } = parseDamageNotation(healDice);

      const { total: healTotal } = await requestServerRoll(
        dice, modifier, '#22c55e', `${pName} uses ${potion.name}`, myDiceColorset
      );

      const targetMaxHp = myP.maxHp;
      const targetCurrentHp = myP.currentHp;
      const newHp = Math.min(targetMaxHp, targetCurrentHp + healTotal);
      playArenaSound('healGulp');

      const healOverlay = {
        type: 'heal',
        healAmount: healTotal,
        potionName: potion.name,
        healer: { name: pName, avatar: myP?.avatar || (myP?.sprite && `/players/${myP.sprite}`) },
        target: { name: pName, avatar: myP?.avatar || (myP?.sprite && `/players/${myP.sprite}`) },
        newHp,
        maxHp: targetMaxHp,
        revived: false,
        sounds: ['healGulp'],
      };
      broadcastRollResult(healOverlay);
      await showRollResult(healOverlay);

      await api(`/api/encounters/${activeEncounter.id}/bonus-action`, {
        method: 'POST',
        body: JSON.stringify({
          bonusAction: 'potion_self',
          potionId: potion.item_id,
          healRoll: healTotal,
        }),
      });

      // Refresh potions after use
      api(`/api/encounters/${activeEncounter.id}/potions`)
        .then(data => setPotions(data.potions || []))
        .catch(() => { });

      setRollPhase(null);
      setBonusActionPhase(false);
      setAvailableBonusActions([]);
    } catch (err) {
      console.error('Failed bonus potion:', err);
      setRollPhase(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, requestServerRoll, broadcastRollResult]);

  const handleBardicInspiration = useCallback(async (targetId) => {
    setInspirationTargetModal(false);
    if (!activeEncounter) return;

    try {
      // Use pre-bonus-action if player hasn't taken their main action yet,
      // otherwise use the post-action bonus-action endpoint
      const endpoint = bonusActionPhase
        ? `/api/encounters/${activeEncounter.id}/bonus-action`
        : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;

      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          bonusAction: 'bardic_inspiration',
          targetId,
        }),
      });
      playArenaSound('bardicInspiration');
      setBonusActionPhase(false);
      setAvailableBonusActions([]);
    } catch (err) {
      console.error('Failed bardic inspiration:', err);
    }
  }, [activeEncounter, bonusActionPhase]);

  // ── Shared monster saving throw (visible 3D d20 + overlay) ──
  // ── Spell casting handlers ──

  const handleSpellClick = useCallback(async () => {
    const enc = activeEncounterRef.current;
    if (!enc) return;
    try {
      const data = await api(`/api/encounters/${enc.id}/spells`);
      const spells = data.spells || [];

      // Inject pre-bonus spells (Ensnaring Strike, Hunter's Mark) into spell list
      const myS = enc.participants[user?.id];
      const preBonusSpells = [];
      const preBonusActions = myS?.availablePreBonusActions || [];
      if (preBonusActions.find(a => a.type === 'ensnaring_strike') && !ensnaringStrikeToggle) {
        preBonusSpells.push({
          id: 'ensnaring_strike', name: 'Ensnaring Strike', level: 1,
          actionType: 'bonus', damageDice: '1d6', damageType: 'piercing',
          description: 'The next creature you hit with a weapon attack becomes restrained by magical vines.',
          isBonusAbility: true,
        });
      }
      if (preBonusActions.find(a => a.type === 'hunters_mark')) {
        preBonusSpells.push({
          id: 'hunters_mark', name: "Hunter's Mark", level: 1,
          actionType: 'bonus', damageDice: '1d6', damageType: 'per hit',
          description: 'Mark a creature as your quarry, dealing extra 1d6 damage on weapon hits.',
          isBonusAbility: true,
        });
      }

      const allSpells = [...preBonusSpells, ...spells];
      if (allSpells.length === 0) return;
      setAvailableSpells(allSpells);
      setSpellModalOpen(true);
    } catch (err) {
      console.error('Failed to load spells:', err);
    }
  }, [user?.id, ensnaringStrikeToggle]);

  const handleCastSpell = useCallback(async (spell) => {
    if (!activeEncounter || rollActiveRef.current) return;
    // Concentration conflict check
    const myS = activeEncounter.participants[user.id];
    if (spell.concentration && myS?.concentration && myS.concentration.spellId !== spell.id) {
      setSpellModalOpen(false);
      const currentName = CONCENTRATION_SPELL_NAMES[myS.concentration.spellId] || myS.concentration.spellId;
      setConcentrationConflict({
        currentSpell: currentName,
        newSpell: spell.name,
        onConfirm: () => handleCastSpell(spell),
      });
      return;
    }
    // Heal spells open a target picker instead of rolling damage
    if (spell.effectType === 'heal') {
      setSpellModalOpen(false);
      setHealSpellTargetModal(spell);
      return;
    }

    setSpellModalOpen(false);
    setCastingSpell(spell);
    setActionChosen('cast_spell');
    rollActiveRef.current = true;

    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';
    const monsterData = activeEncounter.monster;

    try {
      // Step 1: Roll monster's saving throw (shared helper)
      const isElectric = spell.damageType === 'thunder' || spell.damageType === 'lightning';
      const isViciousMockery = spell.id === 'vicious_mockery';
      // Electric/mockery sounds play on damage/fail, not on cast
      const deferSound = isElectric || isViciousMockery;
      const castSound = isViciousMockery ? 'viciousMockery' : isElectric ? 'electricSpell' : 'spellCast';
      if (!deferSound) playArenaSound(castSound);

      const { saveRoll, saved } = await rollMonsterSave({
        saveAbility: spell.saveAbility,
        spellName: spell.name,
        castSound: deferSound ? 'spellCast' : castSound,
        failSound: isViciousMockery ? 'viciousMockery' : undefined,
      });

      let damageTotal = 0;

      // Step 3: If save failed, roll damage
      if (!saved) {
        setRollPhase('spell_damage_roll');
        // Electric sound plays on damage; mockery already played on save result
        playArenaSound(isElectric ? 'electricSpell' : 'damageImpact');
        const { total: dmgTotal } = await requestServerRoll(
          spell.damageDice, 0, '#eab308', `${spell.name} damage`, myDiceColorset
        );
        damageTotal = dmgTotal;
        if (damageTotal >= 20 && damageTotal < 30) playArenaSound('bigDamage');
        if (damageTotal >= 30) playArenaSound('massiveDamage');

        // Show damage overlay
        const spellDmgSounds = [];
        if (damageTotal >= 20 && damageTotal < 30) spellDmgSounds.push('bigDamage');
        if (damageTotal >= 30) spellDmgSounds.push('massiveDamage');
        const dmgOverlay = {
          type: 'damage',
          damage: damageTotal,
          isCrit: false,
          monsterHp: monsterData.currentHp,
          newHp: Math.max(0, monsterData.currentHp - damageTotal),
          attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
          defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
          sounds: spellDmgSounds,
        };
        broadcastRollResult(dmgOverlay);
        await showRollResult(dmgOverlay);
      }

      // Step 4: Submit to server
      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'cast_spell',
          spellId: spell.id,
          saveRoll,
          damageTotal,
        }),
      });

      setRollPhase(null);
      setCastingSpell(null);
    } catch (err) {
      console.error('Failed to cast spell:', err);
      setActionChosen(null);
      setRollPhase(null);
      setCastingSpell(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, requestServerRoll, broadcastRollResult, showRollResult]);

  const handleHealSpellCast = useCallback(async (spell, targetId) => {
    setHealSpellTargetModal(null);
    if (!activeEncounter || rollActiveRef.current) return;

    setCastingSpell(spell);
    setActionChosen('cast_spell');
    rollActiveRef.current = true;

    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';
    const spellMod = myStats?.spellcastingMod || 0;

    try {
      // Roll heal dice
      const { total: healRoll } = await requestServerRoll(
        spell.healDice, spellMod, '#4ade80', `${pName} casts ${spell.name}`, '#4ade80'
      );

      const healAmount = healRoll;
      const rawDice = healRoll - spellMod;
      const target = activeEncounter.participants[targetId];
      const targetName = target?.name || 'Ally';
      playArenaSound(target?.knockedOut ? 'revive' : 'healShimmer');
      if (target?.knockedOut) playArenaSound('crowdCheer');

      // Show heal overlay
      const healOverlay = {
        type: 'heal',
        healAmount,
        potionName: spell.name,
        isSpell: true,
        diceNotation: spell.healDice,
        diceRoll: rawDice,
        spellMod,
        healer: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
        target: { name: targetName, avatar: target?.avatar || (target?.sprite && `/players/${target.sprite}`) },
        newHp: Math.min(target?.maxHp || 0, (target?.currentHp || 0) + healAmount),
        maxHp: target?.maxHp || 0,
        revived: target?.knockedOut || false,
        sounds: target?.knockedOut ? ['revive', 'crowdCheer'] : ['healShimmer'],
      };
      broadcastRollResult(healOverlay);
      await showRollResult(healOverlay);

      // Submit to main action endpoint
      setRollPhase('submitting');
      await api(`/api/encounters/${activeEncounter.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'cast_spell',
          spellId: spell.id,
          targetId,
          healRoll: rawDice, // server adds spellcastingMod
        }),
      });

      setRollPhase(null);
      setCastingSpell(null);
    } catch (err) {
      console.error(`Failed ${spell.name}:`, err);
      setActionChosen(null);
      setRollPhase(null);
      setCastingSpell(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, requestServerRoll, broadcastRollResult, showRollResult]);

  const handleHealingWord = useCallback(async (targetId) => {
    setHealingWordTargetModal(false);
    if (!activeEncounter || rollActiveRef.current) return;

    // Clear bonus action UI and show status text during rolls
    setActionChosen('healing_word');
    setBonusActionPhase(false);
    setAvailableBonusActions([]);

    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';
    const spellMod = myStats?.spellcastingMod || 0;

    rollActiveRef.current = true;
    try {
      // Roll 1d4 for healing
      const { total: healRoll } = await requestServerRoll(
        '1d4', spellMod, '#4ade80', `${pName} casts Healing Word`, '#4ade80'
      );

      const healAmount = healRoll;
      const rawDice = healRoll - spellMod;
      const target = activeEncounter.participants[targetId];
      const targetName = target?.name || 'Ally';
      playArenaSound(target?.knockedOut ? 'revive' : 'healShimmer');
      if (target?.knockedOut) playArenaSound('crowdCheer');

      // Show heal overlay
      const healOverlay = {
        type: 'heal',
        healAmount,
        potionName: 'Healing Word',
        isSpell: true,
        diceNotation: '1d4',
        diceRoll: rawDice,
        spellMod,
        healer: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
        target: { name: targetName, avatar: target?.avatar || (target?.sprite && `/players/${target.sprite}`) },
        newHp: Math.min(target?.maxHp || 0, (target?.currentHp || 0) + healAmount),
        maxHp: target?.maxHp || 0,
        revived: target?.knockedOut || false,
        sounds: target?.knockedOut ? ['revive', 'crowdCheer'] : ['healShimmer'],
      };
      broadcastRollResult(healOverlay);
      await showRollResult(healOverlay);

      // Submit to bonus action endpoint
      const endpoint = bonusActionPhase
        ? `/api/encounters/${activeEncounter.id}/bonus-action`
        : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          bonusAction: 'healing_word',
          targetId,
          healRoll: healRoll - spellMod, // server adds spellcastingMod, so send raw dice roll
        }),
      });
    } catch (err) {
      console.error('Failed Healing Word:', err);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, bonusActionPhase, requestServerRoll, broadcastRollResult, showRollResult]);

  // ── Offhand attack (bonus action) ──
  const [offhandWeaponModal, setOffhandWeaponModal] = useState(false);

  const handleOffhandClick = useCallback(() => {
    const offhandAction = availableBonusActions.find(a => a.type === 'offhand_attack');
    if (!offhandAction) return;
    const weapons = offhandAction.weapons || [];
    if (weapons.length === 1) {
      handleOffhandAttack(weapons[0]);
    } else {
      setOffhandWeaponModal(true);
    }
  }, [availableBonusActions]);

  const handleOffhandAttack = useCallback(async (weapon) => {
    setOffhandWeaponModal(false);
    if (!activeEncounter || rollActiveRef.current) return;

    // Clear bonus action UI and show status text during rolls
    setActionChosen('offhand_attack');
    setBonusActionPhase(false);
    setAvailableBonusActions([]);

    const myStats = activeEncounter.participants[user.id];
    const pName = myStats?.name || 'Player';
    const monsterData = activeEncounter.monster;
    const atkBonus = weapon.attackBonus;

    // 5e Advantage/Disadvantage: Vex, monster conditions, etc.
    const monsterGivesAdv = (monsterData.conditions || []).some(c =>
      c.id === 'stunned' || c.id === 'restrained'
    );
    const hasAdvantage = myStats.advantageOnNextAttack || monsterGivesAdv;
    const advantageType = hasAdvantage ? 'advantage' : 'normal';
    const diceNotation = advantageType !== 'normal' ? '2d20' : '1d20';

    rollActiveRef.current = true;
    try {
      // Roll d20 to attack
      setRollPhase('attack_roll');
      const advParam = advantageType !== 'normal' ? advantageType : undefined;
      const { rolls: atkRolls } = await requestServerRoll(
        diceNotation, atkBonus, '#eab308', `${pName} offhand attack (${weapon.name})`, myDiceColorset, undefined, advParam
      );

      let roll, roll2, usedRoll;
      if (advantageType !== 'normal' && atkRolls.length >= 2) {
        roll = atkRolls[0];
        roll2 = atkRolls[1];
        usedRoll = advantageType === 'advantage' ? Math.max(roll, roll2) : Math.min(roll, roll2);
      } else {
        roll = atkRolls[0];
        roll2 = null;
        usedRoll = roll;
      }

      const total = usedRoll + atkBonus;
      const isNat20 = usedRoll === 20;
      const isNat1 = usedRoll === 1;
      const isHit = isNat20 || (!isNat1 && total >= monsterData.ac);

      setAttackResult({ roll: usedRoll, total, isHit, isNat20, isNat1 });
      setRollPhase('attack_result');
      // Offhand attack result sound + crowd reaction
      if (isNat20) { playArenaSound('attackCrit'); playArenaSound('crowdCheer'); }
      else if (isNat1) { playArenaSound('attackFumble'); playArenaSound('crowdGasp'); playArenaSound('youSuck'); }
      else if (isHit) playArenaSound('attackHit');
      else playArenaSound('attackMiss');

      // Show attack result overlay
      const attackOverlay = {
        type: 'attack',
        total,
        breakdown: `${usedRoll} + ${atkBonus}`,
        targetAC: monsterData.ac,
        isHit, isCrit: isNat20, isFumble: isNat1,
        advantageType: advParam,
        roll1: advParam ? roll : undefined,
        roll2: advParam && roll2 != null ? roll2 : undefined,
        attackBonus: atkBonus,
        attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
        defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
        sounds: isNat20 ? ['attackCrit', 'crowdCheer'] : isNat1 ? ['attackFumble', 'crowdGasp', 'youSuck'] : isHit ? ['attackHit'] : ['attackMiss'],
      };
      broadcastRollResult(attackOverlay);
      await showRollResult(attackOverlay);

      let damageTotal = 0;
      let sneakAttackData = undefined;
      if (isHit) {
        setRollPhase('damage_roll');
        const dmgMod = weapon.damageMod;
        const baseDmgNotation = weapon.dice;
        const weaponNotation = isNat20 ? doubleDice(baseDmgNotation) : baseDmgNotation;
        const critLabel = isNat20 ? `${pName} crits!` : `${pName} rolls damage`;

        playArenaSound('damageImpact');
        const { total: dmgTotal } = await requestServerRoll(
          weaponNotation, dmgMod, '#eab308', critLabel, myDiceColorset
        );
        damageTotal = dmgTotal;

        // Sneak Attack — auto-roll when eligible (Rogue feature)
        if (myStats.sneakAttackDice > 0 && weapon && (weapon.finesse || weapon.ranged)) {
          const hasAlly = Object.entries(activeEncounter.participants)
            .some(([uid, p]) => uid !== user.id && !p.knockedOut);
          const isEligible = advantageType === 'advantage' || hasAlly;
          if (isEligible) {
            setRollPhase('sneak_attack_roll');
            let saDiceCount = myStats.sneakAttackDice;
            if (isNat20) saDiceCount *= 2;
            const saNotation = `${saDiceCount}d6`;
            const { total: saTotal } = await requestServerRoll(
              saNotation, 0, '#10b981', 'SNEAK ATTACK!', '#10b981', 'glass'
            );
            damageTotal += saTotal;
            sneakAttackData = { sneakAttackDamage: saTotal };
            playArenaSound('crowdCheer');
          }
        }
        if (damageTotal >= 20 && damageTotal < 30) playArenaSound('bigDamage');
        if (damageTotal >= 30) playArenaSound('massiveDamage');

        const offhandDmgSounds = [];
        if (damageTotal >= 20 && damageTotal < 30) offhandDmgSounds.push('bigDamage');
        if (damageTotal >= 30) offhandDmgSounds.push('massiveDamage');
        if (sneakAttackData) offhandDmgSounds.push('crowdCheer');
        const dmgOverlay = {
          type: 'damage',
          damage: damageTotal,
          isCrit: isNat20,
          sneakAttackDamage: sneakAttackData?.sneakAttackDamage,
          monsterHp: monsterData.currentHp,
          newHp: Math.max(0, monsterData.currentHp - damageTotal),
          attacker: { name: pName, avatar: myStats?.avatar || (myStats?.sprite && `/players/${myStats.sprite}`) },
          defender: { name: monsterData.name, avatar: monsterData.image && `/monsters/${monsterData.image}` },
          sounds: offhandDmgSounds,
        };
        broadcastRollResult(dmgOverlay);
        await showRollResult(dmgOverlay);
      }

      // Submit to bonus action endpoint
      setRollPhase('submitting');
      const endpoint = bonusActionPhase
        ? `/api/encounters/${activeEncounter.id}/bonus-action`
        : `/api/encounters/${activeEncounter.id}/pre-bonus-action`;
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          bonusAction: 'offhand_attack',
          weaponId: weapon.id,
          attackRoll: usedRoll,
          attackRoll2: roll2,
          damageTotal,
          sneakAttackData,
        }),
      });

      setRollPhase(null);
      setAttackResult(null);
    } catch (err) {
      console.error('Failed offhand attack:', err);
      setRollPhase(null);
      setAttackResult(null);
    } finally {
      rollActiveRef.current = false;
    }
  }, [activeEncounter, user?.id, bonusActionPhase, myDiceColorset, requestServerRoll, broadcastRollResult, showRollResult]);

  // ── Derived state ──
  const monster = activeEncounter?.monster;
  const isParticipant = activeEncounter?.participants?.[user?.id];
  const isKnockedOut = isParticipant?.knockedOut;
  const myStats = isParticipant ? activeEncounter.participants[user.id] : null;
  const timerSeconds = Math.ceil(timeLeft / 1000);

  const hpPercent = monster ? Math.max(0, Math.round((monster.currentHp / monster.maxHp) * 100)) : 0;
  const hpBarColor = hpPercent > 60 ? '#4ade80' : hpPercent > 30 ? '#fbbf24' : '#ef4444';

  const isMonsterRolling = rollPhase === 'monster_rolling' || rollPhase === 'monster_saving' || rollPhase === 'monster_escaping' ||
    (monsterRollRequest && monsterRollRequest.rollerId !== user?.id) ||
    (monsterSaveRequest && monsterSaveRequest.rollerId !== user?.id) ||
    (monsterEscapeRequest && monsterEscapeRequest.rollerId !== user?.id);

  // Turn-based derived state
  const currentTurnEntry = activeEncounter?.initiativeOrder?.[activeEncounter?.currentTurnIndex];
  const isMyTurn = currentTurnEntry?.id === user?.id;
  const isMonsterTurn = currentTurnEntry?.type === 'monster';

  // Config map for server-driven pre-bonus actions
  const preBonusActionConfig = {
    bardic_inspiration: {
      className: 'arena-ability-btn-inspire',
      icon: '\uD83C\uDFB5',
      label: 'Inspire',
      onClick: () => { playSound('buttonTap'); setInspirationTargetModal(true); },
      detail: (action) => `${action.usesLeft} left`,
    },
    healing_word: {
      className: 'arena-ability-btn-heal',
      icon: '\u2728',
      label: 'Healing Word',
      onClick: () => { playSound('buttonTap'); setHealingWordTargetModal(true); },
    },
    ensnaring_strike: {
      className: 'arena-ability-btn-ensnaring',
      icon: '\u{1FAB4}',
      label: 'Ensnaring Strike',
      onClick: () => {
        playSound('buttonTap');
        const myS = activeEncounter?.participants[user?.id];
        if (myS?.concentration && myS.concentration.spellId !== 'ensnaring_strike') {
          const currentName = CONCENTRATION_SPELL_NAMES[myS.concentration.spellId] || myS.concentration.spellId;
          setConcentrationConflict({
            currentSpell: currentName,
            newSpell: 'Ensnaring Strike',
            onConfirm: () => { setEnsnaringStrikeToggle(true); setAbilitiesOpen(false); },
          });
          return;
        }
        setEnsnaringStrikeToggle(true); setAbilitiesOpen(false);
      },
    },
    hunters_mark: {
      className: 'arena-ability-btn-hunters-mark',
      icon: '\uD83C\uDFAF',
      label: "Hunter's Mark",
      onClick: () => { playSound('buttonTap'); handleHuntersMark(); },
    },
    patient_defense: {
      className: 'arena-ability-btn-patient-defense',
      icon: '\uD83D\uDEE1',
      label: 'Patient Defense',
      onClick: () => { playSound('buttonTap'); handlePatientDefense(); },
      detail: () => '1 ki',
      tooltip: 'patient_defense',
    },
  };

  // ── Auto-close abilities drawer when action chosen or turn changes ──
  useEffect(() => {
    setAbilitiesOpen(false);
  }, [actionChosen, isMyTurn]);

  // Arena audio phase for SceneAudio ambient config
  // Switches to intense music when monster HP drops below 30%
  const monsterHpPct = monster ? (monster.currentHp / monster.maxHp) : 1;
  const arenaAudioPhase = encounterResult
    ? (encounterResult.type === 'victory' ? 'victory' : 'defeat')
    : (activeEncounter && monster && isParticipant)
      ? (monsterHpPct <= 0.3 ? 'battleIntense' : 'battle')
      : 'crowd';

  const getStatusText = () => {
    if (rollPhase === 'monster_rolling' || rollPhase === 'monster_saving' || rollPhase === 'monster_escaping') {
      return monsterRollStatus || 'Monster is attacking...';
    }
    if (!actionChosen) return null;
    if (rollPhase === 'attack_roll') return 'Rolling d20 to attack...';
    if (rollPhase === 'attack_result' && attackResult) {
      if (attackResult.isNat1) return `Rolled ${attackResult.roll} \u2014 NAT 1! Fumble!`;
      if (attackResult.isNat20) return `Rolled ${attackResult.roll} \u2014 NAT 20! CRITICAL HIT!`;
      if (attackResult.isHit) return `Rolled ${attackResult.total} vs AC ${monster?.ac} \u2014 Hit!`;
      return `Rolled ${attackResult.total} vs AC ${monster?.ac} \u2014 Miss!`;
    }
    if (rollPhase === 'damage_roll') {
      const label = attackResult?.isNat20 ? 'CRIT! Rolling damage...' : 'Rolling damage...';
      return `${label} (${myStats?.weaponName || 'weapon'}: ${myStats?.damageNotation || '?'})`;
    }
    if (rollPhase === 'inspiration_roll') return 'Rolling Bardic Inspiration...';
    if (rollPhase === 'spell_save_roll') return `${castingSpell?.name || 'Spell'} — rolling ${monster?.name || 'monster'}'s save...`;
    if (rollPhase === 'spell_damage_roll') return `${castingSpell?.name || 'Spell'} — rolling ${castingSpell?.effectType === 'heal' ? 'healing' : 'damage'}...`;
    if (rollPhase === 'submitting') return 'Submitting action...';
    if (actionChosen === 'flurry_of_blows') return 'Rolling Flurry of Blows...';
    if (actionChosen === 'offhand_attack') return 'Rolling offhand attack...';
    if (actionChosen === 'healing_word') return 'Casting Healing Word...';
    if (actionChosen === 'cast_spell') return `Cast ${castingSpell?.name || 'spell'}.`;
    if (actionChosen === 'attack') {
      if (attackResult && !attackResult.isHit) {
        return `Rolled ${attackResult.isNat1 ? 'NAT 1' : attackResult.total} \u2014 Miss.`;
      }
      return 'Attack submitted.';
    }
    if (actionChosen === 'help') return 'Helping an ally...';
    return `${actionChosen === 'defend' ? 'Dodging' : 'Fleeing'}...`;
  };

  // ── Result overlay (deferred until dice animations finish) ──
  // Battle screen stays visible while dice roll (encounter kept alive until dismiss).
  if (showResult) {
    return (
      <div className="arena">
        <SceneAudio config={ARENA_AUDIO_CONFIGS[arenaAudioPhase]} />
        <div className="arena-result-overlay">
          {/* Background image + confetti for victory */}
          {encounterResult.type === 'victory' && (
            <>
              <div
                className="arena-result-bg"
                style={{ backgroundImage: "url('/images/scenes/arena_exterior.webp')" }}
              />
              <VictoryConfetti />
            </>
          )}
          <div className="arena-result-card" data-testid="arena-result-card">
            {encounterResult.type === 'victory' ? (
              <>
                <div className="arena-result-icon">{'\u2694\uFE0F'}</div>
                <div className="arena-result-title">Victory!</div>
                <div className="arena-result-subtitle">{encounterResult.deathText}</div>
                <div className="arena-result-rewards">
                  {Object.entries(encounterResult.rewards || {}).map(([uid, r]) => (
                    <div key={uid} className="arena-reward-row">
                      <span className="arena-reward-name">{r.name}</span>
                      <span className="arena-reward-values">
                        +{r.xp} XP &middot; +{r.gold} gold
                        {r.share ? ` (${r.share}%)` : ''}
                      </span>
                      {r.killingBlow && <span className="arena-reward-badge">Killing Blow</span>}
                      {r.untouchable && <span className="arena-reward-badge">Untouchable</span>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="arena-result-icon">{'\uD83D\uDC80'}</div>
                <div className="arena-result-title">Defeat</div>
                <div className="arena-result-subtitle">{encounterResult.defeatText}</div>
              </>
            )}
            {achievementQueue.length === 0 && questQueue.length === 0 && !levelUp && (
              <button
                className="arena-result-dismiss"
                onClick={() => { playSound('buttonTap'); handleDismissResult(); }}
              >
                Continue
              </button>
            )}
          </div>
        </div>
        {achievementQueue.length > 0 && (
          <AchievementToast
            key={achievementQueue[0].id}
            achievement={achievementQueue[0]}
            onDismiss={dismissAchievement}
          />
        )}
        {questQueue.length > 0 && achievementQueue.length === 0 && (
          <QuestToast
            key={questQueue[0].key}
            goal={questQueue[0]}
            onDismiss={dismissQuest}
          />
        )}
        {levelUp && achievementQueue.length === 0 && questQueue.length === 0 && (
          <LevelUpOverlay
            key={levelUp}
            level={levelUp}
            onDismiss={() => setLevelUp(null)}
          />
        )}
      </div>
    );
  }

  // ── Player sprite color palette ──
  const SPRITE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#e91e63'];

  // ── Admin sprite editor helpers ──
  const enterEditMode = () => {
    if (!monster) return;
    setEditSpriteSettings({
      spriteScale: monster.spriteScale ?? 1,
      spriteOffsetX: monster.spriteOffsetX ?? 0,
      spriteOffsetY: monster.spriteOffsetY ?? 0,
    });
    setEditArenaConfig({ ...arenaConfig });
    setEditMode(true);
  };

  const handleSaveSpriteSettings = async () => {
    setEditSaving(true);
    try {
      await api(`/api/admin/monsters/${monster.id}/sprite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editSpriteSettings),
      });
      await api('/api/admin/arena-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editArenaConfig),
      });
      setArenaConfig(editArenaConfig);
      // Re-fetch encounter so the patched monster sprite values are picked up
      const data = await api(`/api/encounters/active/${locationId}`);
      const encounters = data.encounters || [];
      const myEnc = encounters.find(e => e.participants?.[user?.id]);
      if (myEnc) setActiveEncounter(myEnc);
      setEditMode(false);
    } catch (err) {
      console.error('Failed to save sprite settings:', err);
    } finally {
      setEditSaving(false);
    }
  };

  // Resolve effective sprite settings (edit overrides > monster data > defaults)
  const spriteSettings = editMode && editSpriteSettings ? editSpriteSettings : {
    spriteScale: monster?.spriteScale ?? 1,
    spriteOffsetX: monster?.spriteOffsetX ?? 0,
    spriteOffsetY: monster?.spriteOffsetY ?? 0,
  };
  const effectiveConfig = editMode && editArenaConfig ? editArenaConfig : arenaConfig;

  // ── Initiative Rolling Phase (or pending join) ──
  const showInitiativeScreen = pendingJoinEncounterId || (
    activeEncounter && monster && isParticipant && (
      activeEncounter.phase === 'initiative_rolling' || myStats?.needsInitiativeRoll
    )
  );
  if (showInitiativeScreen) {
    return (
      <div className="arena">
        <SceneAudio config={ARENA_AUDIO_CONFIGS[arenaAudioPhase]} />
        <div className="arena-header arena-header-battle">
          <button className="arena-back" onClick={() => {
            playSound('buttonTap');
            if (pendingJoinEncounterId) {
              setPendingJoinEncounterId(null);
              setMyInitRoll(null);
              initiativeRollRef.current = false;
            }
            navigate('/map');
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="arena-header-title">The Arena</div>
          <div className="arena-round">Initiative</div>
        </div>

        <div className="arena-initiative-modal">
          <div className="arena-initiative-title">Roll for Initiative!</div>
          <div className="arena-initiative-subtitle">
            1d20 + DEX modifier ({myDexMod >= 0 ? '+' : ''}{myDexMod})
          </div>

          {/* Other players' roll results */}
          <div className="arena-initiative-results">
            {Object.entries(initiativeResults).map(([uid, data]) => (
              <div key={uid} className={`arena-init-result ${uid === user?.id ? 'arena-init-result-me' : ''}`}>
                <span className="arena-init-name">{data.name}</span>
                <span className="arena-init-total">{data.total}</span>
                <span className="arena-init-breakdown">({data.roll} + {data.modifier})</span>
              </div>
            ))}
          </div>

          {!myInitRoll ? (
            <button
              data-testid="arena-initiative-btn"
              className="arena-btn arena-btn-initiative"
              onClick={() => { playSound('buttonTap'); handleInitiativeRoll(); }}
              disabled={initiativeRollRef.current}
            >
              Roll Initiative
            </button>
          ) : (
            <div className="arena-initiative-my-result">
              <div className="arena-init-my-total">{myInitRoll.total}</div>
              <div className="arena-init-my-breakdown">{myInitRoll.roll} + {myInitRoll.modifier} DEX</div>
              <div className="arena-waiting-text">Waiting for others...</div>
            </div>
          )}
        </div>

        {/* Dice Overlay — only local rolls (initiative), no spectator rolls */}
        {diceRoll && (
          <Suspense fallback={null}>
            <DiceOverlay
              key={diceRoll.key || 0}
              notation={diceRoll.notation}
              colorset={diceRoll.colorset || 'white'}
              material={diceRoll.material || 'plastic'}
              modifier={diceRoll.modifier || 0}
              forcedValues={diceRoll.forcedValues}
              forcedTotal={diceRoll.forcedTotal}
              advantageType={diceRoll.advantageType}
              label={diceRoll.label}
              onResult={handleDiceResult}
              onDone={handleDiceDone}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // ── Active fight (only for participants) ──
  if (activeEncounter && monster && isParticipant) {
    const participantEntriesRaw = Object.entries(activeEncounter.participants || {}).filter(([uid, p]) => {
      if (p.needsInitiativeRoll) return false;
      if (activeEncounter.phase === 'initiative_rolling') {
        return activeEncounter.initiativeRolls?.[uid];
      }
      return true;
    });
    // Put current user in the middle when there are 3 players
    const participantEntries = participantEntriesRaw.length === 3
      ? (() => {
        const me = participantEntriesRaw.find(([uid]) => uid === user?.id);
        const others = participantEntriesRaw.filter(([uid]) => uid !== user?.id);
        return me ? [others[0], me, others[1]] : participantEntriesRaw;
      })()
      : participantEntriesRaw;
    const myHpPct = myStats ? Math.max(0, Math.round((myStats.currentHp / myStats.maxHp) * 100)) : 0;
    const myHpColor = myHpPct > 60 ? '#4ade80' : myHpPct > 30 ? '#fbbf24' : '#ef4444';

    return (
      <div className="arena">
        <SceneAudio config={ARENA_AUDIO_CONFIGS[arenaAudioPhase]} />
        {/* Header */}
        <div className="arena-header arena-header-battle">
          <button className="arena-back" onClick={() => { playSound('buttonTap'); navigate('/map'); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="arena-header-title">The Arena</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isAdmin && !editMode && (
              <button className="arena-edit-btn" onClick={enterEditMode} title="Edit sprites">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            <div className="arena-round">Round {activeEncounter.round}</div>
          </div>
        </div>

        {/* Two-column info panel: Players | Enemies */}
        <div className="arena-info-panel">
          <div className="arena-info-col arena-info-col-players">
            <div className="arena-info-col-label">Players</div>
            {participantEntries.map(([uid, p]) => {
              const pHpPct = Math.max(0, Math.round((p.currentHp / p.maxHp) * 100));
              const pHpColor = p.knockedOut ? '#ef4444' : pHpPct > 60 ? '#4ade80' : pHpPct > 30 ? '#fbbf24' : '#ef4444';
              const isMe = uid === user?.id;
              const statusClass = p.knockedOut ? 'arena-info-row-ko' : '';
              return (
                <div key={uid} className={`arena-info-row ${statusClass} ${isMe ? 'arena-info-row-me' : ''}`}>
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name} className="arena-info-avatar" onError={(e) => { e.target.src = '/images/default-avatar.png'; }} />
                  ) : (
                    <div className="arena-info-avatar arena-info-avatar-fallback">{(p.name || '?')[0]}</div>
                  )}
                  <div className="arena-info-hp-track">
                    <div className="arena-info-hp-fill" style={{ width: `${pHpPct}%`, backgroundColor: pHpColor }} />
                  </div>
                  <span className="arena-info-hp-text">{p.currentHp}/{p.maxHp}</span>
                  <span className="arena-info-ac">{p.ac}</span>
                  {p.knockedOut && <span className="arena-badge arena-badge-defeated">KO</span>}
                  {p.dodging && !p.knockedOut && <span className="arena-badge arena-badge-dodging">DODGE</span>}
                  {p.advantageOnNextAttack && !p.knockedOut && <span className="arena-badge arena-badge-advantage">ADV</span>}
                  {!p.knockedOut && (p.conditions || []).map(c => (
                    <span key={c.id} className={`arena-badge arena-badge-condition arena-badge-${c.id}`} title={c.description}>
                      {c.icon}
                    </span>
                  ))}
                  {p.inspirationDie && !p.knockedOut && (
                    <span className="arena-badge arena-badge-inspiration" title={`Bardic Inspiration (${p.inspirationDie})`}>
                      {'\uD83C\uDFB5'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="arena-info-divider" />
          <div className="arena-info-col arena-info-col-enemies">
            <div className="arena-info-col-label">Enemies</div>
            <div className="arena-info-row arena-info-row-enemy">
              {monster.image ? (
                <img src={`/monsters/${monster.image}`} alt={monster.name} className="arena-info-avatar arena-info-avatar-enemy" />
              ) : (
                <div className="arena-info-avatar arena-info-avatar-fallback arena-info-avatar-enemy">{(monster.name || '?')[0]}</div>
              )}
              <div className="arena-info-hp-track">
                <div className="arena-info-hp-fill" style={{ width: `${hpPercent}%`, backgroundColor: hpBarColor }} />
              </div>
              <span className="arena-info-hp-text">{monster.currentHp}/{monster.maxHp}</span>
              <span className="arena-info-ac">{monster.ac}</span>
              {(monster.conditions || []).map(c => (
                <span key={c.id} className={`arena-badge arena-badge-condition arena-badge-${c.id}`} title={c.description}>
                  {c.icon}
                </span>
              ))}
              {myStats?.huntersMarkActive && !(ensnaringStrikeToggle && actionChosen) && (
                <span className="arena-badge arena-badge-hunters-mark" title="Hunter's Mark — taking +1d6 bonus damage">
                  {'\uD83C\uDFAF'}
                </span>
              )}
            </div>
          </div>
        </div>


        {/* Timer Bar — 90s per turn */}
        {activeEncounter.phase === 'action' && isParticipant && !isKnockedOut && (() => {
          const TURN_TIMER_S = 90;
          const pct = Math.max(0, Math.min(100, (timerSeconds / TURN_TIMER_S) * 100));
          const isUrgent = timerSeconds <= 10;
          const mins = Math.floor(timerSeconds / 60);
          const secs = timerSeconds % 60;
          const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
          return (
            <div className={`arena-timer-bar ${isUrgent ? 'arena-timer-bar-urgent' : ''}`}>
              <div className="arena-timer-bar-track">
                <div className="arena-timer-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="arena-timer-bar-label">
                {isMyTurn ? timeStr : (currentTurnEntry?.name || '...')}
              </span>
            </div>
          );
        })()}

        {/* Combat Log Toggle — right-aligned below timer */}
        <div className="arena-log-toggle-wrap">
          <button className="arena-log-toggle" onClick={() => { playSound('buttonTap'); setLogOpen(o => !o); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>
        </div>

        {/* Initiative Tracker — vertical right strip */}
        {activeEncounter.initiativeOrder?.length > 0 && (
          <div className="arena-initiative-tracker">
            {activeEncounter.initiativeOrder.map((entry, idx) => {
              const isCurrent = idx === activeEncounter.currentTurnIndex;
              const isPast = idx < activeEncounter.currentTurnIndex;
              const isMonsterEntry = entry.type === 'monster';
              const pState = entry.type === 'player' ? activeEncounter.participants?.[entry.id] : null;
              const isKo = pState?.knockedOut;

              return (
                <div
                  key={entry.id}
                  className={[
                    'arena-init-entry',
                    isCurrent && 'arena-init-entry-current',
                    isPast && 'arena-init-entry-past',
                    isMonsterEntry && 'arena-init-entry-monster',
                    isKo && 'arena-init-entry-ko',
                  ].filter(Boolean).join(' ')}
                  title={entry.name}
                >
                  {isMonsterEntry ? (
                    entry.avatar ? (
                      <img src={`/monsters/${entry.avatar}`} alt={entry.name} className="arena-init-avatar" />
                    ) : (
                      <div className="arena-init-avatar arena-init-avatar-fallback">{(entry.name || '?')[0]}</div>
                    )
                  ) : entry.avatar ? (
                    <img src={entry.avatar} alt={entry.name} className="arena-init-avatar" />
                  ) : (
                    <div className="arena-init-avatar arena-init-avatar-fallback">{(entry.name || '?')[0]}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Battle Field — enemy sprite + player sprite tiles */}
        <div className={`arena-battle-field ${participantEntries.length === 1 ? 'arena-battle-field-duel' : ''}`}>
          {(monster.sprite || monster.image) ? (
            <img
              src={`/monsters/${monster.sprite || monster.image}`}
              alt={monster.name}
              className="arena-enemy-sprite"
              style={{
                transform: `translate(${spriteSettings.spriteOffsetX * viewScale}px, ${spriteSettings.spriteOffsetY * viewScale}px) scale(${spriteSettings.spriteScale * viewScale})`,
              }}
            />
          ) : (
            <div className="arena-enemy-sprite arena-enemy-sprite-fallback">
              {monster.name?.[0] || '?'}
            </div>
          )}
          {vineEffect && (
            <img
              src="/images/effects/vines.webp"
              className="arena-vine-overlay"
              onAnimationEnd={() => setVineEffect(false)}
              alt=""
            />
          )}

          {/* Player sprite tiles */}
          <div className="arena-sprite-row" style={{ transform: `translateY(${(effectiveConfig.playerOffsetY || 0) * viewScale * viewScale * viewScale}px)` }}>
            {participantEntries.map(([uid, p], idx) => {
              const count = participantEntries.length;
              const gapScale = count <= 2 ? 1 : count === 3 ? 1.4 : 2 / count;
              return (
                <div
                  key={uid}
                  className={`arena-sprite-tile ${p.sprite ? 'arena-sprite-tile-has-img' : ''} ${p.knockedOut ? 'arena-sprite-tile-ko' : ''} ${uid === user?.id ? 'arena-sprite-tile-me' : ''}`}
                  style={{
                    width: `${effectiveConfig.playerTileSize * viewScale}px`,
                    height: `${effectiveConfig.playerTileSize * viewScale}px`,
                    marginLeft: idx > 0 ? `${effectiveConfig.playerTileGap * viewScale * gapScale}px` : undefined,
                    ...(p.sprite ? {} : { backgroundColor: SPRITE_COLORS[idx % SPRITE_COLORS.length] }),
                  }}
                >
                  {p.sprite ? (
                    <img src={`/players/${p.sprite}`} alt={p.name} className="arena-sprite-tile-img" />
                  ) : (
                    (p.name || '?')[0].toUpperCase()
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Turn announcement overlay */}
        {turnAnnouncement && (
          <div className="arena-turn-announce-backdrop">
            <div className={`arena-turn-announce ${turnAnnouncement.type === 'monster' ? 'arena-turn-announce-enemy' : 'arena-turn-announce-player'}`}>
              {turnAnnouncement.name}&rsquo;s Turn
            </div>
          </div>
        )}

        {/* Bonus action result banner (Patient Defense / Hunter's Mark) */}
        {bonusResultBanner && bonusResultBanner.type === 'patient_defense' && (
          <div className="arena-bonus-result-banner" onClick={() => setBonusResultBanner(null)}>
            <div className="arena-bonus-result-content arena-bonus-patient">
              <div className="arena-bonus-result-title">{'\uD83D\uDEE1'} Patient Defense</div>
              <div className="arena-bonus-result-desc">Attacks have disadvantage until next turn</div>
            </div>
          </div>
        )}
        {bonusResultBanner && bonusResultBanner.type === 'hunters_mark' && (
          <div className="arena-bonus-result-banner" onClick={() => setBonusResultBanner(null)}>
            <div className="arena-bonus-result-content arena-bonus-hunters-mark">
              <div className="arena-bonus-result-title">{'\uD83C\uDFAF'} Hunter's Mark</div>
              <div className="arena-bonus-result-desc">{bonusResultBanner.name} marks their quarry — +1d6 damage per hit!</div>
            </div>
          </div>
        )}

        {/* Monster turn skipped banner (stunned) */}
        {monsterSkipBanner && (
          <div className="arena-monster-skip-banner" onClick={() => setMonsterSkipBanner(null)}>
            <div className="arena-monster-skip-content">
              <div className="arena-monster-skip-icon">{'\uD83D\uDCAB'}</div>
              <div className="arena-monster-skip-title">{monsterSkipBanner.monsterName} is {monsterSkipBanner.reason}!</div>
              <div className="arena-monster-skip-desc">Can't move or take actions — turn skipped!</div>
            </div>
          </div>
        )}

        {/* Bottom UI — actions + timer */}
        <div className="arena-bottom-ui">

          {/* Quick Emote Bar */}
          {activeEncounter && isParticipant && quickBarEmotes.length > 0 && (
            <div className="arena-emote-quick-bar">
              {quickBarEmotes.map(emote => (
                <button
                  key={emote.id}
                  className="arena-emote-quick-btn"
                  onClick={() => { playSound('buttonTap'); handleArenaEmote(emote.id); }}
                >
                  <img src={`/images/emotes/${emote.image}`} alt={emote.name} draggable={false} />
                </button>
              ))}
              <button
                className="arena-emote-quick-btn arena-emote-quick-more"
                onClick={() => { playSound('buttonTap'); setEmoteGridOpen(o => !o); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
            </div>
          )}

          {/* Resource Bar — Spell Slots, Channel Divinity & Ki (visible to all participants) */}
          {activeEncounter && isParticipant && myStats && (myStats.spellSlots?.length > 0 || myStats.channelDivinityMax > 0 || myStats.kiPointsMax > 0) && (
            <div className="arena-resource-bar">
              {(myStats.spellSlots || []).map((slot, idx) => (
                <div key={idx} className="arena-resource-group">
                  <span className="arena-resource-label">Lvl {slot.level}</span>
                  <div className="arena-resource-pips">
                    {Array.from({ length: slot.total }, (_, i) => (
                      <span
                        key={i}
                        className={`arena-resource-pip ${i < slot.total - slot.used ? 'arena-resource-pip-full' : 'arena-resource-pip-empty'}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {myStats.channelDivinityMax > 0 && (
                <div className="arena-resource-group">
                  <span className="arena-resource-label">CD</span>
                  <div className="arena-resource-pips">
                    {Array.from({ length: myStats.channelDivinityMax }, (_, i) => (
                      <span
                        key={i}
                        className={`arena-resource-pip arena-resource-pip-cd ${i < myStats.channelDivinityMax - (myStats.channelDivinityUsed || 0) ? 'arena-resource-pip-full' : 'arena-resource-pip-empty'}`}
                      />
                    ))}
                  </div>
                </div>
              )}
              {myStats.kiPointsMax > 0 && (
                <div className="arena-resource-group">
                  <span className="arena-resource-label">Ki</span>
                  <div className="arena-resource-pips">
                    {Array.from({ length: myStats.kiPointsMax }, (_, i) => (
                      <span
                        key={i}
                        className={`arena-resource-pip arena-resource-pip-ki ${i < myStats.kiPointsMax - (myStats.kiPointsUsed || 0) ? 'arena-resource-pip-full' : 'arena-resource-pip-empty'}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Panel — turn-gated */}
          <div className="arena-actions">
            {isMonsterRolling || isMonsterTurn ? (
              <div className="arena-status-text arena-monster-status">
                {rollPhase === 'monster_rolling' || rollPhase === 'monster_saving' || rollPhase === 'monster_escaping'
                  ? (monsterRollStatus || `${currentTurnEntry?.name || 'Monster'} is attacking...`)
                  : `${currentTurnEntry?.name || monsterRollRequest?.monsterName || monsterSaveRequest?.monsterName || monsterEscapeRequest?.monsterName || 'Monster'} is attacking...`
                }
              </div>
            ) : isKnockedOut ? (
              <div className="arena-status-text">You have been knocked out. An ally can revive you with healing.</div>
            ) : actionChosen ? (
              <div className={`arena-status-text ${rollPhase === 'attack_result' && attackResult?.isNat20 ? 'arena-crit-text' : ''} ${rollPhase === 'attack_result' && attackResult?.isNat1 ? 'arena-fumble-text' : ''}`}>
                {getStatusText()}
              </div>
            ) : bonusActionPhase && isMyTurn ? (
              <div className="arena-bonus-action-phase">
                <div className="arena-bonus-label">BONUS ACTION</div>
                <div className="arena-bonus-buttons">
                  {availableBonusActions.find(a => a.type === 'bardic_inspiration') && (
                    <button
                      className="arena-btn arena-btn-bonus-inspire"
                      onClick={() => { playSound('buttonTap'); setInspirationTargetModal(true); }}
                    >
                      {'\uD83C\uDFB5'} Inspire ({availableBonusActions.find(a => a.type === 'bardic_inspiration').usesLeft})
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'healing_word') && (
                    <button
                      className="arena-btn arena-btn-bonus-heal"
                      onClick={() => { playSound('buttonTap'); setHealingWordTargetModal(true); }}
                    >
                      {'\u2728'} Healing Word
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'offhand_attack') && (
                    <button
                      className="arena-btn arena-btn-attack"
                      onClick={() => { playSound('buttonTap'); handleOffhandClick(); }}
                    >
                      {'\u2694'} Offhand Attack
                      <span className="arena-action-tag arena-action-tag-bonus">BONUS</span>
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'ensnaring_strike') && (
                    <button
                      className="arena-btn arena-btn-ensnaring"
                      onClick={() => { playSound('buttonTap'); handleEnsnaringStrike(); }}
                    >
                      {'\u{1FAB4}'} Ensnaring Strike
                      <span className="arena-action-tag arena-action-tag-bonus">BONUS</span>
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'hunters_mark') && (
                    <button
                      className="arena-btn arena-btn-hunters-mark"
                      onClick={() => { playSound('buttonTap'); handleHuntersMark(); }}
                    >
                      {'\uD83C\uDFAF'} Hunter's Mark
                      <span className="arena-action-tag arena-action-tag-bonus">BONUS</span>
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'flurry_of_blows') && (
                    <button
                      className="arena-btn arena-btn-flurry"
                      onClick={() => { playSound('buttonTap'); handleFlurryOfBlows(); }}
                    >
                      {'\uD83D\uDC4A'} Flurry of Blows
                      <span className="arena-action-tag arena-action-tag-bonus">BONUS</span>
                    </button>
                  )}
                  {availableBonusActions.find(a => a.type === 'patient_defense') && (
                    <button
                      className="arena-btn arena-btn-patient-defense"
                      onClick={() => { playSound('buttonTap'); handlePatientDefense(); }}
                    >
                      {'\uD83D\uDEE1'} Patient Defense
                      <span className="arena-action-tag arena-action-tag-bonus">BONUS</span>
                    </button>
                  )}
                  <button
                    className="arena-btn arena-btn-skip"
                    onClick={() => { playSound('buttonTap'); handleBonusActionSkip(); }}
                  >
                    End Turn
                  </button>
                </div>
              </div>
            ) : activeEncounter.phase === 'action' && isParticipant && isMyTurn ? (
              <>
                {actionTooltip && (
                  <div className="arena-action-tooltip" onClick={cancelTooltip}>
                    <div className="arena-action-tooltip-content">
                      {ACTION_TOOLTIPS[actionTooltip]}
                    </div>
                  </div>
                )}
                {/* ── Core Actions Grid ── */}
                <div className="arena-core-actions">
                  <button
                    data-testid="arena-attack-btn"
                    className="arena-core-btn arena-core-btn-attack"
                    onClick={() => { playSound('buttonTap'); handleAttackClick(); }}
                    onTouchStart={() => startTooltip('attack')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('attack')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                  >
                    <span className="arena-core-btn-icon">{'\u2694'}</span>
                    <span className="arena-core-btn-label">Attack</span>
                    {myStats && <span className="arena-core-btn-detail">d20+{myStats.attackBonus || 0}</span>}
                  </button>
                  <button
                    className="arena-core-btn arena-core-btn-defend"
                    onClick={() => { playSound('buttonTap'); handleActionClick('defend'); }}
                    onTouchStart={() => startTooltip('defend')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('defend')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                  >
                    <span className="arena-core-btn-icon">{'\uD83D\uDEE1'}</span>
                    <span className="arena-core-btn-label">Dodge</span>
                  </button>
                  <button
                    className="arena-core-btn arena-core-btn-potion"
                    onClick={() => { playSound('buttonTap'); setPotionModalOpen(true); }}
                    onTouchStart={() => startTooltip('potion')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('potion')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                    disabled={potions.length === 0}
                  >
                    <span className="arena-core-btn-icon">{'\uD83E\uDDEA'}</span>
                    <span className="arena-core-btn-label">Potion</span>
                    {potions.length > 0 && <span className="arena-core-btn-detail">{potions.length}</span>}
                  </button>
                  <button
                    className="arena-core-btn arena-core-btn-flee"
                    onClick={() => { playSound('buttonTap'); handleActionClick('flee'); }}
                    onTouchStart={() => startTooltip('flee')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('flee')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                  >
                    <span className="arena-core-btn-icon">{'\uD83C\uDFC3'}</span>
                    <span className="arena-core-btn-label">Flee</span>
                  </button>
                </div>

                {/* Concentration banner */}
                {myStats?.concentration && !ensnaringStrikeToggle && (
                  <div
                    className="arena-concentration-banner"
                    onTouchStart={() => startTooltip(myStats.concentration.spellId === 'hunters_mark' ? 'hunters_mark' : myStats.concentration.spellId === 'ensnaring_strike' ? 'ensnaring_strike' : 'concentration')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip(myStats.concentration.spellId === 'hunters_mark' ? 'hunters_mark' : myStats.concentration.spellId === 'ensnaring_strike' ? 'ensnaring_strike' : 'concentration')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                  >
                    {'\uD83D\uDD2E'} Concentrating: {CONCENTRATION_SPELL_NAMES[myStats.concentration.spellId] || myStats.concentration.spellId}{myStats.concentration.spellId === 'hunters_mark' ? ' — +1d6 per hit' : ''}
                  </div>
                )}

                {/* Ensnaring Strike buff indicator — client toggle (pre-attack) or server state (post-attack) */}
                {(ensnaringStrikeToggle || myStats?.ensnaringStrikeActive) && (
                  <div
                    className="arena-buff-indicator"
                    onClick={() => {
                      if (tooltipShownRef.current) return;
                      playSound('buttonTap');
                      if (ensnaringStrikeToggle) {
                        setEnsnaringStrikeToggle(false);
                      } else {
                        handleDropConcentration();
                      }
                    }}
                    onTouchStart={() => startTooltip('ensnaring_strike')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('ensnaring_strike')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                    style={{ cursor: 'pointer' }}
                  >
                    {'\u{1FAB4}'} Ensnaring Strike active — tap to cancel
                  </div>
                )}
                {myStats?.huntersMarkActive && !ensnaringStrikeToggle && !myStats?.concentration && (
                  <div
                    className="arena-buff-indicator arena-buff-indicator-hunters-mark"
                    onTouchStart={() => startTooltip('hunters_mark')}
                    onTouchEnd={cancelTooltip}
                    onTouchCancel={cancelTooltip}
                    onMouseDown={() => startTooltip('hunters_mark')}
                    onMouseUp={cancelTooltip}
                    onMouseLeave={cancelTooltip}
                  >
                    {'\uD83C\uDFAF'} Hunter's Mark active — +1d6 damage per hit
                  </div>
                )}

                {/* Stunning Strike buff indicator (like Ensnaring Strike) */}
                {stunningStrikeToggle && (
                  <div
                    className="arena-buff-indicator arena-buff-indicator-ki"
                    onClick={() => { playSound('buttonTap'); setStunningStrikeToggle(false); setAbilitiesOpen(true); }}
                    style={{ cursor: 'pointer' }}
                  >
                    {'\uD83D\uDCAB'} Stunning Strike active — tap to cancel
                  </div>
                )}

                {/* ── Abilities Toggle ── */}
                <button
                  className="arena-abilities-toggle"
                  onClick={() => { playSound('buttonTap'); setAbilitiesOpen(o => !o); }}
                >
                  <span className={`arena-abilities-toggle-arrow ${abilitiesOpen ? 'open' : ''}`}>{'\u25B2'}</span>
                  Abilities
                </button>

                {/* ── Abilities Drawer ── */}
                <div className={`arena-abilities-drawer ${abilitiesOpen ? 'open' : ''}`}>
                  <div className="arena-abilities-grid">
                    {(myStats?.hasAvailableSpells
                      || (myStats?.availablePreBonusActions || []).some(a => a.type === 'ensnaring_strike' || a.type === 'hunters_mark')
                    ) && (
                      <button
                        className="arena-ability-btn arena-ability-btn-spell"
                        onClick={() => { playSound('buttonTap'); handleSpellClick(); }}
                      >
                        <span className="arena-ability-btn-name">
                          {'\u2728'} Cast Spell
                          <span className="arena-ability-btn-tag arena-ability-btn-tag-action">ACTION</span>
                        </span>
                      </button>
                    )}
                    {(myStats?.classFeatures || []).includes('Lay on Hands') && ((myStats?.layOnHandsPool || 0) - (myStats?.layOnHandsUsed || 0)) > 0 && (
                      <button
                        className="arena-ability-btn arena-ability-btn-layonhands"
                        onClick={() => { playSound('buttonTap'); handleLayOnHandsClick(); }}
                        onTouchStart={() => startTooltip('layonhands')}
                        onTouchEnd={cancelTooltip}
                        onTouchCancel={cancelTooltip}
                        onMouseDown={() => startTooltip('layonhands')}
                        onMouseUp={cancelTooltip}
                        onMouseLeave={cancelTooltip}
                      >
                        <span className="arena-ability-btn-name">{'\u2728'} Lay on Hands</span>
                        <span className="arena-ability-btn-detail">{(myStats?.layOnHandsPool || 0) - (myStats?.layOnHandsUsed || 0)} HP</span>
                      </button>
                    )}
                    {myStats?.hasNaturesWrath && ((myStats?.channelDivinityMax || 0) - (myStats?.channelDivinityUsed || 0)) > 0 && (
                      <button
                        className="arena-ability-btn arena-ability-btn-channel"
                        onClick={() => { playSound('buttonTap'); handleNaturesWrath(); }}
                      >
                        <span className="arena-ability-btn-name">
                          {'\u{26D3}\u{FE0F}'} Nature's Wrath
                          <span className="arena-ability-btn-tag arena-ability-btn-tag-action">ACTION</span>
                        </span>
                        <span className="arena-ability-btn-detail">{(myStats?.channelDivinityMax || 0) - (myStats?.channelDivinityUsed || 0)} use</span>
                      </button>
                    )}
                    {myStats?.hasKiPoints && (myStats?.kiPointsMax - (myStats?.kiPointsUsed || 0)) >= 2 && (
                      <button
                        className="arena-ability-btn arena-ability-btn-ki"
                        onClick={() => { playSound('buttonTap'); handleFistOfUnbrokenAir(); }}
                        onTouchStart={() => startTooltip('fist_of_unbroken_air')}
                        onTouchEnd={cancelTooltip}
                        onTouchCancel={cancelTooltip}
                        onMouseDown={() => startTooltip('fist_of_unbroken_air')}
                        onMouseUp={cancelTooltip}
                        onMouseLeave={cancelTooltip}
                      >
                        <span className="arena-ability-btn-name">
                          {'\uD83D\uDCA8'} Fist of Unbroken Air
                          <span className="arena-ability-btn-tag arena-ability-btn-tag-action">ACTION</span>
                        </span>
                        <span className="arena-ability-btn-detail">2 ki</span>
                      </button>
                    )}
                    {myStats?.hasKiPoints && (myStats?.kiPointsMax - (myStats?.kiPointsUsed || 0)) >= 1 && !stunningStrikeToggle && (
                      <button
                        className={`arena-ability-btn arena-ability-btn-ki`}
                        onClick={() => { playSound('buttonTap'); setStunningStrikeToggle(true); setAbilitiesOpen(false); }}
                        onTouchStart={() => startTooltip('stunning_strike')}
                        onTouchEnd={cancelTooltip}
                        onTouchCancel={cancelTooltip}
                        onMouseDown={() => startTooltip('stunning_strike')}
                        onMouseUp={cancelTooltip}
                        onMouseLeave={cancelTooltip}
                      >
                        <span className="arena-ability-btn-name">
                          {'\uD83D\uDCAB'} Stunning Strike
                        </span>
                        <span className="arena-ability-btn-detail">1 ki</span>
                      </button>
                    )}
                    <button
                      className="arena-ability-btn arena-ability-btn-help"
                      onClick={() => { playSound('buttonTap'); handleHelpClick(); }}
                      onTouchStart={() => startTooltip('help')}
                      onTouchEnd={cancelTooltip}
                      onTouchCancel={cancelTooltip}
                      onMouseDown={() => startTooltip('help')}
                      onMouseUp={cancelTooltip}
                      onMouseLeave={cancelTooltip}
                      disabled={!Object.entries(activeEncounter?.participants || {}).some(([uid, p]) => uid !== user?.id && !p.knockedOut)}
                    >
                      <span className="arena-ability-btn-name">{'\uD83E\uDD1D'} Help</span>
                    </button>
                    {(myStats?.availablePreBonusActions || []).map(action => {
                      const config = preBonusActionConfig[action.type];
                      if (!config) return null;
                      // Ensnaring Strike & Hunter's Mark are now in the Cast Spell modal
                      if (action.type === 'ensnaring_strike' || action.type === 'hunters_mark') return null;
                      return (
                        <button key={action.type} className={`arena-ability-btn ${config.className}`}
                          onClick={config.onClick}
                          onTouchStart={config.tooltip ? () => startTooltip(config.tooltip) : undefined}
                          onTouchEnd={config.tooltip ? cancelTooltip : undefined}
                          onTouchCancel={config.tooltip ? cancelTooltip : undefined}
                          onMouseDown={config.tooltip ? () => startTooltip(config.tooltip) : undefined}
                          onMouseUp={config.tooltip ? cancelTooltip : undefined}
                          onMouseLeave={config.tooltip ? cancelTooltip : undefined}>
                          <span className="arena-ability-btn-name">
                            {config.icon} {config.label}
                            <span className="arena-ability-btn-tag arena-ability-btn-tag-bonus">BONUS</span>
                          </span>
                          {config.detail && <span className="arena-ability-btn-detail">{config.detail(action)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : activeEncounter.phase === 'action' && isParticipant && !isMyTurn ? (
              <div className="arena-status-text arena-waiting-text">
                Waiting for {currentTurnEntry?.name || 'someone'}...
              </div>
            ) : activeEncounter.phase === 'resolving' || activeEncounter.phase === 'monster_turn' || activeEncounter.phase === 'monster_rolling' || activeEncounter.phase === 'monster_saving' || activeEncounter.phase === 'monster_escaping' ? (
              <div className="arena-status-text">Resolving...</div>
            ) : null}
          </div>

        </div>{/* end .arena-bottom-ui */}



        {/* Collapsible Combat Log */}
        {logOpen && (
          <div className="arena-combat-log-overlay" onClick={() => { playSound('buttonTap'); setLogOpen(false); }}>
            <div className="arena-combat-log-panel" onClick={e => e.stopPropagation()}>
              <div className="arena-combat-log-header">
                <span>Combat Log</span>
                <button className="arena-combat-log-close" onClick={() => { playSound('buttonTap'); setLogOpen(false); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-combat-log-entries" ref={combatLogRef}>
                {encounterNarrations.map((n) => (
                  <div
                    key={n.id}
                    className={`arena-log-entry ${n.subtype === 'round_header' ? 'arena-log-header' :
                      n.subtype === 'victory' ? 'arena-log-victory' :
                        n.subtype === 'defeat' ? 'arena-log-defeat' :
                          'arena-log-combat'
                      }`}
                    dangerouslySetInnerHTML={{ __html: formatBold(n.text) }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Potion Selection Modal */}
        {potionModalOpen && (
          <div className="arena-potion-overlay" onClick={() => setPotionModalOpen(false)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\uD83E\uDDEA'} Use Potion</span>
                <button className="arena-potion-close" onClick={() => setPotionModalOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {potions.length === 0 ? (
                <div className="arena-potion-empty">No potions in inventory</div>
              ) : (
                <div className="arena-potion-list">
                  {potions.map(p => (
                    <button
                      key={p.item_id}
                      className="arena-potion-item"
                      onClick={() => { playSound('buttonTap'); handlePotionSelect(p); }}
                    >
                      <div className="arena-potion-item-name">{p.name}</div>
                      <div className="arena-potion-item-info">
                        <span className="arena-potion-item-dice">{p.heal_dice} HP</span>
                        <span className="arena-potion-item-qty">x{p.quantity}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Potion Target Selection Modal */}
        {potionTargetModal && (
          <div className="arena-potion-overlay" onClick={() => setPotionTargetModal(null)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>Use {potionTargetModal.potion.name} on...</span>
                <button className="arena-potion-close" onClick={() => setPotionTargetModal(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {potionTargetModal.targets.map(t => (
                  <button
                    key={t.id}
                    className="arena-potion-item arena-potion-target"
                    onClick={() => { playSound('buttonTap'); handlePotionUse(potionTargetModal.potion, t.id); }}
                  >
                    {t.avatar ? (
                      <img src={t.avatar} alt={t.name} className="arena-potion-target-avatar" />
                    ) : (
                      <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(t.name || '?')[0]}</div>
                    )}
                    <div className="arena-potion-item-name">
                      {t.name}
                      {t.currentHp != null && <span className="arena-loh-hp-tag">{t.currentHp}/{t.maxHp}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Help Target Selection Modal */}
        {helpTargetModal && (
          <div className="arena-potion-overlay" onClick={() => setHelpTargetModal(false)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>Help which ally?</span>
                <button className="arena-potion-close" onClick={() => setHelpTargetModal(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {Object.entries(activeEncounter?.participants || {})
                  .filter(([uid, p]) => uid !== user?.id && !p.knockedOut)
                  .map(([uid, p]) => (
                    <button
                      key={uid}
                      className="arena-potion-item arena-potion-target"
                      onClick={() => { playSound('buttonTap'); handleHelpSelect(uid); }}
                    >
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.name} className="arena-potion-target-avatar" />
                      ) : (
                        <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(p.name || '?')[0]}</div>
                      )}
                      <div className="arena-potion-item-name">{p.name}</div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Bardic Inspiration Target Modal */}
        {inspirationTargetModal && (
          <div className="arena-potion-overlay" onClick={() => setInspirationTargetModal(false)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\uD83C\uDFB5'} Inspire which ally?</span>
                <button className="arena-potion-close" onClick={() => setInspirationTargetModal(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {(availableBonusActions.find(a => a.type === 'bardic_inspiration')?.targets ||
                  Object.entries(activeEncounter?.participants || {})
                    .filter(([uid, p]) => uid !== user?.id && !p.knockedOut && !p.inspirationDie)
                    .map(([uid, p]) => ({ id: uid, name: p.name }))
                ).map(t => (
                  <button
                    key={t.id}
                    className="arena-potion-item arena-potion-target"
                    onClick={() => { playSound('buttonTap'); handleBardicInspiration(t.id); }}
                  >
                    <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(t.name || '?')[0]}</div>
                    <div className="arena-potion-item-name">{t.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Weapon Picker Modal */}
        {weaponModalOpen && (
          <div className="arena-potion-overlay" onClick={() => setWeaponModalOpen(false)}>
            <div className="arena-potion-modal arena-weapon-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\u2694'} Choose Weapon</span>
                <button className="arena-potion-close" onClick={() => setWeaponModalOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {availableWeapons.map(weapon => (
                  <button
                    key={weapon.id}
                    className={`arena-weapon-card ${weapon.ranged ? 'arena-weapon-card-ranged' : ''}`}
                    onClick={() => { playSound('buttonTap'); handleWeaponSelect(weapon); }}
                  >
                    <div className="arena-weapon-card-header">
                      <span className="arena-weapon-card-name">{weapon.name}</span>
                      <span className="arena-weapon-card-hit">+{weapon.attackBonus} to hit</span>
                    </div>
                    <div className="arena-weapon-card-info">
                      <span className="arena-weapon-card-dice">{weapon.dice} + {weapon.damageMod}</span>
                      <span className="arena-weapon-card-type">{weapon.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Offhand Weapon Picker Modal */}
        {offhandWeaponModal && (
          <div className="arena-potion-overlay" onClick={() => setOffhandWeaponModal(false)}>
            <div className="arena-potion-modal arena-weapon-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\u2694'} Offhand Attack</span>
                <button className="arena-potion-close" onClick={() => setOffhandWeaponModal(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {(availableBonusActions.find(a => a.type === 'offhand_attack')?.weapons || []).map(weapon => (
                  <button
                    key={weapon.id}
                    className={`arena-weapon-card ${weapon.ranged ? 'arena-weapon-card-ranged' : ''}`}
                    onClick={() => { playSound('buttonTap'); handleOffhandAttack(weapon); }}
                  >
                    <div className="arena-weapon-card-header">
                      <span className="arena-weapon-card-name">{weapon.name}</span>
                      <span className="arena-weapon-card-hit">+{weapon.attackBonus} to hit</span>
                    </div>
                    <div className="arena-weapon-card-info">
                      <span className="arena-weapon-card-dice">{weapon.dice} + {weapon.damageMod}</span>
                      <span className="arena-weapon-card-type">{weapon.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Spell Picker Modal */}
        {spellModalOpen && (
          <div className="arena-potion-overlay" onClick={() => setSpellModalOpen(false)}>
            <div className="arena-potion-modal arena-spell-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\u2728'} Cast a Spell</span>
                <button className="arena-potion-close" onClick={() => setSpellModalOpen(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {availableSpells.map(spell => (
                  <button
                    key={spell.id}
                    className={`arena-spell-card ${spell.level === 0 ? 'arena-spell-card-cantrip' : 'arena-spell-card-level1'}`}
                    onClick={() => {
                      playSound('buttonTap');
                      if (spell.isBonusAbility) {
                        setSpellModalOpen(false);
                        if (spell.id === 'ensnaring_strike') {
                          const myS = activeEncounter?.participants[user?.id];
                          if (myS?.concentration && myS.concentration.spellId !== 'ensnaring_strike') {
                            const currentName = CONCENTRATION_SPELL_NAMES[myS.concentration.spellId] || myS.concentration.spellId;
                            setConcentrationConflict({
                              currentSpell: currentName,
                              newSpell: 'Ensnaring Strike',
                              onConfirm: () => { setEnsnaringStrikeToggle(true); setAbilitiesOpen(false); },
                            });
                          } else {
                            setEnsnaringStrikeToggle(true); setAbilitiesOpen(false);
                          }
                        } else if (spell.id === 'hunters_mark') {
                          handleHuntersMark();
                        }
                      } else {
                        handleCastSpell(spell);
                      }
                    }}
                  >
                    <div className="arena-spell-card-header">
                      <span className="arena-spell-card-name">{spell.name}</span>
                      <div className="arena-spell-card-badges">
                        <span className={`arena-spell-card-level ${spell.level === 0 ? 'arena-spell-level-cantrip' : 'arena-spell-level-1'}`}>
                          {spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`}
                        </span>
                        <span className={`arena-spell-card-action ${spell.actionType === 'bonus' ? 'arena-spell-action-bonus' : 'arena-spell-action-main'}`}>
                          {spell.actionType === 'bonus' ? 'Bonus' : 'Action'}
                        </span>
                      </div>
                    </div>
                    <div className="arena-spell-card-info">
                      <span className="arena-spell-card-dice">{spell.damageDice || spell.healDice} {spell.damageType || 'healing'}</span>
                      {spell.saveAbility && <span className="arena-spell-card-save">{spell.saveAbility} save</span>}
                    </div>
                    <div className="arena-spell-card-desc">{spell.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Concentration Conflict Modal */}
        {concentrationConflict && (
          <div className="arena-potion-overlay" onClick={() => setConcentrationConflict(null)}>
            <div className="arena-potion-modal arena-concentration-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\uD83D\uDD2E'} Concentration Conflict</span>
                <button className="arena-potion-close" onClick={() => setConcentrationConflict(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-concentration-conflict-body">
                <p>You're concentrating on <strong>{concentrationConflict.currentSpell}</strong>.</p>
                <p>Casting <strong>{concentrationConflict.newSpell}</strong> will end it.</p>
              </div>
              <div className="arena-concentration-conflict-actions">
                <button className="arena-concentration-btn-cancel" onClick={() => setConcentrationConflict(null)}>Cancel</button>
                <button className="arena-concentration-btn-confirm" onClick={() => { setConcentrationConflict(null); concentrationConflict.onConfirm(); }}>Cast Anyway</button>
              </div>
            </div>
          </div>
        )}

        {/* Healing Word Target Modal */}
        {healingWordTargetModal && (
          <div className="arena-potion-overlay" onClick={() => setHealingWordTargetModal(false)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\u2728'} Healing Word — Choose Target</span>
                <button className="arena-potion-close" onClick={() => setHealingWordTargetModal(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {(availableBonusActions.find(a => a.type === 'healing_word')?.targets ||
                  Object.entries(activeEncounter?.participants || {})
                    .filter(([, p]) => !p.knockedOut)
                    .map(([uid, p]) => ({ id: uid, name: p.name, currentHp: p.currentHp, maxHp: p.maxHp }))
                ).map(t => (
                  <button
                    key={t.id}
                    className="arena-potion-item arena-potion-target"
                    onClick={() => { playSound('buttonTap'); handleHealingWord(t.id); }}
                  >
                    <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(t.name || '?')[0]}</div>
                    <div className="arena-potion-item-name">{t.name}</div>
                    <div className="arena-potion-item-detail">
                      {`${t.currentHp}/${t.maxHp} HP`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Heal Spell Target Modal (Cure Wounds etc.) */}
        {healSpellTargetModal && (
          <div className="arena-potion-overlay" onClick={() => setHealSpellTargetModal(null)}>
            <div className="arena-potion-modal" onClick={e => e.stopPropagation()}>
              <div className="arena-potion-header">
                <span>{'\u2728'} {healSpellTargetModal.name} — Choose Target</span>
                <button className="arena-potion-close" onClick={() => setHealSpellTargetModal(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="arena-potion-list">
                {Object.entries(activeEncounter?.participants || {})
                  .map(([uid, p]) => ({ id: uid, name: p.name, currentHp: p.currentHp, maxHp: p.maxHp, knockedOut: p.knockedOut }))
                  .map(t => (
                  <button
                    key={t.id}
                    className="arena-potion-item arena-potion-target"
                    onClick={() => { playSound('buttonTap'); handleHealSpellCast(healSpellTargetModal, t.id); }}
                  >
                    <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(t.name || '?')[0]}</div>
                    <div className="arena-potion-item-name">{t.name}{t.knockedOut ? ' (KO)' : ''}</div>
                    <div className="arena-potion-item-detail">
                      {t.knockedOut ? 'Knocked Out' : `${t.currentHp}/${t.maxHp} HP`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Divine Smite Prompt Modal */}
        {smitePrompt && (
          <div className="arena-smite-overlay">
            <div className="arena-smite-modal">
              <div className="arena-smite-title">{'\u2728'} Divine Smite?</div>
              <div className="arena-smite-weapon-dmg">Add radiant damage to your attack</div>
              <div className="arena-smite-slots">
                {smitePrompt.slots.map(slot => {
                  const baseDice = 2 + (slot.level - 1);
                  const isUndeadFiend = ['undead', 'fiend'].includes(smitePrompt.monsterType);
                  const bonusDice = isUndeadFiend ? 1 : 0;
                  let totalDice = baseDice + bonusDice;
                  if (smitePrompt.isNat20) totalDice *= 2;
                  const slotsLeft = slot.total - slot.used;
                  return (
                    <button
                      key={slot.level}
                      className="arena-btn arena-btn-smite"
                      onClick={() => { playSound('buttonTap'); smitePrompt.resolve({ slotLevel: slot.level }); }}
                    >
                      Level {slot.level} Smite (+{totalDice}d8)
                      <span className="arena-btn-detail">{slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} left</span>
                    </button>
                  );
                })}
              </div>
              <button
                className="arena-btn arena-btn-no-smite"
                onClick={() => { playSound('buttonTap'); smitePrompt.resolve(null); }}
              >
                No Smite
              </button>
            </div>
          </div>
        )}

        {/* Bardic Inspiration Prompt Modal */}
        {inspirationPrompt && (
          <div className="arena-smite-overlay">
            <div className="arena-inspiration-modal">
              <div className="arena-inspiration-title">{'\uD83C\uDFB5'} Use Bardic Inspiration?</div>
              <div className="arena-inspiration-info">
                <span>Your roll: <strong>{inspirationPrompt.total}</strong> vs AC <strong>{inspirationPrompt.ac}</strong></span>
                <span className={inspirationPrompt.isHit ? 'arena-inspiration-hit' : 'arena-inspiration-miss'}>
                  {inspirationPrompt.isHit ? 'Hit!' : 'Miss'}
                </span>
              </div>
              <div className="arena-inspiration-desc">
                Add a {inspirationPrompt.die} to your attack roll
              </div>
              <button
                className="arena-btn arena-btn-use-inspiration"
                onClick={() => { playSound('buttonTap'); inspirationPrompt.resolve(true); }}
              >
                {'\uD83C\uDFB5'} Roll {inspirationPrompt.die}
              </button>
              <button
                className="arena-btn arena-btn-no-smite"
                onClick={() => { playSound('buttonTap'); inspirationPrompt.resolve(false); }}
              >
                Keep It
              </button>
            </div>
          </div>
        )}

        {/* Lay on Hands Target + Amount Modal */}
        {lohModalOpen && (() => {
          const myP = activeEncounter?.participants?.[user?.id];
          const remaining = (myP?.layOnHandsPool || 0) - (myP?.layOnHandsUsed || 0);
          const targets = [];
          for (const [uid, p] of Object.entries(activeEncounter?.participants || {})) {
            if (p.knockedOut || p.currentHp < p.maxHp) {
              targets.push({ id: uid, name: uid === user?.id ? 'Yourself' : p.name, avatar: p.avatar, knockedOut: p.knockedOut, currentHp: p.currentHp, maxHp: p.maxHp });
            }
          }
          const maxHeal = lohTarget
            ? Math.min(remaining, lohTarget.knockedOut ? remaining : lohTarget.maxHp - lohTarget.currentHp)
            : remaining;
          return (
            <div className="arena-potion-overlay" onClick={() => setLohModalOpen(false)}>
              <div className="arena-potion-modal arena-loh-modal" onClick={e => e.stopPropagation()}>
                <div className="arena-potion-header">
                  <span>{'\u2728'} Lay on Hands ({remaining} HP remaining)</span>
                  <button className="arena-potion-close" onClick={() => setLohModalOpen(false)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {!lohTarget ? (
                  <div className="arena-potion-list">
                    {targets.map(t => (
                      <button
                        key={t.id}
                        className="arena-potion-item arena-potion-target"
                        onClick={() => { playSound('buttonTap'); setLohTarget(t); setLohAmount(1); }}
                      >
                        {t.avatar ? (
                          <img src={t.avatar} alt={t.name} className="arena-potion-target-avatar" />
                        ) : (
                          <div className="arena-potion-target-avatar arena-potion-target-avatar-fallback">{(t.name || '?')[0]}</div>
                        )}
                        <div className="arena-potion-item-name">
                          {t.name}
                          {t.knockedOut && <span className="arena-potion-revive-tag">KO</span>}
                          {!t.knockedOut && <span className="arena-loh-hp-tag">{t.currentHp}/{t.maxHp}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="arena-loh-amount-section">
                    <div className="arena-loh-target-name">Healing: {lohTarget.name}</div>
                    <input
                      type="range"
                      className="arena-loh-slider"
                      min={1}
                      max={maxHeal}
                      value={Math.min(lohAmount, maxHeal)}
                      onChange={e => setLohAmount(Number(e.target.value))}
                    />
                    <div className="arena-loh-amount-display">{Math.min(lohAmount, maxHeal)} HP</div>
                    <div className="arena-loh-buttons">
                      <button className="arena-btn arena-btn-no-smite" onClick={() => setLohTarget(null)}>Back</button>
                      <button
                        className="arena-btn arena-btn-layonhands"
                        onClick={() => { playSound('buttonTap'); handleLayOnHandsConfirm(lohTarget.id, Math.min(lohAmount, maxHeal)); }}
                      >
                        Heal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Admin Sprite Editor Panel */}
        {editMode && editSpriteSettings && (
          <div className="arena-edit-panel">
            <div className="arena-edit-panel-header">
              <span>Sprite Editor</span>
              <button className="arena-edit-close" onClick={() => setEditMode(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="arena-edit-section">{monster.name}</div>
            <div className="arena-edit-row">
              <label>Scale</label>
              <input type="range" min="0.3" max="2.0" step="0.05" value={editSpriteSettings.spriteScale} onChange={e => setEditSpriteSettings(s => ({ ...s, spriteScale: parseFloat(e.target.value) }))} />
              <span>{editSpriteSettings.spriteScale.toFixed(2)}</span>
            </div>
            <div className="arena-edit-row">
              <label>Offset X</label>
              <input type="range" min="-600" max="600" step="2" value={editSpriteSettings.spriteOffsetX} onChange={e => setEditSpriteSettings(s => ({ ...s, spriteOffsetX: parseInt(e.target.value) }))} />
              <span>{editSpriteSettings.spriteOffsetX}px</span>
            </div>
            <div className="arena-edit-row">
              <label>Offset Y</label>
              <input type="range" min="-600" max="600" step="2" value={editSpriteSettings.spriteOffsetY} onChange={e => setEditSpriteSettings(s => ({ ...s, spriteOffsetY: parseInt(e.target.value) }))} />
              <span>{editSpriteSettings.spriteOffsetY}px</span>
            </div>
            <div className="arena-edit-divider">Player Tiles</div>
            <div className="arena-edit-row">
              <label>Size</label>
              <input type="range" min="32" max="400" step="4" value={editArenaConfig.playerTileSize} onChange={e => setEditArenaConfig(c => ({ ...c, playerTileSize: parseInt(e.target.value) }))} />
              <span>{editArenaConfig.playerTileSize}px</span>
            </div>
            <div className="arena-edit-row">
              <label>Gap</label>
              <input type="range" min="-120" max="60" step="2" value={editArenaConfig.playerTileGap} onChange={e => setEditArenaConfig(c => ({ ...c, playerTileGap: parseInt(e.target.value) }))} />
              <span>{editArenaConfig.playerTileGap}px</span>
            </div>
            <div className="arena-edit-row">
              <label>Offset Y</label>
              <input type="range" min="-200" max="200" step="2" value={editArenaConfig.playerOffsetY || 0} onChange={e => setEditArenaConfig(c => ({ ...c, playerOffsetY: parseInt(e.target.value) }))} />
              <span>{editArenaConfig.playerOffsetY || 0}px</span>
            </div>
            <button className="arena-edit-save" onClick={handleSaveSpriteSettings} disabled={editSaving}>
              {editSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {/* Roll Result Overlay (attack/damage comparison) */}
        {rollResultOverlay && (
          <RollResultOverlay data={rollResultOverlay} onDismiss={dismissRollResult} />
        )}

        {/* Dice Overlay — local roll or spectator roll */}
        {diceRoll && (
          <Suspense fallback={null}>
            <DiceOverlay
              key={diceRoll.key || 0}
              notation={diceRoll.notation}
              colorset={diceRoll.colorset || 'white'}
              material={diceRoll.material || 'plastic'}
              modifier={diceRoll.modifier || 0}
              forcedValues={diceRoll.forcedValues}
              forcedTotal={diceRoll.forcedTotal}
              advantageType={diceRoll.advantageType}
              label={diceRoll.label}
              onResult={handleDiceResult}
              onDone={handleDiceDone}
            />
          </Suspense>
        )}
        {!diceRoll && spectatorRoll && (
          <Suspense fallback={null}>
            <DiceOverlay
              key={`spec-${spectatorRoll.id}`}
              notation={spectatorRoll.notation}
              colorset={spectatorRoll.colorset || 'white'}
              material={spectatorRoll.material || 'plastic'}
              modifier={spectatorRoll.modifier || 0}
              forcedValues={spectatorRoll.rolls}
              forcedTotal={spectatorRoll.total}
              advantageType={spectatorRoll.advantageType}
              label={spectatorRoll.label}
              onDone={handleSpectatorDone}
            />
          </Suspense>
        )}
        {/* Emote Grid Popover */}
        {emoteGridOpen && (
          <ArenaEmoteGrid
            onSelect={handleArenaEmote}
            onClose={() => setEmoteGridOpen(false)}
            favorites={favoriteEmotes}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
        {/* Emote floating popups */}
        <EmotePopup
          emotes={activeEmotes}
          onDismiss={(key) => setActiveEmotes(prev => prev.filter(e => e.key !== key))}
        />
        {/* DM Roll Control */}
        {isDM && dmEncounterId && (
          <DmRollControl
            encounterId={dmEncounterId}
            enabled={dmRollControlEnabled}
            pendingRoll={dmPendingRoll}
            onToggle={handleDmToggle}
            onResolve={handleDmResolve}
          />
        )}
        {/* Fate Overlay (non-DM players) */}
        {!isDM && <FateOverlay visible={fateOverlayVisible} />}
      </div>
    );
  }

  // ── Monster Selection (idle state) ──
  return (
    <div className="arena" onClick={() => selectedMonster && setSelectedMonster(null)}>
      <SceneAudio config={ARENA_AUDIO_CONFIGS[arenaAudioPhase]} />
      <div className="arena-header">
        <button className="arena-back" onClick={() => { playSound('buttonTap'); navigate('/map'); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="arena-header-title">The Arena</div>
        <div className="arena-header-sub">{selectedMonster ? selectedMonster.name : 'Choose your foe'}</div>
      </div>

      {/* Join Battle Overlay */}
      {selectedMonster && (() => {
        const activeFight = encounterMap[selectedMonster.id];
        const participants = overlayEncounter?.participants || {};
        const monsterHp = activeFight ? activeFight.currentHp : selectedMonster.maxHp;
        const monsterMaxHp = activeFight ? activeFight.maxHp : selectedMonster.maxHp;
        return (
          <div className="arena-join-overlay" onClick={() => { playSound('buttonTap'); setSelectedMonster(null); }}>
            <div className="arena-join-content" onClick={e => e.stopPropagation()}>
              <button className="arena-join-close" onClick={() => { playSound('buttonTap'); setSelectedMonster(null); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div className="arena-join-name">{selectedMonster.name}</div>

              {selectedMonster.image && (
                <img src={`/monsters/${selectedMonster.image}`} alt={selectedMonster.name} className="arena-join-image" />
              )}

              <div className="arena-join-stats">
                <div className="arena-join-stat arena-join-cr">
                  <span className="arena-join-stat-label">CR</span>
                  <span className="arena-join-stat-value">{selectedMonster.cr}</span>
                </div>
                <div className="arena-join-stat arena-join-hp">
                  <svg className="arena-join-heart" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  <span className="arena-join-stat-label">HP</span>
                  <span className="arena-join-stat-value">{monsterHp}/{monsterMaxHp}</span>
                </div>
                <div className="arena-join-stat arena-join-ac">
                  <svg className="arena-join-shield" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                  </svg>
                  <span className="arena-join-stat-label">AC</span>
                  <span className="arena-join-stat-value">{selectedMonster.ac}</span>
                </div>
              </div>
              <div className="arena-join-rewards">
                <div className="arena-join-reward arena-join-reward-xp">
                  <span className="arena-join-reward-value">{selectedMonster.xpReward} XP</span>
                </div>
                <div className="arena-join-reward">
                  <span className="arena-join-reward-value">{selectedMonster.goldReward} Gold</span>
                </div>
              </div>

              {activeFight && Object.keys(participants).length > 0 && (
                <div className="arena-join-participants">
                  {Object.entries(participants).map(([uid, p]) => {
                    const hpPct = Math.max(0, Math.round((p.currentHp / p.maxHp) * 100));
                    const hpColor = p.knockedOut ? '#ef4444' : hpPct > 60 ? '#4ade80' : hpPct > 30 ? '#fbbf24' : '#ef4444';
                    return (
                      <div key={uid} className={`arena-join-participant ${p.knockedOut ? 'arena-join-participant-ko' : ''}`}>
                        {p.avatar ? (
                          <img src={p.avatar} alt={p.name} className="arena-join-avatar" />
                        ) : (
                          <div className="arena-join-avatar arena-join-avatar-fallback">{(p.name || '?')[0]}</div>
                        )}
                        <div className="arena-join-participant-info">
                          <span className="arena-join-participant-name">{p.name}</span>
                          <div className="arena-join-hp-track">
                            <div className="arena-join-hp-fill" style={{ width: `${hpPct}%`, backgroundColor: hpColor }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                data-testid="arena-join-btn"
                className="arena-join-btn"
                onClick={activeFight
                  ? () => { playSound('buttonTap'); handleJoinExisting(activeFight.encounterId); }
                  : () => { playSound('buttonTap'); handleSpawnAndJoin(); }
                }
                disabled={!!spawning || joining}
              >
                {spawning ? 'Summoning...' : joining ? 'Joining...' : activeFight ? 'Join Battle' : 'Summon & Fight'}
              </button>
            </div>
          </div>
        );
      })()}

      <div className="arena-monster-grid" data-testid="arena-monster-grid">
        {!monsters ? (
          <div className="arena-loading">Loading monsters...</div>
        ) : monsters.length === 0 ? (
          <div className="arena-loading">No monsters available</div>
        ) : (
          monsters.map(m => {
            const activeFight = encounterMap[m.id];
            return (
              <button
                key={m.id}
                data-testid="arena-monster-card"
                className={`arena-monster-card ${selectedMonster?.id === m.id ? 'arena-monster-card-selected' : ''} ${activeFight ? 'arena-monster-card-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!spawning) { playSound('buttonTap'); setSelectedMonster(m); }
                }}
                disabled={!!spawning}
              >
                {m.image && (
                  <img src={`/monsters/${m.image}`} alt={m.name} className="arena-card-image" />
                )}
                <div className="arena-card-name">{m.name}</div>
                <div className="arena-card-stats">
                  <span className="arena-card-hp">HP {m.maxHp}</span>
                  <span className="arena-card-ac">AC {m.ac}</span>
                  <span className="arena-card-cr">CR {m.cr}</span>
                </div>
                {!m.image && m.description && (
                  <div className="arena-card-desc">{m.description}</div>
                )}
                {activeFight && (
                  <div className="arena-card-active-badge">
                    <span className="arena-card-badge-fighters">{activeFight.participantCount} fighting</span>
                    <span className="arena-card-badge-hp">HP {activeFight.currentHp}/{activeFight.maxHp}</span>
                  </div>
                )}
                {spawning === m.id && (
                  <div className="arena-card-spawning">Summoning...</div>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Dice Overlay (for any leftover state) */}
      {diceRoll && (
        <Suspense fallback={null}>
          <DiceOverlay
            key={diceRoll.key || 0}
            notation={diceRoll.notation}
            colorset={diceRoll.colorset || 'white'}
            material={diceRoll.material || 'plastic'}
            modifier={diceRoll.modifier || 0}
            forcedValues={diceRoll.forcedValues}
            forcedTotal={diceRoll.forcedTotal}
            advantageType={diceRoll.advantageType}
            label={diceRoll.label}
            onResult={handleDiceResult}
            onDone={handleDiceDone}
          />
        </Suspense>
      )}
      {!diceRoll && spectatorRoll && (
        <Suspense fallback={null}>
          <DiceOverlay
            key={`spec-${spectatorRoll.id}`}
            notation={spectatorRoll.notation}
            colorset={spectatorRoll.colorset || 'white'}
            material={spectatorRoll.material || 'plastic'}
            modifier={spectatorRoll.modifier || 0}
            forcedValues={spectatorRoll.rolls}
            forcedTotal={spectatorRoll.total}
            advantageType={spectatorRoll.advantageType}
            label={spectatorRoll.label}
            onDone={handleSpectatorDone}
          />
        </Suspense>
      )}
      {/* Emote Grid Popover */}
      {emoteGridOpen && (
        <ArenaEmoteGrid
          onSelect={handleArenaEmote}
          onClose={() => setEmoteGridOpen(false)}
        />
      )}
      {/* Emote floating popups */}
      <EmotePopup
        emotes={activeEmotes}
        onDismiss={(key) => setActiveEmotes(prev => prev.filter(e => e.key !== key))}
      />
      {/* DM Roll Control (visible even when not in encounter) */}
      {isDM && dmEncounterId && (
        <DmRollControl
          encounterId={dmEncounterId}
          enabled={dmRollControlEnabled}
          pendingRoll={dmPendingRoll}
          onToggle={handleDmToggle}
          onResolve={handleDmResolve}
        />
      )}
      {/* Fate Overlay (non-DM players) */}
      {!isDM && <FateOverlay visible={fateOverlayVisible} />}
    </div>
  );
}

/** Double the dice count in a notation: "1d8" → "2d8", "2d6" → "4d6" */
function doubleDice(notation) {
  return (notation || '1d4').replace(/(\d+)d/gi, (_, n) => `${parseInt(n) * 2}d`);
}

/** Parse "1d6+2" → { dice: "1d6", modifier: 2 } */
function parseDamageNotation(notation) {
  const match = (notation || '1d4').match(/^(\d+d\d+)(?:\+(\d+))?$/i);
  if (!match) return { dice: notation || '1d4', modifier: 0 };
  return { dice: match[1], modifier: parseInt(match[2] || '0', 10) };
}

/** Replace **text** with <strong>text</strong> for narration display */
function formatBold(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
