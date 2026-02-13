import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../hooks/useApi';
import AchievementToast from './AchievementToast';
import '../styles/character-sheet.css';

const PHYSICAL_KEYS = ['age', 'gender', 'hair', 'eyes', 'skin', 'height', 'weight'];

const STAT_INFO = {
  STR: { name: 'Strength', desc: 'Raw physical power. Determines melee attack damage, carrying capacity, and feats of brute force like breaking down doors or grappling foes.' },
  DEX: { name: 'Dexterity', desc: 'Agility and reflexes. Affects ranged attacks, armor class, stealth, acrobatics, and how quickly you react in combat.' },
  CON: { name: 'Constitution', desc: 'Endurance and vitality. Determines your hit points, resistance to poison and disease, and ability to endure harsh conditions.' },
  INT: { name: 'Intelligence', desc: 'Reasoning and memory. Used for arcane spellcasting, investigation, recalling lore, and solving puzzles.' },
  WIS: { name: 'Wisdom', desc: 'Perception and insight. Governs awareness of surroundings, reading people, divine spellcasting, and resisting mental effects.' },
  CHA: { name: 'Charisma', desc: 'Force of personality. Powers persuasion, deception, performance, intimidation, and certain types of magic.' },
  HP: { name: 'Hit Points', desc: 'Your total health pool. When this reaches zero, you fall unconscious. Determined by your class, level, and Constitution modifier.' },
  AC: { name: 'Armor Class', desc: 'How hard you are to hit. Attacks must meet or exceed this number to land. Comes from armor, shields, Dexterity, and magical effects.' },
  PROF: { name: 'Proficiency Bonus', desc: 'Added to attacks, saves, and skill checks you\'re proficient in. Increases as you level up, reflecting your growing expertise.' },
};

