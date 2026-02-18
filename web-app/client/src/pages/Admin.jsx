import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { api } from '../hooks/useApi';
import { useTheme } from '../context/ThemeContext';
import Toast from '../components/Toast';
import '../styles/map.css';

const DiceOverlay = lazy(() => import('../components/DiceOverlay'));

/* ── Dice Colorsets for Preview ── */
/* See all options: https://github.com/3d-dice/dice-box-threejs/blob/main/src/const/colorsets.js */
/* ✦ = consistent color, ⟳ = random variety each roll */
const DICE_COLORSETS = [
  // Basic (consistent)
  { id: 'white', name: 'White ✦', color: '#FFFFFF', category: 'Basic' },
  { id: 'black', name: 'Black ✦', color: '#000000', category: 'Basic' },
  { id: 'rainbow', name: 'Rainbow ⟳', color: '#FF5959', category: 'Basic' },
  // Damage Types (with textures!)
  { id: 'radiant', name: 'Radiant ✦', color: '#F9B333', category: 'Damage' },
  { id: 'fire', name: 'Fire ⟳', color: '#f43c04', category: 'Damage' },
  { id: 'ice', name: 'Ice ⟳', color: '#60E9FF', category: 'Damage' },
  { id: 'poison', name: 'Poison ⟳', color: '#934fc3', category: 'Damage' },
  { id: 'acid', name: 'Acid ⟳', color: '#A9FF70', category: 'Damage' },
  { id: 'lightning', name: 'Lightning ⟳', color: '#FFC500', category: 'Damage' },
  { id: 'thunder', name: 'Thunder ✦', color: '#7D7D7D', category: 'Damage' },
  { id: 'force', name: 'Force ⟳', color: '#FF97FF', category: 'Damage' },
  { id: 'psychic', name: 'Psychic ⟳', color: '#D6A8FF', category: 'Damage' },
  { id: 'necrotic', name: 'Necrotic ✦', color: '#6F0000', category: 'Damage' },
  // Elements
  { id: 'air', name: 'Air ⟳', color: '#c3dee5', category: 'Element' },
  { id: 'water', name: 'Water ⟳', color: '#60E9FF', category: 'Element' },
  { id: 'earth', name: 'Earth ⟳', color: '#6C9943', category: 'Element' },
  // Premium (fancy textures)
  { id: 'bloodmoon', name: 'Blood Moon ✦', color: '#6F0000', category: 'Premium' },
  { id: 'starynight', name: 'Starry Night ⟳', color: '#4F708F', category: 'Premium' },
  { id: 'astralsea', name: 'Astral Sea ✦', color: '#565656', category: 'Premium' },
  { id: 'glitterparty', name: 'Glitter Party ⟳', color: '#FFB5F5', category: 'Premium' },
  { id: 'pinkdreams', name: 'Pink Dreams ⟳', color: '#ff007c', category: 'Premium' },
  { id: 'breebaby', name: 'Pastel Sunset ⟳', color: '#FE89CF', category: 'Premium' },
  { id: 'bronze', name: 'Thylean Bronze ⟳', color: '#7A4E06', category: 'Premium' },
  { id: 'dragons', name: 'Here Be Dragons ⟳', color: '#B80000', category: 'Premium' },
  // Fun
  { id: 'tigerking', name: 'Tiger King ⟳', color: '#FFCC40', category: 'Fun' },
  { id: 'birdup', name: 'Bird Up ⟳', color: '#F11602', category: 'Fun' },
];

/* ── Dice Materials ── */
const DICE_MATERIALS = ['plastic', 'glass', 'metal', 'wood', 'none'];

