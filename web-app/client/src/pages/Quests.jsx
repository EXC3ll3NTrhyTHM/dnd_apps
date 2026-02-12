import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import QuestCard from '../components/QuestCard';
import '../styles/quests.css';

const DAILY_GOALS = [
  { key: 'login',     label: 'Daily Login',     icon: '🌅', xp: 25, maxKey: null },
  { key: 'messages',  label: 'Send Messages',   icon: '💬', xp: 5,  maxKey: 'messages', max: 50 },
  { key: 'reactions', label: 'React to Messages', icon: '✨', xp: 2, maxKey: 'reactions', max: 50 },
  { key: 'locations', label: 'Visit Locations',  icon: '🗺️', xp: 15, maxKey: 'locations' },
  { key: 'gold',      label: 'Spend Gold',       icon: '🪙', xp: 1,  maxKey: null, note: 'per gold' },
];

export default function Quests() {
  const { xpInfo, refreshXp } = useAuth();
  const [quests, setQuests] = useState(null);
  const [daily, setDaily] = useState(null);
  const [locationCount, setLocationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [questData, xpData, locData] = await Promise.all([
        api('/api/quests/all'),
        api('/api/xp/me'),
        api('/api/chat/locations')
      ]);
      setQuests(questData);
      setDaily(xpData.daily);
      setLocationCount((locData.locations || []).filter(l => !l.isMarcelDm).length);
    } catch (err) {
      console.error('Failed to load quest data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Checking the quest board...</p>
      </div>
    );
  }

  const allQuests = quests?.quests || [];
  const filtered = filter === 'all' ? allQuests
    : filter === 'active' ? allQuests.filter(q => q.status === 'active' || q.status === 'in_progress')
    : filter === 'completed' ? allQuests.filter(q => q.status === 'completed')
    : allQuests;

  return (
    <div className="page quests-page">
      <div className="page-header">
        <h1 className="page-title">📜 Quest Board</h1>
        <p className="page-subtitle">Daily goals & party adventures</p>
      </div>

      {/* Daily Goals */}
      {daily && (
        <section className="daily-goals-section">
          <h2 className="section-title">Daily Goals</h2>
          <div className="daily-goals-list">
            {DAILY_GOALS.map(goal => {
              const { done, progress, max } = getDailyProgress(goal, daily, locationCount);
              return (
                <div key={goal.key} className={`daily-goal-row ${done ? 'daily-goal-done' : ''}`}>
                  <span className="daily-goal-icon">{goal.icon}</span>
                  <div className="daily-goal-info">
                    <span className="daily-goal-label">{goal.label}</span>
                    {max != null ? (
                      <span className="daily-goal-progress">{progress} / {max}</span>
                    ) : goal.note ? (
                      <span className="daily-goal-progress">{goal.note}</span>
                    ) : (
                      <span className="daily-goal-progress">{done ? 'Done' : 'Available'}</span>
                    )}
                  </div>
                  <span className="daily-goal-xp">+{goal.xp} XP</span>
                  {done && <span className="daily-goal-check">&#10003;</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter tabs */}
      <div className="filter-tabs">
        {['all', 'active', 'completed'].map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'active' ? '⚔️ Active' : '✅ Done'}
          </button>
        ))}
      </div>

      {/* Quest list */}
      <div className="quests-list">
        {filtered.length > 0 ? (
          filtered.map(quest => (
            <QuestCard key={quest.id} quest={quest} />
          ))
        ) : (
          <p className="empty-state">
            {filter === 'active' ? 'No active quests. Talk to an NPC!' : 'No quests found.'}
          </p>
        )}
      </div>
    </div>
  );
}

function getDailyProgress(goal, daily, locationCount) {
  switch (goal.key) {
    case 'login':
      return { done: daily.login_claimed, progress: daily.login_claimed ? 1 : 0, max: null };
    case 'messages':
      return { done: daily.messages_sent >= goal.max, progress: daily.messages_sent, max: goal.max };
    case 'reactions':
      return { done: daily.reactions_given >= goal.max, progress: daily.reactions_given, max: goal.max };
    case 'locations': {
      const visited = daily.locations_visited.length;
      return { done: locationCount > 0 && visited >= locationCount, progress: visited, max: locationCount };
    }
    case 'gold':
      return { done: false, progress: 0, max: null };
    default:
      return { done: false, progress: 0, max: null };
  }
}
