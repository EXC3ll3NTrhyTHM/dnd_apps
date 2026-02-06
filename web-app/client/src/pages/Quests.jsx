import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import QuestCard from '../components/QuestCard';
import '../styles/quests.css';

export default function Quests() {
  const [quests, setQuests] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadQuests();
  }, []);

  async function loadQuests() {
    try {
      const data = await api('/api/quests/all');
      setQuests(data);
    } catch (err) {
      console.error('Failed to load quests:', err);
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

  if (!quests) {
    return <div className="page-error">The quest board is unreadable.</div>;
  }

  const allQuests = quests.quests || [];
  const filtered = filter === 'all' ? allQuests
    : filter === 'active' ? allQuests.filter(q => q.status === 'active' || q.status === 'in_progress')
    : filter === 'completed' ? allQuests.filter(q => q.status === 'completed')
    : allQuests;

  return (
    <div className="page quests-page">
      <div className="page-header">
        <h1 className="page-title">📜 Quest Board</h1>
        <p className="page-subtitle">Adventures available to the party</p>
      </div>

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