/* ── Dice Preview Component ── */
function DicePreview() {
  const [selectedColorset, setSelectedColorset] = useState(DICE_COLORSETS[0]);
  const [selectedMaterial, setSelectedMaterial] = useState('plastic');
  const [rolling, setRolling] = useState(false);
  const [diceKey, setDiceKey] = useState(0);
  const [forcedValue, setForcedValue] = useState('');

  function handleRoll() {
    setDiceKey(k => k + 1);
    setRolling(true);
  }

  function handleDone() {
    setRolling(false);
  }

  // Parse forced value (1-20 for d20)
  const parsedForced = forcedValue ? parseInt(forcedValue, 10) : null;
  const validForced = parsedForced && parsedForced >= 1 && parsedForced <= 20 ? [parsedForced] : null;

  const groupedColorsets = DICE_COLORSETS.reduce((acc, cs) => {
    const cat = cs.category || 'Basic';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(cs);
    return acc;
  }, {});

  return (
    <div style={{
      padding: 12,
      background: 'var(--bg-card)',
      borderRadius: 8,
      border: '1px solid var(--border-color)'
    }}>
      {/* Colorset selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6
        }}>
          Colorset
        </div>
        <select
          value={selectedColorset.id}
          onChange={e => setSelectedColorset(DICE_COLORSETS.find(c => c.id === e.target.value))}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface, rgba(0,0,0,0.2))',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            outline: 'none'
          }}
        >
          {Object.entries(groupedColorsets).map(([category, colorsets]) => (
            <optgroup key={category} label={category}>
              {colorsets.map(cs => (
                <option key={cs.id} value={cs.id}>
                  {cs.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Material selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6
        }}>
          Material
        </div>
        <select
          value={selectedMaterial}
          onChange={e => setSelectedMaterial(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface, rgba(0,0,0,0.2))',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            outline: 'none'
          }}
        >
          {DICE_MATERIALS.map(mat => (
            <option key={mat} value={mat}>
              {mat.charAt(0).toUpperCase() + mat.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Color preview swatch */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 12
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: selectedColorset.color,
          border: '2px solid var(--border-color)'
        }} />
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
            {selectedColorset.name}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {selectedColorset.id} · {selectedMaterial}
          </div>
        </div>
      </div>

      {/* Forced value input */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6
        }}>
          Force Result (1-20, blank = random)
        </div>
        <input
          type="number"
          min="1"
          max="20"
          value={forcedValue}
          onChange={e => setForcedValue(e.target.value)}
          placeholder="Random"
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface, rgba(0,0,0,0.2))',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            outline: 'none'
          }}
        />
      </div>

      {/* Roll button */}
      <button
        className="btn btn-primary"
        onClick={handleRoll}
        disabled={rolling}
        style={{ width: '100%' }}
      >
        {rolling ? 'Rolling...' : validForced ? `🎲 Roll d20 → ${validForced[0]}` : '🎲 Roll d20'}
      </button>

      {/* Dice overlay */}
      {rolling && (
        <Suspense fallback={null}>
          <DiceOverlay
            key={diceKey}
            notation="1d20"
            colorset={selectedColorset.id}
            material={selectedMaterial}
            forcedValues={validForced}
            onResult={() => {}}
            onDone={handleDone}
          />
        </Suspense>
      )}
    </div>
  );
}

const ALL_NPCS = [
  'aurelia', 'bigtam', 'bonesy', 'brynleaf', 'cena', 'djinn', 'edgar',
  'ember', 'grumm', 'ithrae', 'jonah', 'kai', 'kumo', 'mai', 'marcel', 'mira',
  'nibby', 'reah', 'ximena'
];

