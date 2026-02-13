/**
 * Arena — Full-screen battle page
 *
 * Player-initiated combat: pick a monster from the grid, fight it.
 * Other players arriving mid-fight see the active encounter and can join.
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useEncounterEvents } from '../components/EncounterBanner';
import '../styles/arena.css';

const DiceOverlay = lazy(() => import('../components/DiceOverlay'));

export default function Arena() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const locationId = 'the_arena';

  // Monster selection state
  const [monsters, setMonsters] = useState(null);
  const [spawning, setSpawning] = useState(null); // monsterId being spawned

  // Encounter state via shared hook
  const {
    encounter: activeEncounter,
    setEncounter: setActiveEncounter,
    resultScreen: encounterResult,
    clearResult: clearEncounterResult,
    narrations: encounterNarrations,
    handleEncounterEvent,
    monsterRollRequest,
    clearMonsterRollRequest,
  } = useEncounterEvents(locationId, user?.id);

  // Combat UI state
  const [actionChosen, setActionChosen] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [joining, setJoining] = useState(false);
  const [rollPhase, setRollPhase] = useState(null);
  const [attackResult, setAttackResult] = useState(null);
  const [monsterRollStatus, setMonsterRollStatus] = useState(null);
  const timerRef = useRef(null);
  const rollActiveRef = useRef(false);
  const monsterRollActiveRef = useRef(false);
  const combatLogRef = useRef(null);

  // Dice overlay state
  const [diceRoll, setDiceRoll] = useState(null);
  const encounterDiceRef = useRef(null);
  const diceRollKeyRef = useRef(0);

  // Spectator dice queue (3D dice overlay for other players' rolls)
  const spectatorQueueRef = useRef([]);
  const [spectatorRoll, setSpectatorRoll] = useState(null);
  const [queueTick, setQueueTick] = useState(0);

  // Presence
  const [presence, setPresence] = useState([]);

  // ── Fetch monster list ──
  useEffect(() => {
    api('/api/encounters/monsters/arena')
      .then(data => setMonsters(data.monsters || []))
      .catch(() => setMonsters([]));
  }, []);

  // ── Check for active encounter on mount ──
  useEffect(() => {
    api(`/api/encounters/active/${locationId}`).then(data => {
      if (data.encounter) setActiveEncounter(data.encounter);
    }).catch(() => {});
  }, []);

  // ── WebSocket ──
  // Use refs so the WS effect doesn't reconnect when callbacks change
  const handleEncounterEventRef = useRef(handleEncounterEvent);
  handleEncounterEventRef.current = handleEncounterEvent;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

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
      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.locationId !== locationId) return;
          if (payload.type?.startsWith('encounter_')) {
            handleEncounterEventRef.current(payload);
          }
          if (payload.type === 'arena_dice_roll' && payload.senderId !== userIdRef.current) {
            spectatorQueueRef.current.push({ id: Date.now() + Math.random(), ...payload });
            setQueueTick(t => t + 1);
          }
        } catch {}
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
    }).catch(() => {});

    const fetchPresence = () => {
      api('/api/presence').then(data => {
        setPresence(data?.presence?.[locationId] || []);
      }).catch(() => {});
    };
    fetchPresence();

    const interval = setInterval(() => {
      api('/api/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ locationId })
      }).catch(() => {});
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

  // ── Sync encounter state → reset action state on new round ──
  useEffect(() => {
    if (activeEncounter?.phase === 'action') {
      const myPlayer = activeEncounter.participants?.[user?.id];
      if (!myPlayer?.action) {
        setActionChosen(null);
        setRollPhase(null);
        setAttackResult(null);
        setMonsterRollStatus(null);
        rollActiveRef.current = false;
      }
    }
  }, [activeEncounter, user?.id]);

  // ── Countdown timer ──
  useEffect(() => {
    if (!activeEncounter || activeEncounter.phase !== 'action') return;
    const tick = () => {
      setTimeLeft(Math.max(0, activeEncounter.actionDeadline - Date.now()));
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => clearInterval(timerRef.current);
  }, [activeEncounter?.actionDeadline, activeEncounter?.phase]);

  // ── Auto-scroll combat log ──
  useEffect(() => {
    const el = combatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [encounterNarrations]);

  // ── Dice roll promise pattern ──
  const requestDiceRoll = useCallback((notation, color, modifier) => {
    // Dismiss spectator overlay to free the dice canvas for the local roll
    setSpectatorRoll(null);
    return new Promise((resolve) => {
      encounterDiceRef.current = { resolve, rolls: null };
      diceRollKeyRef.current += 1;
      setDiceRoll({ notation, diceColor: color || '#eab308', modifier: modifier || 0, key: diceRollKeyRef.current });

      // Safety timeout — if DiceOverlay crashes (e.g. iOS WebGL failure),
      // fall back to random rolls so the encounter doesn't hang
      setTimeout(() => {
        if (encounterDiceRef.current?.resolve === resolve) {
          console.warn('[Arena] Dice roll timed out, generating fallback rolls');
          encounterDiceRef.current = null;
          setDiceRoll(null);
          const match = notation.match(/(\d+)d(\d+)/i);
          const count = match ? parseInt(match[1]) : 1;
          const sides = match ? parseInt(match[2]) : 20;
          const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
          resolve(rolls);
        }
      }, 8000);
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

  // ── Broadcast a dice roll to all arena spectators ──
  const broadcastRoll = useCallback((notation, modifier, total, color, label) => {
    api('/api/encounters/roll-broadcast', {
      method: 'POST',
      body: JSON.stringify({ notation, modifier, total, color, label, locationId }),
    }).catch(() => {});
  }, [locationId]);

  // ── Spectator dice queue: show next queued roll when nothing else is rolling ──
  useEffect(() => {
    if (!diceRoll && !spectatorRoll && spectatorQueueRef.current.length > 0) {
      const next = spectatorQueueRef.current.shift();
      setSpectatorRoll(next);
    }
  }, [diceRoll, spectatorRoll, queueTick]);

  const handleSpectatorDone = useCallback(() => {
    setSpectatorRoll(null);
  }, []);

  // ── Monster dice rolling ──
  useEffect(() => {
    if (!monsterRollRequest || monsterRollActiveRef.current) return;
    if (monsterRollRequest.rollerId !== user?.id) return;

    monsterRollActiveRef.current = true;
    setRollPhase('monster_rolling');

    async function rollMonsterAttacks() {
      const results = [];

      for (const attack of monsterRollRequest.attacks) {
        setMonsterRollStatus(`${monsterRollRequest.monsterName} attacks ${attack.targetName}! Rolling d20...`);

        const attackRolls = await requestDiceRoll('1d20', '#ef4444', attack.bonus);
        const d20 = attackRolls[0];
        const total = d20 + attack.bonus;
        broadcastRoll('1d20', attack.bonus, total, '#ef4444', `${monsterRollRequest.monsterName} attacks ${attack.targetName}`);
        const isNat20 = d20 === 20;
        const isNat1 = d20 === 1;
        const isHit = isNat20 || (!isNat1 && total >= attack.targetAC);

        let damageTotal = 0;

        if (isHit) {
          const hitText = isNat20
            ? `NAT 20! CRITICAL HIT on ${attack.targetName}! Rolling damage...`
            : `Rolled ${total} vs AC ${attack.targetAC} \u2014 Hit! Rolling damage...`;
          setMonsterRollStatus(hitText);
          await new Promise(r => setTimeout(r, 600));

          const { dice, modifier } = parseDamageNotation(attack.damageDice);
          const damageRolls = await requestDiceRoll(dice, '#ef4444', modifier);
          const dmgTotal = damageRolls.reduce((s, v) => s + v, 0) + modifier;
          damageTotal = dmgTotal;
          broadcastRoll(dice, modifier, dmgTotal, '#ef4444', `${monsterRollRequest.monsterName} rolls damage`);

          if (isNat20) {
            const critRolls = await requestDiceRoll(dice, '#ef4444', 0);
            const critDmg = critRolls.reduce((s, v) => s + v, 0);
            damageTotal += critDmg;
            broadcastRoll(dice, 0, critDmg, '#ef4444', `${monsterRollRequest.monsterName} crits!`);
          }
        } else {
          const missText = isNat1
            ? `NAT 1! ${monsterRollRequest.monsterName} fumbles!`
            : `Rolled ${total} vs AC ${attack.targetAC} \u2014 Miss!`;
          setMonsterRollStatus(missText);
          await new Promise(r => setTimeout(r, 1200));
        }

        results.push({ index: attack.index, attackRoll: d20, damageTotal });
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
  }, [monsterRollRequest, user?.id, requestDiceRoll, clearMonsterRollRequest, broadcastRoll]);

  // ── Spawn monster ──
  const handleSpawn = useCallback(async (monsterId) => {
    if (spawning) return;
    setSpawning(monsterId);
    try {
      const data = await api('/api/encounters/spawn', {
        method: 'POST',
        body: JSON.stringify({ locationId, monsterId }),
      });
      if (data.encounter) setActiveEncounter(data.encounter);
    } catch (err) {
      console.error('Failed to spawn encounter:', err);
    } finally {
      setSpawning(null);
    }
  }, [spawning, locationId]);

  // ── Join encounter ──
  const handleJoin = useCallback(async () => {
    if (joining || !activeEncounter) return;
    setJoining(true);
    try {
      const data = await api(`/api/encounters/${activeEncounter.id}/join`, {
        method: 'POST',
      });
      setActiveEncounter(data.encounter);
    } catch (err) {
      console.error('Failed to join encounter:', err);
    } finally {
      setJoining(false);
    }
  }, [activeEncounter, joining]);

  // ── Submit action ──
  const handleAction = useCallback(async (action) => {
    if (actionChosen || !activeEncounter || rollActiveRef.current) return;
    const isParticipant = activeEncounter.participants?.[user?.id];
    if (!isParticipant) return;

    setActionChosen(action);

    if (action === 'attack') {
      rollActiveRef.current = true;
      const myStats = activeEncounter.participants[user.id];

      try {
        setRollPhase('attack_roll');
        const atkBonus = myStats.attackBonus || 0;
        const pName = myStats.name || user?.characterName || user?.username || 'Player';
        const attackRolls = await requestDiceRoll('1d20', '#eab308', atkBonus);
        const roll = attackRolls[0];
        const total = roll + atkBonus;
        broadcastRoll('1d20', atkBonus, total, '#eab308', `${pName} rolls to attack`);
        const isNat20 = roll === 20;
        const isNat1 = roll === 1;
        const isHit = isNat20 || (!isNat1 && total >= activeEncounter.monster.ac);

        setAttackResult({ roll, total, isHit, isNat20, isNat1 });
        setRollPhase('attack_result');

        let damageTotal = 0;

        if (isHit) {
          await new Promise(r => setTimeout(r, 800));
          setRollPhase('damage_roll');
          const dmgMod = myStats.damageMod || 0;
          const damageRolls = await requestDiceRoll(myStats.damageNotation || '1d4', '#eab308', dmgMod);
          damageTotal = damageRolls.reduce((s, v) => s + v, 0) + dmgMod;
          broadcastRoll(myStats.damageNotation || '1d4', dmgMod, damageTotal, '#eab308', `${pName} rolls damage`);

          if (isNat20) {
            const critRolls = await requestDiceRoll(myStats.damageNotation || '1d4', '#eab308', 0);
            const critDmg = critRolls.reduce((s, v) => s + v, 0);
            damageTotal += critDmg;
            broadcastRoll(myStats.damageNotation || '1d4', 0, critDmg, '#eab308', `${pName} crits!`);
          }
        }

        setRollPhase('submitting');
        await api(`/api/encounters/${activeEncounter.id}/action`, {
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
  }, [activeEncounter, actionChosen, user?.id, requestDiceRoll, broadcastRoll]);

  // ── Dismiss result → back to monster picker ──
  const handleDismissResult = useCallback(() => {
    clearEncounterResult();
    setActionChosen(null);
    setRollPhase(null);
    setAttackResult(null);
    setMonsterRollStatus(null);
  }, [clearEncounterResult]);

  // ── Derived state ──
  const monster = activeEncounter?.monster;
  const isParticipant = activeEncounter?.participants?.[user?.id];
  const isKnockedOut = isParticipant?.knockedOut;
  const myStats = isParticipant ? activeEncounter.participants[user.id] : null;
  const timerSeconds = Math.ceil(timeLeft / 1000);

  const hpPercent = monster ? Math.max(0, Math.round((monster.currentHp / monster.maxHp) * 100)) : 0;
  const hpBarColor = hpPercent > 60 ? '#4ade80' : hpPercent > 30 ? '#fbbf24' : '#ef4444';

  const isMonsterRolling = rollPhase === 'monster_rolling' ||
    (monsterRollRequest && monsterRollRequest.rollerId !== user?.id);

  const getStatusText = () => {
    if (rollPhase === 'monster_rolling') {
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
    if (rollPhase === 'submitting') return 'Submitting action...';
    if (actionChosen === 'attack') {
      if (attackResult && !attackResult.isHit) {
        return `Rolled ${attackResult.isNat1 ? 'NAT 1' : attackResult.total} \u2014 Miss. Waiting for others...`;
      }
      return 'Attack submitted. Waiting for others...';
    }
    return `${actionChosen === 'defend' ? 'Defending' : 'Fleeing'}... Waiting for others...`;
  };

  // ── Result overlay ──
  if (encounterResult) {
    return (
      <div className="arena">
        <div className="arena-result-overlay">
          <div className="arena-result-card">
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
            <button
              className="arena-result-dismiss"
              onClick={handleDismissResult}
            >
              Continue
            </button>
          </div>
        </div>

        {diceRoll && (
          <Suspense fallback={null}>
            <DiceOverlay
              key={diceRoll.key || 0}
              notation={diceRoll.notation}
              themeColor={diceRoll.diceColor || '#F97316'}
              modifier={diceRoll.modifier || 0}
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
              themeColor={spectatorRoll.color || '#F97316'}
              modifier={spectatorRoll.modifier || 0}
              forcedTotal={spectatorRoll.total}
              label={spectatorRoll.label}
              onDone={handleSpectatorDone}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // ── Active fight (only for participants) ──
  if (activeEncounter && monster && isParticipant) {
    return (
      <div className="arena">
        {/* Header */}
        <div className="arena-header">
          <button className="arena-back" onClick={() => navigate('/map')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="arena-header-title">The Arena</div>
          <div className="arena-round">Round {activeEncounter.round}</div>
        </div>

        {/* Monster Panel */}
        <div className="arena-monster-panel">
          <div className="arena-monster-name">{'\u2694\uFE0F'} {monster.name}</div>
          <div className="arena-hp-row">
            <div className="arena-hp-label">HP</div>
            <div className="arena-hp-track">
              <div
                className="arena-hp-fill"
                style={{ width: `${hpPercent}%`, backgroundColor: hpBarColor }}
              />
            </div>
            <div className="arena-hp-text">{monster.currentHp}/{monster.maxHp}</div>
            <div className="arena-ac-badge">AC {monster.ac}</div>
          </div>
        </div>

        {/* Combat Log */}
        <div className="arena-combat-log" ref={combatLogRef}>
          {encounterNarrations.map((n) => (
            <div
              key={n.id}
              className={`arena-log-entry ${
                n.subtype === 'round_header' ? 'arena-log-header' :
                n.subtype === 'victory' ? 'arena-log-victory' :
                n.subtype === 'defeat' ? 'arena-log-defeat' :
                'arena-log-combat'
              }`}
              dangerouslySetInnerHTML={{ __html: formatBold(n.text) }}
            />
          ))}
        </div>

        {/* Player HP Bars */}
        {Object.keys(activeEncounter.participants || {}).length > 0 && (
          <div className="arena-players">
            {Object.entries(activeEncounter.participants).map(([uid, p]) => {
              const pHpPct = Math.max(0, Math.round((p.currentHp / p.maxHp) * 100));
              const pHpColor = p.knockedOut ? '#ef4444' : pHpPct > 60 ? '#4ade80' : pHpPct > 30 ? '#fbbf24' : '#ef4444';
              const isMe = uid === user?.id;
              return (
                <div key={uid} className={`arena-player-row ${p.knockedOut ? 'arena-player-ko' : ''} ${isMe ? 'arena-player-me' : ''}`}>
                  <div className="arena-player-info">
                    <span className="arena-player-name">{p.name}{isMe ? ' (you)' : ''}</span>
                    {p.action === 'chosen' && <span className="arena-player-ready">{'\u2714'}</span>}
                    {p.knockedOut && <span className="arena-player-ko-badge">KO</span>}
                  </div>
                  <div className="arena-player-hp-row">
                    <div className="arena-player-hp-track">
                      <div
                        className="arena-player-hp-fill"
                        style={{ width: `${pHpPct}%`, backgroundColor: pHpColor }}
                      />
                    </div>
                    <span className="arena-player-hp-text">{p.currentHp}/{p.maxHp}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Action Panel */}
        <div className="arena-actions">
          {isMonsterRolling ? (
            <div className="arena-status-text arena-monster-status">
              {rollPhase === 'monster_rolling'
                ? (monsterRollStatus || 'Monster is attacking...')
                : `${monsterRollRequest?.monsterName || 'Monster'} is attacking...`
              }
            </div>
          ) : !isParticipant && activeEncounter.phase === 'action' ? (
            <button
              className="arena-btn arena-btn-join"
              onClick={handleJoin}
              disabled={joining}
            >
              {joining ? 'Joining...' : 'Join Fight'}
            </button>
          ) : isKnockedOut ? (
            <div className="arena-status-text">You have been knocked out.</div>
          ) : actionChosen ? (
            <div className={`arena-status-text ${rollPhase === 'attack_result' && attackResult?.isNat20 ? 'arena-crit-text' : ''} ${rollPhase === 'attack_result' && attackResult?.isNat1 ? 'arena-fumble-text' : ''}`}>
              {getStatusText()}
            </div>
          ) : activeEncounter.phase === 'action' && isParticipant ? (
            <>
              <button className="arena-btn arena-btn-attack" onClick={() => handleAction('attack')}>
                {'\u2694'} Attack
                {myStats && <span className="arena-btn-detail">d20+{myStats.attackBonus || 0}</span>}
              </button>
              <button className="arena-btn arena-btn-defend" onClick={() => handleAction('defend')}>
                {'\uD83D\uDEE1'} Defend
              </button>
              <button className="arena-btn arena-btn-flee" onClick={() => handleAction('flee')}>
                {'\uD83C\uDFC3'} Flee
              </button>
            </>
          ) : activeEncounter.phase === 'resolving' || activeEncounter.phase === 'monster_turn' || activeEncounter.phase === 'monster_rolling' ? (
            <div className="arena-status-text">Resolving round...</div>
          ) : null}
        </div>

        {/* Timer */}
        {activeEncounter.phase === 'action' && isParticipant && !isKnockedOut && !actionChosen && (
          <div className={`arena-timer ${timerSeconds <= 10 ? 'arena-timer-urgent' : ''}`}>
            {timerSeconds > 60
              ? `${Math.floor(timerSeconds / 60)}:${(timerSeconds % 60).toString().padStart(2, '0')}`
              : `0:${timerSeconds.toString().padStart(2, '0')}`
            } remaining
          </div>
        )}

        {/* Dice Overlay — local roll or spectator roll */}
        {diceRoll && (
          <Suspense fallback={null}>
            <DiceOverlay
              key={diceRoll.key || 0}
              notation={diceRoll.notation}
              themeColor={diceRoll.diceColor || '#F97316'}
              modifier={diceRoll.modifier || 0}
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
              themeColor={spectatorRoll.color || '#F97316'}
              modifier={spectatorRoll.modifier || 0}
              forcedTotal={spectatorRoll.total}
              label={spectatorRoll.label}
              onDone={handleSpectatorDone}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // ── Monster Selection (idle state) ──
  return (
    <div className="arena">
      <div className="arena-header">
        <button className="arena-back" onClick={() => navigate('/map')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="arena-header-title">The Arena</div>
        <div className="arena-header-sub">{activeEncounter ? 'Battle in progress' : 'Choose your foe'}</div>
      </div>

      {/* Active fight banner — lets non-participants join */}
      {activeEncounter && monster && (
        <div className="arena-active-banner">
          <div className="arena-active-banner-info">
            <span className="arena-active-banner-monster">{'\u2694\uFE0F'} {monster.name}</span>
            <span className="arena-active-banner-detail">
              HP {monster.currentHp}/{monster.maxHp} &middot; {Object.keys(activeEncounter.participants || {}).length} fighting
            </span>
          </div>
          <button
            className="arena-btn arena-btn-join"
            onClick={handleJoin}
            disabled={joining}
          >
            {joining ? 'Joining...' : 'Join Fight'}
          </button>
        </div>
      )}

      <div className="arena-monster-grid">
        {!monsters ? (
          <div className="arena-loading">Loading monsters...</div>
        ) : monsters.length === 0 ? (
          <div className="arena-loading">No monsters available</div>
        ) : (
          monsters.map(m => (
            <button
              key={m.id}
              className={`arena-monster-card ${activeEncounter ? 'arena-monster-card-disabled' : ''}`}
              onClick={() => !activeEncounter && handleSpawn(m.id)}
              disabled={!!spawning || !!activeEncounter}
            >
              <div className="arena-card-name">{m.name}</div>
              <div className="arena-card-stats">
                <span className="arena-card-cr">CR {m.cr}</span>
                <span className="arena-card-ac">AC {m.ac}</span>
                <span className="arena-card-hp">HP {m.maxHp}</span>
              </div>
              {m.description && (
                <div className="arena-card-desc">{m.description}</div>
              )}
              {spawning === m.id && (
                <div className="arena-card-spawning">Summoning...</div>
              )}
            </button>
          ))
        )}
      </div>

      {/* Dice Overlay (for any leftover state) */}
      {diceRoll && (
        <Suspense fallback={null}>
          <DiceOverlay
            key={diceRoll.key || 0}
            notation={diceRoll.notation}
            themeColor={diceRoll.diceColor || '#F97316'}
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
            themeColor={spectatorRoll.color || '#F97316'}
            modifier={spectatorRoll.modifier || 0}
            forcedTotal={spectatorRoll.total}
            label={spectatorRoll.label}
            onDone={handleSpectatorDone}
          />
        </Suspense>
      )}
    </div>
  );
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
