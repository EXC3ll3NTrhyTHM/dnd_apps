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

        results.push({ index: attack.index, attackRoll: d20, damageTotal });
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
                      +{r.xp} XP &middot; +{r.gold} gold
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

  const handleEncounterEvent = useCallback((payload) => {
    if (payload.locationId !== locationId) return;

    switch (payload.type) {
      case 'encounter_spawn':
        setEncounter(payload.encounter);
        setResultScreen(null);
        setMonsterRollRequest(null);
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
        break;

      case 'encounter_join':
        setEncounter(payload.encounter);
        if (payload.userId !== userId) {
          setNarrations(prev => [...prev, {
            id: `enc_join_${payload.userId}_${Date.now()}`,
            role: 'system',
            type: 'encounter',
            subtype: 'join',
            text: `**${payload.playerName}** joins the fight!`,
            timestamp: new Date().toISOString(),
          }]);
        }
        break;

      case 'encounter_action':
        setEncounter(payload.encounter);
        break;

      case 'encounter_round': {
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
        // Store the roll request — EncounterBanner will pick it up
        setMonsterRollRequest({
          encounterId: payload.encounterId,
          rollerId: payload.rollerId,
          attacks: payload.attacks,
          monsterName: payload.monsterName,
        });
        break;

      case 'encounter_monster_turn': {
        setEncounter(payload.encounter);
        setMonsterRollRequest(null);
        const monsterMsgs = (payload.attacks || []).map((a, i) => ({
          id: `enc_monster_${i}_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'combat',
          text: a.text,
          timestamp: new Date().toISOString(),
        }));
        setNarrations(prev => [...prev, {
          id: `enc_monster_header_${Date.now()}`,
          role: 'system',
          type: 'encounter',
          subtype: 'round_header',
          text: `**[Combat] Monster Strikes Back**`,
          timestamp: new Date().toISOString(),
        }, ...monsterMsgs]);
        break;
      }

      case 'encounter_new_round':
        setEncounter(payload.encounter);
        setMonsterRollRequest(null);
        break;

      case 'encounter_end':
        setEncounter(null);
        setMonsterRollRequest(null);
        if (payload.outcome === 'victory') {
          setResultScreen({
            type: 'victory',
            rewards: payload.rewards,
            deathText: payload.deathText,
            monsterName: payload.monsterName,
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
  }, [locationId, userId]);

  const clearResult = useCallback(() => {
    setResultScreen(null);
  }, []);

  const clearMonsterRollRequest = useCallback(() => {
    setMonsterRollRequest(null);
  }, []);

  return {
    encounter, setEncounter,
    resultScreen, clearResult,
    narrations, handleEncounterEvent,
    monsterRollRequest, clearMonsterRollRequest,
  };
}
