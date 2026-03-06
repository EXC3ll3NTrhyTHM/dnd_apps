/**
 * EncounterBanner — Combat encounter UI overlay
 *
 * Shows the active encounter at the player's location:
 * - Monster HP bar and stats
 * - Action buttons (Attack, Defend, Flee)
 * - Round timer countdown
 * - Dice rolling phases (d20 attack, damage dice)
 * - Monster attack dice rolling (designated roller)
 * - Victory/defeat result screen
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../hooks/useApi';
import '../styles/encounter.css';

/**
 * Parse damage notation like "1d6+2" into { dice: "1d6", modifier: 2 }.
 * DiceOverlay strips modifiers, so we need to handle them separately.
 */
function parseDamageNotation(notation) {
  const match = (notation || '1d4').match(/^(\d+d\d+)(?:\+(\d+))?$/i);
  if (!match) return { dice: notation || '1d4', modifier: 0 };
  return { dice: match[1], modifier: parseInt(match[2] || '0', 10) };
}

export default function EncounterBanner({
  encounter,
  resultScreen,
  userId,
  onEncounterEnd,
  requestDiceRoll,
  monsterRollRequest,
  clearMonsterRollRequest,
}) {
  const [localEncounter, setLocalEncounter] = useState(encounter);
  const [actionChosen, setActionChosen] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [joining, setJoining] = useState(false);
  const [rollPhase, setRollPhase] = useState(null); // null | 'attack_roll' | 'attack_result' | 'damage_roll' | 'submitting' | 'monster_rolling'
  const [attackResult, setAttackResult] = useState(null); // { roll, total, isHit, isNat20, isNat1 }
  const [monsterRollStatus, setMonsterRollStatus] = useState(null); // text for current monster attack
  const timerRef = useRef(null);
  const rollActiveRef = useRef(false);
  const monsterRollActiveRef = useRef(false);

  // Sync from parent
  useEffect(() => {
    if (encounter) {
      setLocalEncounter(encounter);
      if (encounter.phase === 'action') {
        const myPlayer = encounter.participants?.[userId];
        if (!myPlayer?.action) {
          setActionChosen(null);
          setRollPhase(null);
          setAttackResult(null);
          setMonsterRollStatus(null);
          rollActiveRef.current = false;
        }
      }
    }
  }, [encounter, userId]);

  // Monster dice rolling — triggered when monsterRollRequest arrives
  useEffect(() => {
    if (!monsterRollRequest || !requestDiceRoll || monsterRollActiveRef.current) return;
    if (monsterRollRequest.rollerId !== userId) return;

    monsterRollActiveRef.current = true;
    setRollPhase('monster_rolling');

    async function rollMonsterAttacks() {
      const results = [];
      let dotRolls = null;

      // Roll DoT damage dice first (e.g. ensnared → green d6)
      if (monsterRollRequest.pendingDots && monsterRollRequest.pendingDots.length > 0) {
        dotRolls = {};
        for (const dot of monsterRollRequest.pendingDots) {
          setMonsterRollStatus(`🪴 ${dot.name} — ${monsterRollRequest.monsterName} takes ${dot.type} damage!`);
          const dotDice = await requestDiceRoll(dot.dice, '#22c55e');
          const dotTotal = dotDice.reduce((s, v) => s + v, 0);
          dotRolls[dot.conditionId] = dotTotal;
          await new Promise(r => setTimeout(r, 800));
        }
      }

      for (const attack of monsterRollRequest.attacks) {
        // Show which attack is happening
        setMonsterRollStatus(`${monsterRollRequest.monsterName} attacks ${attack.targetName}! Rolling d20...`);

        // Roll d20 for this attack
        const attackRolls = await requestDiceRoll('1d20', '#ef4444');
        const d20 = attackRolls[0];
        const total = d20 + attack.bonus;
        const isNat20 = d20 === 20;
        const isNat1 = d20 === 1;
        const isHit = isNat20 || (!isNat1 && total >= attack.targetAC);

        let damageTotal = 0;

        if (isHit) {
          // Show hit text briefly
          const hitText = isNat20
            ? `NAT 20! CRITICAL HIT on ${attack.targetName}! Rolling damage...`
            : `Rolled ${total} vs AC ${attack.targetAC} — Hit! Rolling damage...`;
          setMonsterRollStatus(hitText);
          await new Promise(r => setTimeout(r, 600));

          // Roll damage
          const { dice, modifier } = parseDamageNotation(attack.damageDice);
          const damageRolls = await requestDiceRoll(dice, '#ef4444');
          damageTotal = damageRolls.reduce((s, v) => s + v, 0) + modifier;

          if (isNat20) {
            // Crit: roll damage again
            const critRolls = await requestDiceRoll(dice, '#ef4444');
            damageTotal += critRolls.reduce((s, v) => s + v, 0);
          }
        } else {
          // Show miss text briefly
          const missText = isNat1
            ? `NAT 1! ${monsterRollRequest.monsterName} fumbles!`
            : `Rolled ${total} vs AC ${attack.targetAC} — Miss!`;
          setMonsterRollStatus(missText);
          await new Promise(r => setTimeout(r, 1200));
        }

        results.push({ index: attack.index, attackRoll: d20, damageTotal, dotRolls: dotRolls || undefined });
        // Only include dotRolls on the first result entry, then clear
        dotRolls = null;
      }

      // Send all results to server
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
  }, [monsterRollRequest, userId, requestDiceRoll, clearMonsterRollRequest]);

  // Countdown timer
  useEffect(() => {
    if (!localEncounter || localEncounter.phase !== 'action') return;

    const tick = () => {
      const remaining = Math.max(0, localEncounter.actionDeadline - Date.now());
      setTimeLeft(remaining);
    };

    tick();
    timerRef.current = setInterval(tick, 250);
    return () => clearInterval(timerRef.current);
  }, [localEncounter?.actionDeadline, localEncounter?.phase]);

  const isParticipant = localEncounter?.participants?.[userId];
  const isKnockedOut = isParticipant?.knockedOut;
  const monster = localEncounter?.monster;

  const handleJoin = useCallback(async () => {
    if (joining || !localEncounter) return;
    setJoining(true);
    try {
      const data = await api(`/api/encounters/${localEncounter.id}/join`, {
        method: 'POST',
      });
      setLocalEncounter(data.encounter);
    } catch (err) {
      console.error('Failed to join encounter:', err);
    } finally {
      setJoining(false);
    }
  }, [localEncounter, joining]);

  const handleAction = useCallback(async (action) => {
    if (actionChosen || !localEncounter || !isParticipant || rollActiveRef.current) return;
    setActionChosen(action);

    if (action === 'attack' && requestDiceRoll) {
      rollActiveRef.current = true;
      const myStats = localEncounter.participants[userId];

      try {
        // Phase 1: Roll d20 for attack
        setRollPhase('attack_roll');
        const attackRolls = await requestDiceRoll('1d20', '#eab308');
        const roll = attackRolls[0];
        const total = roll + (myStats.attackBonus || 0);
        const isNat20 = roll === 20;
        const isNat1 = roll === 1;
        const isHit = isNat20 || (!isNat1 && total >= localEncounter.monster.ac);

        setAttackResult({ roll, total, isHit, isNat20, isNat1 });
        setRollPhase('attack_result');

        let damageTotal = 0;

        if (isHit) {
          await new Promise(r => setTimeout(r, 800));

          // Phase 2: Roll damage dice
          setRollPhase('damage_roll');
          const damageRolls = await requestDiceRoll(myStats.damageNotation || '1d4', '#eab308');
          damageTotal = damageRolls.reduce((s, v) => s + v, 0) + (myStats.damageMod || 0);

          if (isNat20) {
            const critRolls = await requestDiceRoll(myStats.damageNotation || '1d4', '#eab308');
            damageTotal += critRolls.reduce((s, v) => s + v, 0);
          }
        }

        // Phase 3: Submit to server
        setRollPhase('submitting');
        await api(`/api/encounters/${localEncounter.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action: 'attack', attackRoll: roll, damageTotal }),
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
    } else {
      // Defend or Flee — submit directly
      try {
        await api(`/api/encounters/${localEncounter.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
      } catch (err) {
        console.error('Failed to submit action:', err);
        setActionChosen(null);
      }
    }
  }, [localEncounter, actionChosen, isParticipant, userId, requestDiceRoll]);

  // Victory/defeat overlay
  if (resultScreen) {
    return (
      <div className="enc-result-overlay">
        <div className="enc-result-card">
          {resultScreen.type === 'victory' ? (
            <>
              <div className="enc-result-icon">{'\u2694\uFE0F'}</div>
              <div className="enc-result-title">Victory!</div>
              <div className="enc-result-subtitle">{resultScreen.deathText}</div>
              <div className="enc-result-rewards">
                {Object.entries(resultScreen.rewards || {}).map(([uid, r]) => (
                  <div key={uid} className="enc-reward-row">
                    <span className="enc-reward-name">{r.name}</span>
                    <span className="enc-reward-values">
                      +{r.xp} XP
                      {r.chest ? ' \u00b7 Treasure Chest' : ` \u00b7 +${r.gold} gold`}
                      {r.share ? ` (${r.share}%)` : ''}
                    </span>
                    {r.killingBlow && <span className="enc-reward-badge">Killing Blow</span>}
                    {r.untouchable && <span className="enc-reward-badge">Untouchable</span>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="enc-result-icon">{'\u{1F480}'}</div>
              <div className="enc-result-title">Defeat</div>
              <div className="enc-result-subtitle">{resultScreen.defeatText}</div>
            </>
          )}
          <button
            className="enc-result-dismiss"
            onClick={() => onEncounterEnd?.()}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (!localEncounter || !monster) return null;

  const hpPercent = Math.max(0, Math.round((monster.currentHp / monster.maxHp) * 100));
  const hpBarColor = hpPercent > 60 ? '#4ade80' : hpPercent > 30 ? '#fbbf24' : '#ef4444';
  const timerSeconds = Math.ceil(timeLeft / 1000);
  const myStats = isParticipant ? localEncounter.participants[userId] : null;

  // Build status text for roll phases
  const getStatusText = () => {
    if (rollPhase === 'monster_rolling') {
      return monsterRollStatus || 'Monster is attacking...';
    }

    if (!actionChosen) return null;

    if (rollPhase === 'attack_roll') {
      return 'Rolling d20 to attack...';
    }

    if (rollPhase === 'attack_result' && attackResult) {
      if (attackResult.isNat1) return `Rolled ${attackResult.roll} — NAT 1! Fumble!`;
      if (attackResult.isNat20) return `Rolled ${attackResult.roll} — NAT 20! CRITICAL HIT!`;
      if (attackResult.isHit) return `Rolled ${attackResult.total} vs AC ${monster.ac} — Hit!`;
      return `Rolled ${attackResult.total} vs AC ${monster.ac} — Miss!`;
    }

    if (rollPhase === 'damage_roll') {
      const label = attackResult?.isNat20 ? 'CRIT! Rolling damage...' : 'Rolling damage...';
      return `${label} (${myStats?.weaponName || 'weapon'}: ${myStats?.damageNotation || '?'})`;
    }

    if (rollPhase === 'submitting') return 'Submitting action...';

    if (actionChosen === 'attack') {
      if (attackResult && !attackResult.isHit) {
        return `Rolled ${attackResult.isNat1 ? 'NAT 1' : attackResult.total} — Miss. Waiting for others...`;
      }
      return 'Attack submitted. Waiting for others...';
    }

    return `${actionChosen === 'defend' ? 'Defending' : 'Fleeing'}... Waiting for others...`;
  };

  // Check if we're in monster rolling phase (non-roller sees status text)
  const isMonsterRolling = rollPhase === 'monster_rolling' ||
    (monsterRollRequest && monsterRollRequest.rollerId !== userId);

  return (
    <div className="enc-banner">
      {/* Monster Info */}
      <div className="enc-monster-row">
        <div className="enc-monster-name">
          {'\u2694\uFE0F'} {monster.name}
        </div>
        <div className="enc-round">Round {localEncounter.round}</div>
      </div>

      {/* HP Bar */}
      <div className="enc-hp-row">
        <div className="enc-hp-label">HP</div>
        <div className="enc-hp-bar-track">
          <div
            className="enc-hp-bar-fill"
            style={{ width: `${hpPercent}%`, backgroundColor: hpBarColor }}
          />
        </div>
        <div className="enc-hp-text">{monster.currentHp}/{monster.maxHp}</div>
        <div className="enc-ac-badge">AC {monster.ac}</div>
      </div>

      {/* Participants */}
      {Object.keys(localEncounter.participants || {}).length > 0 && (
        <div className="enc-participants">
          {Object.entries(localEncounter.participants).map(([uid, p]) => (
            <div key={uid} className={`enc-participant ${p.knockedOut ? 'enc-ko' : ''}`}>
              <span className="enc-participant-name">{p.name}</span>
              <span className="enc-participant-hp">{p.currentHp}/{p.maxHp}</span>
              {p.action === 'chosen' && <span className="enc-participant-ready">{'\u2714'}</span>}
              {p.knockedOut && <span className="enc-participant-ko">KO</span>}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="enc-actions">
        {isMonsterRolling ? (
          <div className="enc-status-text enc-monster-status">
            {rollPhase === 'monster_rolling'
              ? (monsterRollStatus || 'Monster is attacking...')
              : `${monsterRollRequest?.monsterName || 'Monster'} is attacking...`
            }
          </div>
        ) : !isParticipant && localEncounter.phase === 'action' ? (
          <button
            className="enc-btn enc-btn-join"
            onClick={handleJoin}
            disabled={joining}
          >
            {joining ? 'Joining...' : 'Join Fight'}
          </button>
        ) : isKnockedOut ? (
          <div className="enc-status-text">You have been knocked out.</div>
        ) : actionChosen ? (
          <div className={`enc-status-text ${rollPhase === 'attack_result' && attackResult?.isNat20 ? 'enc-crit-text' : ''} ${rollPhase === 'attack_result' && attackResult?.isNat1 ? 'enc-fumble-text' : ''}`}>
            {getStatusText()}
          </div>
        ) : localEncounter.phase === 'action' && isParticipant ? (
          <>
            <button className="enc-btn enc-btn-attack" onClick={() => handleAction('attack')}>
              {'\u2694'} Attack
              {myStats && <span className="enc-btn-detail">d20+{myStats.attackBonus || 0}</span>}
            </button>
            <button className="enc-btn enc-btn-defend" onClick={() => handleAction('defend')}>
              {'\uD83D\uDEE1'} Defend
            </button>
            <button className="enc-btn enc-btn-flee" onClick={() => handleAction('flee')}>
              {'\uD83C\uDFC3'} Flee
            </button>
          </>
        ) : localEncounter.phase === 'resolving' || localEncounter.phase === 'monster_turn' || localEncounter.phase === 'monster_rolling' ? (
          <div className="enc-status-text">Resolving round...</div>
        ) : null}
      </div>

      {/* Timer */}
      {localEncounter.phase === 'action' && isParticipant && !isKnockedOut && !actionChosen && (
        <div className={`enc-timer ${timerSeconds <= 10 ? 'enc-timer-urgent' : ''}`}>
          {timerSeconds > 60
            ? `${Math.floor(timerSeconds / 60)}:${(timerSeconds % 60).toString().padStart(2, '0')}`
            : `0:${timerSeconds.toString().padStart(2, '0')}`
          } remaining
        </div>
      )}
    </div>
  );
}

/**
 * Hook to manage encounter state from WebSocket events.
 */
export function useEncounterEvents(locationId, userId) {
  const [encounter, setEncounter] = useState(null);
  const [resultScreen, setResultScreen] = useState(null);
  const [narrations, setNarrations] = useState([]);
  const [monsterRollRequest, setMonsterRollRequest] = useState(null);
  const [monsterSaveRequest, setMonsterSaveRequest] = useState(null);
  const [monsterEscapeRequest, setMonsterEscapeRequest] = useState(null);
  const [conSaveRequest, setConSaveRequest] = useState(null);
  // monsterId → { encounterId, participantCount, currentHp, maxHp }
  const [encounterMap, setEncounterMap] = useState({});
  // Initiative tracking
  const [initiativeResults, setInitiativeResults] = useState({});
  const [currentTurn, setCurrentTurn] = useState(null);

  // Use a ref to read encounter.id inside the event handler without adding it as a dependency
  const encounterRef = useRef(null);
  encounterRef.current = encounter;

  const initEncounterMap = useCallback((encounters) => {
    const map = {};
    for (const enc of encounters) {
      if (enc?.monster?.id) {
        map[enc.monster.id] = {
          encounterId: enc.id,
          participantCount: Object.keys(enc.participants || {}).length,
          currentHp: enc.monster.currentHp,
          maxHp: enc.monster.maxHp,
        };
      }
    }
    setEncounterMap(map);
  }, []);

  // Helper to update encounterMap from a payload that includes encounter state
  const updateMapFromEncounter = useCallback((enc) => {
    if (!enc?.monster?.id) return;
    setEncounterMap(prev => ({
      ...prev,
      [enc.monster.id]: {
        encounterId: enc.id,
        participantCount: Object.keys(enc.participants || {}).length,
        currentHp: enc.monster.currentHp,
        maxHp: enc.monster.maxHp,
      },
    }));
  }, []);

  const handleEncounterEvent = useCallback((payload) => {
    if (payload.locationId !== locationId) return;

    const myEncId = encounterRef.current?.id;
    const isMyEncounter = payload.encounterId && payload.encounterId === myEncId;

    switch (payload.type) {
      case 'encounter_spawn':
        // Update the encounter map — don't auto-join
        updateMapFromEncounter(payload.encounter);
        break;

      case 'encounter_join':
        updateMapFromEncounter(payload.encounter);
        // If this user just joined, set as my encounter
        if (payload.userId === userId) {
          setEncounter(payload.encounter);
          setResultScreen(null);
          setMonsterRollRequest(null);
          setInitiativeResults({});
          setCurrentTurn(null);
          setNarrations([{
            id: `enc_spawn_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'spawn',
            text: payload.encounter.monster?.description
              ? `**A ${payload.encounter.monster.name} appears!** ${payload.encounter.monster.description}`
              : `**A wild ${payload.encounter.monster?.name} appears!**`,
            timestamp: new Date().toISOString(),
          }]);
        } else if (isMyEncounter) {
          setEncounter(payload.encounter);
          setNarrations(prev => [...prev, {
            id: `enc_join_${payload.userId}_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'join',
            text: `**${payload.playerName}** joins the fight!`,
            timestamp: new Date().toISOString(),
          }]);
          // Add initiative result if included in the join broadcast
          if (payload.initiativeResult) {
            setInitiativeResults(prev => ({
              ...prev,
              [payload.userId]: {
                name: payload.playerName,
                ...payload.initiativeResult,
              },
            }));
          }
        }
        break;

      case 'encounter_action':
      case 'encounter_update':
        if (isMyEncounter) setEncounter(payload.encounter);
        break;

      case 'encounter_initiative_roll':
        if (isMyEncounter) {
          setInitiativeResults(prev => ({
            ...prev,
            [payload.userId]: {
              name: payload.playerName,
              ...payload.initiativeResult,
            },
          }));
          setNarrations(prev => [...prev, {
            id: `enc_init_${payload.userId}_${Date.now()}`,
            role: 'system', type: 'encounter', subtype: 'initiative',
            text: `**${payload.playerName}** rolls initiative: **${payload.initiativeResult.total}** (${payload.initiativeResult.roll} + ${payload.initiativeResult.modifier})`,
            timestamp: new Date().toISOString(),
          }]);
        }
        break;

      case 'encounter_initiative_complete':
        updateMapFromEncounter(payload.encounter);
        if (isMyEncounter || (payload.encounter &&
          Object.keys(payload.encounter.participants || {}).includes(userId))) {
          setEncounter(payload.encounter);
          // Sync ref immediately so the next WS event (e.g. monster_roll_needed)
          // can check isMyEncounter before React re-renders
          encounterRef.current = payload.encounter;
          const orderText = payload.initiativeOrder
            .map((e, i) => `${i + 1}. **${e.name}** (${e.total})`)
            .join('\n');
          setNarrations(prev => [...prev, {
            id: `enc_init_order_${Date.now()}`,
            role: 'system', type: 'encounter', subtype: 'round_header',
            text: `**[Initiative Order]**\n${orderText}`,
            timestamp: new Date().toISOString(),
          }]);
          // Set first turn
          if (payload.initiativeOrder?.length > 0) {
            const firstEntry = payload.encounter?.initiativeOrder?.[payload.encounter?.currentTurnIndex || 0];
            setCurrentTurn(firstEntry || payload.initiativeOrder[0]);
          }
        }
        break;

      case 'encounter_initiative_update':
        updateMapFromEncounter(payload.encounter);
        if (isMyEncounter) {
          setEncounter(payload.encounter);
        }
        break;

      case 'encounter_turn_start':
        if (isMyEncounter) {
          setEncounter(payload.encounter);
          setCurrentTurn(payload.currentTurn);
          setMonsterRollRequest(null);
          setMonsterSaveRequest(null);
          setMonsterEscapeRequest(null);
          setConSaveRequest(null);
        }
        break;

      case 'encounter_turn_result':
        updateMapFromEncounter(payload.encounter);
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          if (payload.result) {
            const turnMsgs = [{
              id: `enc_turn_${Date.now()}`,
              role: 'system', type: 'encounter', subtype: 'combat',
              text: payload.result.text,
              timestamp: new Date().toISOString(),
            }];
            // Ensnaring Strike save result — show as separate prominent narration
            if (payload.result.ensnaringStrikeResult) {
              turnMsgs.push({
                id: `enc_es_save_${Date.now()}`,
                role: 'system', type: 'encounter', subtype: 'combat',
                text: payload.result.ensnaringStrikeResult.text,
                timestamp: new Date().toISOString(),
              });
            }
            setNarrations(prev => [...prev, ...turnMsgs]);
          }
        }
        break;

      case 'encounter_bonus_phase':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
        }
        break;

      case 'encounter_bonus_result':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          if (payload.result) {
            setNarrations(prev => [...prev, {
              id: `enc_bonus_${Date.now()}`,
              role: 'system', type: 'encounter', subtype: 'combat',
              text: payload.result.text,
              timestamp: new Date().toISOString(),
            }]);
          }
        }
        break;

      case 'encounter_round': {
        if (!isMyEncounter) break;
        const msgs = (payload.results || []).map((r, i) => ({
          id: `enc_round_${payload.round}_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: r.text,
          timestamp: new Date().toISOString(),
        }));
        setNarrations(prev => [...prev, {
          id: `enc_round_header_${payload.round}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'round_header',
          text: `**[Combat] Round ${payload.round} \u2014 Player Attacks**`,
          timestamp: new Date().toISOString(),
        }, ...msgs]);
        break;
      }

      case 'encounter_monster_roll_needed':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          setMonsterRollRequest({
            encounterId: payload.encounterId,
            rollerId: payload.rollerId,
            attacks: payload.attacks,
            monsterName: payload.monsterName,
            pendingDots: payload.pendingDots || null,
          });
        }
        break;

      case 'encounter_monster_escape_needed':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          setMonsterEscapeRequest({
            encounterId: payload.encounterId,
            rollerId: payload.rollerId,
            pendingEscapes: payload.pendingEscapes,
            pendingDots: payload.pendingDots || null,
            monsterName: payload.monsterName,
          });
        }
        break;

      case 'encounter_monster_turn': {
        updateMapFromEncounter(payload.encounter);
        if (!isMyEncounter) break;
        // Only update encounter if payload has one — on defeat the server
        // deletes the encounter before broadcasting, sending null here.
        // Keeping the old state preserves encounterRef.id so encounter_end
        // can match isMyEncounter and show the defeat screen.
        if (payload.encounter) setEncounter(payload.encounter);
        setMonsterRollRequest(null);
        setMonsterSaveRequest(null);
        setMonsterEscapeRequest(null);
        setConSaveRequest(null);
        const monsterMsgs = (payload.attacks || []).map((a, i) => ({
          id: `enc_monster_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: a.text,
          timestamp: new Date().toISOString(),
        }));
        // Narrate monster condition expiry (e.g., "Mocked effect has worn off")
        const condMsgs = [];
        const mfx = payload.monsterConditionEffects;
        if (mfx) {
          // Narrate DoT damage (e.g. Ensnaring Strike piercing damage)
          for (const dot of (mfx.dotEffects || [])) {
            condMsgs.push({
              id: `enc_mdot_${dot.id}_${Date.now()}`,
              role: 'system',
              type: 'encounter',
              subtype: 'combat',
              text: `**${dot.name}** deals **${dot.damage} ${dot.type}** damage to the monster!`,
              timestamp: new Date().toISOString(),
            });
          }
          for (const rem of (mfx.removed || [])) {
            condMsgs.push({
              id: `enc_mcond_rem_${rem.id}_${Date.now()}`,
              role: 'system',
              type: 'encounter',
              subtype: 'combat',
              text: `The **${rem.name}** effect on the monster has worn off.`,
              timestamp: new Date().toISOString(),
            });
          }
        }
        // Narrate concentration saves as separate messages
        const concSaveMsgs = (payload.concentrationSaves || []).map((cs, i) => ({
          id: `enc_consave_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: cs.conSave
            ? (cs.broken
              ? `${cs.playerName} CON save: **${cs.conSave.total}** (${cs.conSave.roll}+${cs.conSave.conMod}) vs DC ${cs.conSave.dc} — **Failed!** Concentration on **${cs.spellName}** is broken!`
              : `${cs.playerName} CON save: **${cs.conSave.total}** (${cs.conSave.roll}+${cs.conSave.conMod}) vs DC ${cs.conSave.dc} — **Saved!** Maintains concentration on **${cs.spellName}**.`)
            : `${cs.playerName}'s concentration on **${cs.spellName}** is broken!`,
          timestamp: new Date().toISOString(),
        }));
        // Narrate escape attempts (Nature's Wrath — monster spends action to escape)
        const escapeMsgs = (payload.escapeAttempts || []).map((ea, i) => ({
          id: `enc_mescape_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: ea.text,
          timestamp: new Date().toISOString(),
        }));
        const hasEscapeAttempts = escapeMsgs.length > 0;
        const headerText = hasEscapeAttempts && monsterMsgs.length === 0
          ? `**[Combat] Monster Struggles**`
          : `**[Combat] Monster Strikes Back**`;
        setNarrations(prev => [...prev, {
          id: `enc_monster_header_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'round_header',
          text: headerText,
          timestamp: new Date().toISOString(),
        }, ...monsterMsgs, ...condMsgs, ...concSaveMsgs, ...escapeMsgs]);
        break;
      }

      case 'encounter_monster_save_needed':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          setMonsterSaveRequest({
            encounterId: payload.encounterId,
            rollerId: payload.rollerId,
            pendingSaves: payload.pendingSaves,
            monsterName: payload.monsterName,
          });
        }
        break;

      case 'encounter_monster_saves': {
        updateMapFromEncounter(payload.encounter);
        if (!isMyEncounter) break;
        if (payload.encounter) setEncounter(payload.encounter);
        setMonsterSaveRequest(null);
        // Narrate save results
        const mSaveMsgs = [];
        for (const save of (payload.saveResults || [])) {
          const monsterName = payload.encounter?.monster?.name || 'The monster';
          const saveText = save.saved
            ? `${monsterName} rolls ${save.saveAbility} save: **${save.total}** vs DC ${save.saveDC} — **Saved!** **${save.name}** ends!`
            : `${monsterName} rolls ${save.saveAbility} save: **${save.total}** vs DC ${save.saveDC} — **Failed!** **${save.name}** persists.`;
          mSaveMsgs.push({
            id: `enc_msave_${save.id}_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'combat',
            text: saveText,
            timestamp: new Date().toISOString(),
          });
        }
        if (mSaveMsgs.length > 0) {
          setNarrations(prev => [...prev, ...mSaveMsgs]);
        }
        break;
      }

      case 'encounter_con_save_needed':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          setConSaveRequest({
            encounterId: payload.encounterId,
            pendingConSaves: payload.pendingConSaves,
          });
        }
        break;

      case 'encounter_con_save_results': {
        updateMapFromEncounter(payload.encounter);
        if (!isMyEncounter) break;
        if (payload.encounter) setEncounter(payload.encounter);
        setConSaveRequest(null);
        // Narrate concentration save results
        const conSaveMsgs = (payload.conSaveResults || []).map((cs, i) => ({
          id: `enc_consave_result_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: cs.conSave
            ? (cs.broken
              ? `${cs.playerName} CON save: **${cs.conSave.total}** (${cs.conSave.roll}+${cs.conSave.conMod}) vs DC ${cs.conSave.dc} — **Failed!** Concentration on **${cs.spellName}** is broken!`
              : `${cs.playerName} CON save: **${cs.conSave.total}** (${cs.conSave.roll}+${cs.conSave.conMod}) vs DC ${cs.conSave.dc} — **Saved!** Maintains concentration on **${cs.spellName}**.`)
            : `${cs.playerName}'s concentration on **${cs.spellName}** is broken!`,
          timestamp: new Date().toISOString(),
        }));
        if (conSaveMsgs.length > 0) {
          setNarrations(prev => [...prev, ...conSaveMsgs]);
        }
        break;
      }

      case 'encounter_new_round':
        updateMapFromEncounter(payload.encounter);
        if (isMyEncounter) {
          setEncounter(payload.encounter);
          setMonsterRollRequest(null);
          setMonsterSaveRequest(null);
          setMonsterEscapeRequest(null);
          setConSaveRequest(null);
        }
        break;

      case 'encounter_turn_skip':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          addNarration({
            id: `enc_skip_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'combat',
            text: `**${payload.name}** is **${payload.reason}** and cannot act!`,
            timestamp: new Date().toISOString(),
          });
        }
        break;

      case 'encounter_monster_turn_skipped':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          addNarration({
            id: `enc_monster_skip_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'combat',
            text: `**${payload.monsterName}** is **${payload.reason}** and cannot act!`,
            timestamp: new Date().toISOString(),
          });
        }
        break;

      case 'encounter_condition_tick':
        if (isMyEncounter) {
          if (payload.encounter) setEncounter(payload.encounter);
          const fx = payload.conditionEffects;
          if (fx) {
            for (const dot of (fx.dotEffects || [])) {
              addNarration({
                id: `enc_dot_${dot.id}_${Date.now()}`,
                role: 'system',
                type: 'encounter',
                subtype: 'combat',
                text: `**${dot.name}** deals **${dot.damage} ${dot.type} damage!**`,
                timestamp: new Date().toISOString(),
              });
            }
            for (const rem of (fx.removed || [])) {
              addNarration({
                id: `enc_cond_rem_${rem.id}_${Date.now()}`,
                role: 'system',
                type: 'encounter',
                subtype: 'combat',
                text: `The **${rem.name}** effect has worn off.`,
                timestamp: new Date().toISOString(),
              });
            }
            if (fx.rageExpired) {
              const rageText = fx.rageExpiredReason === 'no_attack'
                ? `**${fx.rageExpiredName || 'The barbarian'}'s** rage fades — no attack made and no damage taken.`
                : `**${fx.rageExpiredName || 'The barbarian'}'s** rage has subsided.`;
              addNarration({
                id: `enc_rage_expired_${Date.now()}`,
                role: 'system',
                type: 'encounter',
                subtype: 'combat',
                text: rageText,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
        break;

      case 'encounter_end': {
        // Remove from encounter map
        const monsterId = payload.encounter?.monster?.id;
        if (monsterId) {
          setEncounterMap(prev => {
            const next = { ...prev };
            delete next[monsterId];
            return next;
          });
        } else if (payload.encounterId) {
          // Find by encounterId if no monster data in payload
          setEncounterMap(prev => {
            const next = { ...prev };
            for (const [mid, entry] of Object.entries(next)) {
              if (entry.encounterId === payload.encounterId) {
                delete next[mid];
                break;
              }
            }
            return next;
          });
        }

        if (!isMyEncounter) break;
        setMonsterRollRequest(null);
        setMonsterSaveRequest(null);
        setMonsterEscapeRequest(null);
        setConSaveRequest(null);
        setInitiativeResults({});
        setCurrentTurn(null);
        // Keep encounter alive for victory/defeat so the battle screen
        // stays visible while dice animations finish. Clear on dismiss.
        const hasResultScreen = payload.outcome === 'victory' || payload.outcome === 'defeat';
        if (!hasResultScreen) setEncounter(null);
        if (payload.outcome === 'victory') {
          setResultScreen({
            type: 'victory',
            rewards: payload.rewards,
            deathText: payload.deathText,
            monsterName: payload.monsterName,
            achievements: payload.achievements,
            completedGoals: payload.completedGoals,
          });
          setNarrations(prev => [...prev, {
            id: `enc_victory_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'victory',
            text: `**Victory!** ${payload.deathText || 'The monster falls!'}`,
            timestamp: new Date().toISOString(),
          }]);
        } else if (payload.outcome === 'defeat') {
          setResultScreen({
            type: 'defeat',
            defeatText: payload.defeatText,
          });
          setNarrations(prev => [...prev, {
            id: `enc_defeat_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'defeat',
            text: `**Defeat!** ${payload.defeatText || 'The party falls...'}`,
            timestamp: new Date().toISOString(),
          }]);
        } else if (payload.outcome === 'fled') {
          setNarrations(prev => [...prev, {
            id: `enc_fled_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'defeat',
            text: payload.defeatText || 'The party flees...',
            timestamp: new Date().toISOString(),
          }]);
        } else if (payload.outcome === 'timeout') {
          setNarrations(prev => [...prev, {
            id: `enc_timeout_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'timeout',
            text: payload.defeatText || 'The creature retreats into the shadows...',
            timestamp: new Date().toISOString(),
          }]);
        }
        break;
      }
    }
  }, [locationId, userId, updateMapFromEncounter]);

  const clearResult = useCallback(() => {
    setResultScreen(null);
    setEncounter(null);
  }, []);

  const clearMonsterRollRequest = useCallback(() => {
    setMonsterRollRequest(null);
  }, []);

  const clearMonsterSaveRequest = useCallback(() => {
    setMonsterSaveRequest(null);
  }, []);

  const clearMonsterEscapeRequest = useCallback(() => {
    setMonsterEscapeRequest(null);
  }, []);

  const clearConSaveRequest = useCallback(() => {
    setConSaveRequest(null);
  }, []);

  return {
    encounter, setEncounter,
    encounterMap, initEncounterMap,
    resultScreen, clearResult,
    narrations, handleEncounterEvent,
    monsterRollRequest, clearMonsterRollRequest,
    monsterSaveRequest, clearMonsterSaveRequest,
    monsterEscapeRequest, clearMonsterEscapeRequest,
    conSaveRequest, clearConSaveRequest,
    initiativeResults, setInitiativeResults,
    currentTurn, setCurrentTurn,
  };
}
