import { useRef, useCallback, useEffect } from 'react';
import { useAudioMuted } from './useAudioSettings';
import { ensureContext } from './useUiSounds';

const ARENA_SOUNDS = {
  initiativeHorn: '/sounds/arena/sfx/initiative-horn.mp3',
  yourTurn: '/sounds/arena/sfx/your-turn.mp3',
  monsterTurn: '/sounds/arena/sfx/monster-turn.mp3',
  allyTurn: '/sounds/arena/sfx/ally-turn.mp3',
  attackHit: '/sounds/arena/sfx/Hit.mp3',
  attackMiss: '/sounds/arena/sfx/attack-miss.mp3',
  attackCrit: '/sounds/arena/sfx/critical-hit.mp3',
  attackFumble: '/sounds/arena/sfx/attack-fumble.mp3',
  damageImpact: '/sounds/arena/sfx/attack-hit.mp3',
  divineSmite: '/sounds/arena/sfx/divine-smite.mp3',
  spellCast: '/sounds/arena/sfx/spell-cast.mp3',
  spellFail: '/sounds/arena/sfx/spell-fail.mp3',
  healShimmer: '/sounds/arena/sfx/heal-shimmer.mp3',
  healGulp: '/sounds/arena/sfx/heal-gulp.mp3',
  revive: '/sounds/arena/sfx/revive.mp3',
  monsterGrowl: '/sounds/arena/sfx/monster-growl.mp3',
  monsterHit: '/sounds/arena/sfx/monster-hit.mp3',
  defeatSting: '/sounds/arena/sfx/defeat-sting.mp3',
  crowdCheer: '/sounds/arena/sfx/crowd-cheer.mp3',
  crowdGasp: '/sounds/arena/sfx/crowd-gasp.mp3',
  electricSpell: '/sounds/arena/sfx/electric-spell.mp3',
  viciousMockery: '/sounds/arena/sfx/viscious-mockery.mp3',
  bardicInspiration: '/sounds/arena/sfx/bardic-inspiration.mp3',
  ensnaringStrike: '/sounds/arena/sfx/vines-growing.mp3',
  fistOfUnbrokenAir: '/sounds/arena/sfx/fist-of-unbroken-air.mp3',
  bigDamage: '/sounds/arena/sfx/big-damage.mp3',
  massiveDamage: '/sounds/arena/sfx/massive-damage.mp3',
  youSuck: '/sounds/arena/sfx/you-suck.mp3',
  youWin: '/sounds/arena/sfx/you-win.mp3',
  youLose: '/sounds/arena/sfx/you-lose.mp3',
  emoteCrying: '/sounds/arena/emotes/crying.mp3',
  emoteParty: '/sounds/arena/emotes/party.mp3',
  emoteScream: '/sounds/arena/emotes/scream.mp3',
  emoteGoblinLaugh: '/sounds/arena/emotes/goblin-laugh.mp3',
};

const ARENA_VOLUMES = {
  initiativeHorn: 0.7,
  yourTurn: 0.5,
  monsterTurn: 0.4,
  allyTurn: 0.35,
  attackHit: 0.55,
  attackMiss: 0.35,
  attackCrit: 0.8,
  attackFumble: 0.5,
  damageImpact: 0.5,
  divineSmite: 0.8,
  spellCast: 0.5,
  spellFail: 0.4,
  healShimmer: 0.45,
  healGulp: 0.5,
  revive: 0.6,
  monsterGrowl: 0.55,
  monsterHit: 0.5,
  defeatSting: 0.6,
  crowdCheer: 0.6,
  crowdGasp: 0.45,
  electricSpell: 0.7,
  viciousMockery: 0.6,
  bardicInspiration: 0.65,
  ensnaringStrike: 0.6,
  fistOfUnbrokenAir: 0.7,
  bigDamage: 1.0,
  massiveDamage: 1.0,
  youSuck: 0.7,
  youWin: 0.7,
  youLose: 0.7,
  emoteCrying: 0.5,
  emoteParty: 0.6,
  emoteScream: 0.6,
  emoteGoblinLaugh: 1.0,
};

// Fade-in durations (seconds) — sounds not listed play at full volume instantly
const ARENA_FADE_IN = {
  crowdCheer: 0.6,
};

// Lazy singleton — only loads when Arena mounts
let _arenaBuffers = {};
let _arenaPreloaded = false;

function preloadArenaSounds() {
  if (_arenaPreloaded) return;
  _arenaPreloaded = true;
  const ctx = ensureContext();
  if (!ctx) { _arenaPreloaded = false; return; }
  for (const [key, src] of Object.entries(ARENA_SOUNDS)) {
    if (_arenaBuffers[key]) continue;
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => { _arenaBuffers[key] = decoded; })
      .catch(() => { });
  }
}

export function useArenaSounds() {
  const muted = useAudioMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    preloadArenaSounds();

    const onVisibility = () => {
      const ctx = ensureContext();
      if (!ctx) return;
      if (document.hidden) {
        ctx.suspend();
      } else {
        ctx.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const play = useCallback((key) => {
    if (mutedRef.current) return;
    if (document.hidden) return;
    const ctx = ensureContext();
    if (!ctx || !_arenaBuffers[key]) return;
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const vol = ARENA_VOLUMES[key] ?? 0.4;
    const fadeIn = ARENA_FADE_IN[key];
    if (fadeIn) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + fadeIn);
    } else {
      gain.gain.value = vol;
    }
    src.buffer = _arenaBuffers[key];
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }, []);

  return play;
}