/* ── Group Management Card (per location) ── */
function GroupCard({ loc, players, onSave, onToast }) {
  // Build local editable groups from the server data
  // loc.groups has { groupId: { displayName, memberIds, members } }
  const [groups, setGroups] = useState({});
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync from server data when location changes
  useEffect(() => {
    const g = {};
    if (loc.groups) {
      for (const [gid, group] of Object.entries(loc.groups)) {
        g[gid] = {
          displayName: group.displayName,
          members: [...(group.memberIds || [])]
        };
      }
    }
    setGroups(g);
    setDirty(false);
  }, [loc]);

  const locationNpcIds = loc.npcs.map(n => n.id);

  function toggleExpand(gid) {
    setExpanded(prev => ({ ...prev, [gid]: !prev[gid] }));
  }

  function toggleMember(gid, npcId) {
    setGroups(prev => {
      const group = prev[gid];
      const has = group.members.includes(npcId);
      return {
        ...prev,
        [gid]: {
          ...group,
          members: has
            ? group.members.filter(m => m !== npcId)
            : [...group.members, npcId]
        }
      };
    });
    setDirty(true);
  }

  function updateDisplayName(gid, name) {
    setGroups(prev => ({
      ...prev,
      [gid]: { ...prev[gid], displayName: name }
    }));
    setDirty(true);
  }

  function deleteGroup(gid) {
    setGroups(prev => {
      const next = { ...prev };
      delete next[gid];
      return next;
    });
    setExpanded(prev => {
      const next = { ...prev };
      delete next[gid];
      return next;
    });
    setDirty(true);
  }

  function addGroup() {
    // Generate a unique key
    let idx = 1;
    let key = 'new_group';
    while (groups[key]) {
      key = `new_group_${idx++}`;
    }
    setGroups(prev => ({
      ...prev,
      [key]: { displayName: 'New Group', members: [] }
    }));
    setExpanded(prev => ({ ...prev, [key]: true }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/api/admin/locations/${loc.id}/groups`, {
        method: 'PUT',
        body: JSON.stringify({ groups })
      });
      onToast({ type: 'success', message: `Groups saved for ${loc.name}` });
      setDirty(false);
      onSave();
    } catch (err) {
      onToast({ type: 'error', message: err.data?.error || 'Failed to save groups' });
    } finally {
      setSaving(false);
    }
  }

  const groupEntries = Object.entries(groups);

  return (
    <div style={{
      marginBottom: 16,
      padding: 12,
      background: 'var(--bg-card)',
      borderRadius: 8,
      border: '1px solid var(--border-color)'
    }}>
      <h3 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '0.95rem',
        color: 'var(--color-gold)',
        marginBottom: 8
      }}>
        {loc.name}
      </h3>

      {groupEntries.length === 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          No groups defined
        </div>
      )}

      {groupEntries.map(([gid, group]) => {
        const isExpanded = expanded[gid];
        return (
          <div key={gid} style={{
            marginBottom: 8,
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            overflow: 'hidden'
          }}>
            {/* Group header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 10px',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                gap: 8
              }}
              onClick={() => toggleExpand(gid)}
            >
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: 12 }}>
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <input
                type="text"
                value={group.displayName}
                onChange={e => updateDisplayName(gid, e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.85rem',
                  padding: '2px 6px',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                  borderColor: 'transparent'
                }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-dim)'}
                onBlur={e => e.target.style.borderColor = 'transparent'}
              />
              <span style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap'
              }}>
                {group.members.length} member{group.members.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={e => { e.stopPropagation(); deleteGroup(gid); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  padding: '0 4px',
                  lineHeight: 1
                }}
                title="Delete group"
              >
                &times;
              </button>
            </div>

            {/* Expanded: member toggles */}
            {isExpanded && (
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>NPCs</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {locationNpcIds.map(npcId => {
                    const isMember = group.members.includes(npcId);
                    return (
                      <button
                        key={npcId}
                        onClick={() => toggleMember(gid, npcId)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 12,
                          border: `1px solid ${isMember ? 'var(--color-gold-dim)' : 'var(--border-color)'}`,
                          background: isMember ? 'rgba(212, 168, 67, 0.15)' : 'transparent',
                          color: isMember ? 'var(--color-gold)' : 'var(--text-muted)',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-body)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {npcId}
                      </button>
                    );
                  })}
                </div>
                {players.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Players</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {players.map(player => {
                        const name = player.characterName;
                        const isMember = group.members.includes(name);
                        return (
                          <button
                            key={player.id}
                            onClick={() => toggleMember(gid, name)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 12,
                              border: `1px solid ${isMember ? 'rgba(143, 184, 160, 0.5)' : 'var(--border-color)'}`,
                              background: isMember ? 'rgba(74, 222, 128, 0.1)' : 'transparent',
                              color: isMember ? '#8fb8a0' : 'var(--text-muted)',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-body)',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={addGroup}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px dashed var(--border-color)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontFamily: 'var(--font-body)'
          }}
        >
          + Add Group
        </button>
        {dirty && (
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving}
            style={{ padding: '4px 16px', fontSize: '0.8rem' }}
          >
            {saving ? 'Saving...' : 'Save Groups'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Player Rewards Card ── */
function PlayerRewards({ players, onToast }) {
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [goldAmount, setGoldAmount] = useState('');
  const [xpAmount, setXpAmount] = useState('');
  const [awarding, setAwarding] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function awardGold(positive) {
    const num = parseInt(goldAmount, 10);
    if (!selectedPlayer || !num || num <= 0) return;
    setAwarding(true);
    try {
      const data = await api('/api/admin/award-gold', {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedPlayer, amount: positive ? num : -num })
      });
      const label = players.find(p => p.id === selectedPlayer)?.characterName || selectedPlayer;
      setLastResult(`${positive ? '+' : '-'}${Math.abs(data.change)}G to ${label} (Balance: ${data.balance}G)`);
      onToast({ type: 'success', message: `${positive ? 'Gave' : 'Took'} ${Math.abs(data.change)} gold ${positive ? 'to' : 'from'} ${label}` });
      setGoldAmount('');
    } catch (err) {
      onToast({ type: 'error', message: err.data?.error || 'Failed to update gold' });
    } finally {
      setAwarding(false);
    }
  }

  async function awardXp(positive) {
    const num = parseInt(xpAmount, 10);
    if (!selectedPlayer || !num || num <= 0) return;
    setAwarding(true);
    try {
      const data = await api('/api/admin/award-xp', {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedPlayer, amount: positive ? num : -num })
      });
      const label = players.find(p => p.id === selectedPlayer)?.characterName || selectedPlayer;
      setLastResult(`${positive ? '+' : '-'}${Math.abs(data.change)} XP to ${label} (Total: ${data.total_xp} XP, Lvl ${data.level})`);
      onToast({ type: 'success', message: `${positive ? 'Gave' : 'Took'} ${Math.abs(data.change)} XP ${positive ? 'to' : 'from'} ${label}` });
      setXpAmount('');
    } catch (err) {
      onToast({ type: 'error', message: err.data?.error || 'Failed to update XP' });
    } finally {
      setAwarding(false);
    }
  }

  const inputStyle = {
    width: 80,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface, rgba(0,0,0,0.2))',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-body)',
    fontSize: '0.85rem',
    textAlign: 'center',
    outline: 'none'
  };

  const btnStyle = (color) => ({
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: `${color}22`,
    color,
    fontSize: '0.8rem',
    cursor: awarding ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    opacity: awarding ? 0.5 : 1,
    transition: 'all 0.15s ease'
  });

  return (
    <div style={{
      padding: 12,
      background: 'var(--bg-card)',
      borderRadius: 8,
      border: '1px solid var(--border-color)'
    }}>
      {/* Player selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6
        }}>
          Player
        </div>
        <select
          value={selectedPlayer}
          onChange={e => { setSelectedPlayer(e.target.value); setLastResult(null); }}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface, rgba(0,0,0,0.2))',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.85rem',
            outline: 'none'
          }}
        >
          <option value="">Select a player...</option>
          {players.map(p => (
            <option key={p.id} value={p.id}>
              {p.characterName || p.displayName || p.id}
            </option>
          ))}
        </select>
      </div>

      {/* Gold row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10
      }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-gold)', width: 36 }}>Gold</span>
        <input
          type="number"
          min="1"
          placeholder="0"
          value={goldAmount}
          onChange={e => setGoldAmount(e.target.value)}
          style={inputStyle}
        />
        <button
          onClick={() => awardGold(true)}
          disabled={awarding || !selectedPlayer || !goldAmount}
          style={btnStyle('#4ade80')}
        >
          Give
        </button>
        <button
          onClick={() => awardGold(false)}
          disabled={awarding || !selectedPlayer || !goldAmount}
          style={btnStyle('#f87171')}
        >
          Take
        </button>
      </div>

      {/* XP row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10
      }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-gold)', width: 36 }}>XP</span>
        <input
          type="number"
          min="1"
          placeholder="0"
          value={xpAmount}
          onChange={e => setXpAmount(e.target.value)}
          style={inputStyle}
        />
        <button
          onClick={() => awardXp(true)}
          disabled={awarding || !selectedPlayer || !xpAmount}
          style={btnStyle('#4ade80')}
        >
          Give
        </button>
        <button
          onClick={() => awardXp(false)}
          disabled={awarding || !selectedPlayer || !xpAmount}
          style={btnStyle('#f87171')}
        >
          Take
        </button>
      </div>

      {/* Last result feedback */}
      {lastResult && (
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          padding: '6px 8px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 4,
          fontFamily: 'var(--font-body)'
        }}>
          {lastResult}
        </div>
      )}
    </div>
  );
}

/* ── Main Admin Page ── */
export default function Admin() {
  const { phase, setPhase } = useTheme();
  const [locations, setLocations] = useState([]);
  const [players, setPlayers] = useState([]);
  const [localPhase, setLocalPhase] = useState(phase);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [authorized, setAuthorized] = useState(null);

  useEffect(() => {
    setLocalPhase(phase);
  }, [phase]);

  useEffect(() => {
    loadLocations();
    loadPlayers();
  }, []);

  const loadPlayers = useCallback(async () => {
    try {
      const data = await api('/api/campaign/players');
      setPlayers(data.players);
    } catch {
      // silently fail — players list is non-critical
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      const data = await api('/api/chat/locations');
      setLocations(data.locations);
      setAuthorized(true);
    } catch (err) {
      if (err.status === 401) {
        setAuthorized(false);
      }
    }
  }, []);

  async function savePhase() {
    setSaving(true);
    try {
      const result = await api('/api/campaign/state', {
        method: 'POST',
        body: JSON.stringify({ phase: localPhase })
      });
      setPhase(result.phase);
      setToast({ type: 'success', message: `Phase updated to ${result.phase}` });
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Failed to update phase' });
    } finally {
      setSaving(false);
    }
  }

  async function updateLocationNpcs(locationId, npcs) {
    try {
      await api('/api/campaign/locations', {
        method: 'POST',
        body: JSON.stringify({ locationId, npcs })
      });
      setToast({ type: 'success', message: 'NPCs updated' });
      loadLocations();
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Failed to update' });
    }
  }

  function toggleNpc(locationId, npcId, currentNpcs) {
    const npcs = currentNpcs.map(n => n.id);
    if (npcs.includes(npcId)) {
      updateLocationNpcs(locationId, npcs.filter(n => n !== npcId));
    } else {
      updateLocationNpcs(locationId, [...npcs, npcId]);
    }
  }

  async function toggleLocked(locationId, currentlyLocked) {
    try {
      await api('/api/campaign/locations/visibility', {
        method: 'POST',
        body: JSON.stringify({ locationId, locked: !currentlyLocked })
      });
      setToast({ type: 'success', message: currentlyLocked ? 'Location unlocked' : 'Location locked' });
      loadLocations();
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Failed to update visibility' });
    }
  }

  async function togglePlayerLock(locationId, userId, currentlyLocked) {
    try {
      await api('/api/campaign/locations/player-visibility', {
        method: 'POST',
        body: JSON.stringify({ locationId, userId, locked: !currentlyLocked })
      });
      setToast({ type: 'success', message: currentlyLocked ? 'Player access restored' : 'Player locked out' });
      loadLocations();
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Failed to update player visibility' });
    }
  }

  if (authorized === false) {
    return (
      <div className="page">
        <div className="page-error">Access denied. DM only.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">DM Controls</h1>
        <p className="page-subtitle">Campaign management panel</p>
      </div>

      {/* Campaign Phase Control */}
      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Campaign Phase</h2>
        <div style={{ padding: '12px 0' }}>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={localPhase}
            onChange={e => setLocalPhase(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--color-gold)' }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginTop: 4
          }}>
            <span>1.0 Manuscript</span>
            <span>2.0 Rot</span>
            <span>3.0 Decay</span>
          </div>
          <div style={{
            textAlign: 'center',
            marginTop: 8,
            fontFamily: 'var(--font-display)',
            fontSize: '1.2rem',
            color: 'var(--color-gold)'
          }}>
            {localPhase.toFixed(2)}
          </div>
          <button
            className="btn btn-primary"
            onClick={savePhase}
            disabled={saving || localPhase === phase}
            style={{ marginTop: 12, width: '100%' }}
          >
            {saving ? 'Saving...' : 'Apply Phase'}
          </button>
        </div>
      </section>

      {/* Dice Preview */}
      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">Dice Preview</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Preview dice colorsets before adding them to the shop
        </p>
        <DicePreview />
      </section>

      {/* Player Rewards */}
      {players.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className="section-title">Player Rewards</h2>
          <PlayerRewards players={players} onToast={setToast} />
        </section>
      )}

      {/* NPC Location Assignment */}
      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">NPC Locations</h2>
        {locations.map(loc => (
          <div key={loc.id} style={{
            marginBottom: 16,
            padding: 12,
            background: 'var(--bg-card)',
            borderRadius: 8,
            border: `1px solid ${loc.locked ? 'rgba(180, 60, 60, 0.4)' : 'var(--border-color)'}`,
            opacity: loc.locked ? 0.6 : 1,
            transition: 'opacity 0.2s ease, border-color 0.2s ease'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8
            }}>
              <h3 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.95rem',
                color: 'var(--color-gold)',
                margin: 0
              }}>
                {loc.locked ? '\uD83D\uDD12 ' : ''}{loc.name}
              </h3>
              <button
                onClick={() => toggleLocked(loc.id, loc.locked)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: `1px solid ${loc.locked ? 'rgba(180, 60, 60, 0.5)' : 'var(--border-color)'}`,
                  background: loc.locked ? 'rgba(180, 60, 60, 0.15)' : 'transparent',
                  color: loc.locked ? '#e06060' : 'var(--text-muted)',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'all 0.15s ease'
                }}
              >
                {loc.locked ? 'Unlock' : 'Lock'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ALL_NPCS.map(npcId => {
                const isPresent = loc.npcs.some(n => n.id === npcId);
                return (
                  <button
                    key={npcId}
                    onClick={() => toggleNpc(loc.id, npcId, loc.npcs)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 12,
                      border: `1px solid ${isPresent ? 'var(--color-gold-dim)' : 'var(--border-color)'}`,
                      background: isPresent ? 'rgba(212, 168, 67, 0.15)' : 'transparent',
                      color: isPresent ? 'var(--color-gold)' : 'var(--text-muted)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {npcId}
                  </button>
                );
              })}
            </div>
            {/* Player Access */}
            {players.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Player Access
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {players.map(player => {
                    const isLocked = (loc.lockedFor || []).includes(player.id);
                    const label = player.characterName || player.displayName || ('...' + player.id.slice(-4));
                    return (
                      <button
                        key={player.id}
                        onClick={() => togglePlayerLock(loc.id, player.id, isLocked)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 12,
                          border: `1px solid ${isLocked ? 'rgba(180, 60, 60, 0.5)' : 'var(--color-gold-dim)'}`,
                          background: isLocked ? 'rgba(180, 60, 60, 0.15)' : 'rgba(212, 168, 67, 0.15)',
                          color: isLocked ? '#e06060' : 'var(--color-gold)',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-body)',
                          textDecoration: isLocked ? 'line-through' : 'none',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Group Management */}
      <section>
        <h2 className="section-title">Group Management</h2>
        {locations.map(loc => (
          <GroupCard
            key={loc.id}
            loc={loc}
            players={players}
            onSave={loadLocations}
            onToast={setToast}
          />
        ))}
      </section>

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
