import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useTheme } from '../context/ThemeContext';
import Toast from '../components/Toast';
import '../styles/map.css';

const ALL_NPCS = [
  'aurelia', 'bigtam', 'bonesy', 'brynleaf', 'cena', 'djinn', 'edgar',
  'ember', 'grumm', 'ithrae', 'jonah', 'kai', 'kumo', 'mai', 'mira',
  'nibby', 'reah', 'ximena'
];

export default function Admin() {
  const { phase, setPhase } = useTheme();
  const [locations, setLocations] = useState([]);
  const [localPhase, setLocalPhase] = useState(phase);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [authorized, setAuthorized] = useState(null);

  useEffect(() => {
    setLocalPhase(phase);
  }, [phase]);

  useEffect(() => {
    loadLocations();
  }, []);

  async function loadLocations() {
    try {
      const data = await api('/api/chat/locations');
      setLocations(data.locations);
      setAuthorized(true);
    } catch (err) {
      if (err.status === 401) {
        setAuthorized(false);
      }
    }
  }

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

      {/* NPC Location Assignment */}
      <section>
        <h2 className="section-title">NPC Locations</h2>
        {locations.map(loc => (
          <div key={loc.id} style={{
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
          </div>
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