export default function CharacterSheet({ userId, editable }) {
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [backstoryExpanded, setBackstoryExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [selectedStat, setSelectedStat] = useState(null);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const inspectReported = useRef(false);

  const dismissAchievement = useCallback(() => {
    setAchievementQueue(prev => prev.slice(1));
  }, []);

  const onStatClick = useCallback((statKey) => {
    setSelectedStat(prev => prev === statKey ? null : statKey);
    if (!inspectReported.current) {
      inspectReported.current = true;
      api('/api/character-sheet/inspect-stat', { method: 'POST' })
        .then(data => {
          if (data.newAchievements?.length > 0) {
            setAchievementQueue(prev => [...prev, ...data.newAchievements]);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Per-section editing state
  const [editingSection, setEditingSection] = useState(null); // 'backstory' | 'traits' | 'physical' | 'notes'
  const [editDraft, setEditDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    api(`/api/character-sheet/${userId}`)
      .then(data => setSheet(data.characterSheet))
      .catch(() => setSheet(null))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading || !sheet) return null;

  const classLine = sheet.classes
    .map(c => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ''}`)
    .join(' / ');

  const physicalFields = Object.entries(sheet.physical);
  const hasTraits = sheet.traits.personalityTraits || sheet.traits.ideals || sheet.traits.bonds || sheet.traits.flaws;
  const hasBackstory = sheet.backstory && sheet.backstory.trim().length > 0;
  const hasNotes = (sheet.enemies && sheet.enemies.trim()) || (sheet.organizations && sheet.organizations.trim());

  function startEdit(section) {
    if (section === 'backstory') {
      setEditDraft({ backstory: sheet.backstory || '' });
    } else if (section === 'traits') {
      setEditDraft({
        personalityTraits: sheet.traits.personalityTraits || '',
        ideals: sheet.traits.ideals || '',
        bonds: sheet.traits.bonds || '',
        flaws: sheet.traits.flaws || ''
      });
    } else if (section === 'physical') {
      const draft = {};
      for (const key of PHYSICAL_KEYS) {
        draft[key] = sheet.physical[key] || '';
      }
      setEditDraft(draft);
    } else if (section === 'notes') {
      setNotesExpanded(true);
      setEditDraft({
        enemies: sheet.enemies || '',
        organizations: sheet.organizations || ''
      });
    }
    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setEditDraft({});
  }

  async function saveEdit() {
    setSaving(true);
    try {
      let body = {};
      if (editingSection === 'backstory') {
        body = { backstory: editDraft.backstory };
      } else if (editingSection === 'traits') {
        body = { traits: { ...editDraft } };
      } else if (editingSection === 'physical') {
        body = { physical: { ...editDraft } };
      } else if (editingSection === 'notes') {
        body = { enemies: editDraft.enemies, organizations: editDraft.organizations };
      }

      const data = await api(`/api/character-sheet/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      setSheet(data.characterSheet);
      setEditingSection(null);
      setEditDraft({});
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }

  function EditBtn({ section }) {
    if (!editable || editingSection) return null;
    return (
      <button className="cs-edit-btn" onClick={() => startEdit(section)} title="Edit">
        &#9998;
      </button>
    );
  }

  function EditActions() {
    return (
      <div className="cs-edit-actions">
        <button className="cs-edit-save" onClick={saveEdit} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="cs-edit-cancel" onClick={cancelEdit} disabled={saving}>
          Cancel
        </button>
      </div>
    );
  }

  const isEditingBackstory = editingSection === 'backstory';
  const isEditingTraits = editingSection === 'traits';
  const isEditingPhysical = editingSection === 'physical';
  const isEditingNotes = editingSection === 'notes';

  return (
    <div className="cs-sheet">
      {/* Corner brackets */}
      <div className="cs-corner cs-corner-tl" />
      <div className="cs-corner cs-corner-tr" />
      <div className="cs-corner cs-corner-bl" />
      <div className="cs-corner cs-corner-br" />

      {/* Section 1: Header */}
      <div className="cs-header">
        <h2 className="cs-name">{sheet.name}</h2>
        <p className="cs-subtitle">
          {sheet.race} &middot; {classLine}
          {sheet.background && <> &middot; {sheet.background}</>}
        </p>
        <div className="cs-pills">
          <span className="cs-pill cs-pill-hp" onClick={() => onStatClick('HP')}>
            <span className="cs-pill-label">HP</span>
            <span className="cs-pill-value">{sheet.hp}</span>
          </span>
          <span className="cs-pill cs-pill-ac" onClick={() => onStatClick('AC')}>
            <span className="cs-pill-label">AC</span>
            <span className="cs-pill-value">{sheet.ac}</span>
          </span>
          <span className="cs-pill cs-pill-prof" onClick={() => onStatClick('PROF')}>
            <span className="cs-pill-label">Prof</span>
            <span className="cs-pill-value">+{sheet.profBonus}</span>
          </span>
        </div>
        {selectedStat && ['HP', 'AC', 'PROF'].includes(selectedStat) && (
          <div className="cs-stat-tooltip" onClick={() => setSelectedStat(null)}>
            <div className="cs-stat-tooltip-name">{STAT_INFO[selectedStat].name}</div>
            <div className="cs-stat-tooltip-desc">{STAT_INFO[selectedStat].desc}</div>
          </div>
        )}
      </div>

      <div className="cs-divider" />

      {/* Section 2: Ability Scores — Diamond Grid */}
      <div className="cs-section">
        <h3 className="cs-section-title">Ability Scores</h3>
        <div className="cs-stats-grid">
          {sheet.stats.map(stat => (
            <div
              key={stat.id}
              className={`cs-diamond ${stat.modifier >= 2 ? 'cs-diamond-high' : ''} ${stat.modifier < 0 ? 'cs-diamond-low' : ''} ${selectedStat === stat.abbr ? 'cs-diamond-selected' : ''}`}
              onClick={() => onStatClick(stat.abbr)}
            >
              <div className="cs-diamond-inner">
                <span className="cs-diamond-abbr">{stat.abbr}</span>
                <span className="cs-diamond-score">{stat.score}</span>
                <span className="cs-diamond-mod">
                  {stat.modifier >= 0 ? `+${stat.modifier}` : stat.modifier}
                </span>
              </div>
            </div>
          ))}
        </div>
        {selectedStat && STAT_INFO[selectedStat] && !['HP', 'AC', 'PROF'].includes(selectedStat) && (
          <div className="cs-stat-tooltip" onClick={() => setSelectedStat(null)}>
            <div className="cs-stat-tooltip-name">{STAT_INFO[selectedStat].name}</div>
            <div className="cs-stat-tooltip-desc">{STAT_INFO[selectedStat].desc}</div>
          </div>
        )}
      </div>

      {/* Section 3: Physical Description */}
      {(physicalFields.length > 0 || isEditingPhysical) && (
        <div className="cs-section">
          <h3 className="cs-section-title">
            Description
            <EditBtn section="physical" />
          </h3>
          {isEditingPhysical ? (
            <>
              <div className="cs-physical-grid">
                {PHYSICAL_KEYS.map(key => (
                  <div key={key} className="cs-physical-row">
                    <span className="cs-physical-label">{key}</span>
                    <span className="cs-physical-dots" />
                    <input
                      className="cs-input"
                      value={editDraft[key] || ''}
                      onChange={e => setEditDraft(d => ({ ...d, [key]: e.target.value }))}
                      placeholder={key}
                    />
                  </div>
                ))}
              </div>
              <EditActions />
            </>
          ) : (
            <div className="cs-physical-grid">
              {physicalFields.map(([key, val]) => (
                <div key={key} className="cs-physical-row">
                  <span className="cs-physical-label">{key}</span>
                  <span className="cs-physical-dots" />
                  <span className="cs-physical-value">{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section 4: Character Traits */}
      {(hasTraits || isEditingTraits) && (
        <div className="cs-section">
          <h3 className="cs-section-title">
            Traits
            <EditBtn section="traits" />
          </h3>
          {isEditingTraits ? (
            <>
              <div className="cs-traits">
                {[
                  { key: 'personalityTraits', label: 'Personality', accent: 'gold' },
                  { key: 'ideals', label: 'Ideals', accent: 'blue' },
                  { key: 'bonds', label: 'Bonds', accent: 'green' },
                  { key: 'flaws', label: 'Flaws', accent: 'crimson' }
                ].map(({ key, label, accent }) => (
                  <div key={key} className={`cs-trait-card cs-trait-${accent}`}>
                    <span className="cs-trait-label">{label}</span>
                    <textarea
                      className="cs-textarea"
                      value={editDraft[key] || ''}
                      onChange={e => setEditDraft(d => ({ ...d, [key]: e.target.value }))}
                      rows={3}
                      placeholder={`Enter ${label.toLowerCase()}...`}
                    />
                  </div>
                ))}
              </div>
              <EditActions />
            </>
          ) : (
            <div className="cs-traits">
              {sheet.traits.personalityTraits && (
                <TraitCard accent="gold" label="Personality" text={sheet.traits.personalityTraits} />
              )}
              {sheet.traits.ideals && (
                <TraitCard accent="blue" label="Ideals" text={sheet.traits.ideals} />
              )}
              {sheet.traits.bonds && (
                <TraitCard accent="green" label="Bonds" text={sheet.traits.bonds} />
              )}
              {sheet.traits.flaws && (
                <TraitCard accent="crimson" label="Flaws" text={sheet.traits.flaws} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Section 5: Equipment */}
      {sheet.equipment.length > 0 && (
        <div className="cs-section">
          <h3 className="cs-section-title">Equipment</h3>
          <div className="cs-equipment">
            {sheet.equipment.map((item, i) => (
              <div key={i} className="cs-equip-item">
                <span className="cs-equip-name">{item.name}</span>
                <span className={`cs-equip-badge ${item.filterType === 'Weapon' ? 'cs-equip-weapon' : 'cs-equip-armor'}`}>
                  {item.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 6: Backstory */}
      {(hasBackstory || isEditingBackstory) && (
        <div className="cs-section">
          <h3 className="cs-section-title">
            Backstory
            <EditBtn section="backstory" />
          </h3>
          {isEditingBackstory ? (
            <>
              <textarea
                className="cs-textarea cs-textarea-large"
                value={editDraft.backstory || ''}
                onChange={e => setEditDraft(d => ({ ...d, backstory: e.target.value }))}
                rows={8}
                placeholder="Write your character's backstory..."
              />
              <EditActions />
            </>
          ) : (
            <>
              <div className={`cs-backstory ${backstoryExpanded ? 'cs-backstory-expanded' : ''}`}>
                <div className="cs-backstory-text">
                  {sheet.backstory}
                </div>
                {!backstoryExpanded && sheet.backstory.length > 150 && (
                  <div className="cs-backstory-fade" />
                )}
              </div>
              {sheet.backstory.length > 150 && (
                <button
                  className="cs-read-more"
                  onClick={() => setBackstoryExpanded(!backstoryExpanded)}
                >
                  {backstoryExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Enemies / Organizations */}
      {(hasNotes || isEditingNotes) && (
        <div className="cs-section">
          {!isEditingNotes && (
            <button
              className="cs-read-more"
              onClick={() => setNotesExpanded(!notesExpanded)}
              style={{ marginBottom: notesExpanded ? 8 : 0 }}
            >
              {notesExpanded ? 'Hide notes' : 'Enemies & Organizations'}
            </button>
          )}
          {isEditingNotes && (
            <h3 className="cs-section-title">Notes</h3>
          )}
          {(notesExpanded || isEditingNotes) && (
            <>
              {isEditingNotes ? (
                <div className="cs-notes">
                  <div className="cs-note-block">
                    <span className="cs-note-label">Enemies</span>
                    <textarea
                      className="cs-textarea"
                      value={editDraft.enemies || ''}
                      onChange={e => setEditDraft(d => ({ ...d, enemies: e.target.value }))}
                      rows={3}
                      placeholder="List enemies..."
                    />
                  </div>
                  <div className="cs-note-block">
                    <span className="cs-note-label">Organizations</span>
                    <textarea
                      className="cs-textarea"
                      value={editDraft.organizations || ''}
                      onChange={e => setEditDraft(d => ({ ...d, organizations: e.target.value }))}
                      rows={3}
                      placeholder="List organizations..."
                    />
                  </div>
                  <EditActions />
                </div>
              ) : (
                <div className="cs-notes">
                  {sheet.enemies && sheet.enemies.trim() && (
                    <div className="cs-note-block">
                      <span className="cs-note-label">Enemies</span>
                      <p className="cs-note-text">{sheet.enemies}</p>
                    </div>
                  )}
                  {sheet.organizations && sheet.organizations.trim() && (
                    <div className="cs-note-block">
                      <span className="cs-note-label">Organizations</span>
                      <p className="cs-note-text">{sheet.organizations}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {!isEditingNotes && notesExpanded && editable && !editingSection && (
            <button className="cs-edit-btn cs-edit-btn-inline" onClick={() => startEdit('notes')} title="Edit">
              &#9998; Edit
            </button>
          )}
        </div>
      )}

      {/* Show notes section with edit button even when empty, for adding new notes */}
      {!hasNotes && !isEditingNotes && editable && !editingSection && (
        <div className="cs-section">
          <button
            className="cs-read-more"
            onClick={() => startEdit('notes')}
          >
            + Add Enemies & Organizations
          </button>
        </div>
      )}

      {/* Show backstory add button when empty */}
      {!hasBackstory && !isEditingBackstory && editable && !editingSection && (
        <div className="cs-section">
          <button
            className="cs-read-more"
            onClick={() => startEdit('backstory')}
          >
            + Add Backstory
          </button>
        </div>
      )}

      {achievementQueue.length > 0 && (
        <AchievementToast
          key={achievementQueue[0].id}
          achievement={achievementQueue[0]}
          onDismiss={dismissAchievement}
        />
      )}
    </div>
  );
}

function TraitCard({ accent, label, text }) {
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <div className={`cs-trait-card cs-trait-${accent}`}>
      <span className="cs-trait-label">{label}</span>
      {lines.map((line, i) => (
        <p key={i} className="cs-trait-text">{line}</p>
      ))}
    </div>
  );
}
