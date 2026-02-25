import { useState, useEffect, useRef } from 'react';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import QuestCard from '../components/QuestCard';
import DmAwardEffect from '../components/DmAwardEffect';
import '../styles/quests.css';

const DAILY_GOALS = [
  { key: 'login',     label: 'Daily Login',     icon: '\uD83C\uDF05', xp: 25, maxKey: null },
  { key: 'messages',  label: 'Send Messages',   icon: '\uD83D\uDCAC', xp: 5,  maxKey: 'messages', max: 50 },
  { key: 'reactions', label: 'React to Messages', icon: '\u2728', xp: 2, maxKey: 'reactions', max: 50 },
  { key: 'locations', label: 'Visit Locations',  icon: '\uD83D\uDDFA\uFE0F', xp: 15, maxKey: 'locations' },
  { key: 'gold',      label: 'Spend Gold',       icon: '\uD83E\uDE99', xp: 1,  maxKey: 'gold', max: 200 },
];

export default function Quests() {
  const { xpInfo, refreshXp } = useAuth();
  const [quests, setQuests] = useState(null);
  const [daily, setDaily] = useState(null);
  const [locationCount, setLocationCount] = useState(0);
  const [arenaGoals, setArenaGoals] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [rewardEffect, setRewardEffect] = useState(null);
  const pendingRewardRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [questData, xpData, locData, arenaData] = await Promise.all([
        api('/api/quests/all'),
        api('/api/xp/me'),
        api('/api/chat/locations'),
        api('/api/xp/arena-daily'),
      ]);
      setQuests(questData);
      setDaily(xpData.daily);
      setLocationCount((locData.locations || []).filter(l => !l.isMarcelDm).length);
      setArenaGoals(arenaData.goals);
    } catch (err) {
      console.error('Failed to load quest data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function claimArenaGoal(goalKey) {
    if (claiming) return;
    setClaiming(goalKey);
    try {
      const result = await api('/api/xp/arena-daily/claim', {
        method: 'POST',
        body: JSON.stringify({ goalKey }),
      });
      setArenaGoals(prev => prev.map(g =>
        g.key === goalKey ? { ...g, claimed: true } : g
      ));
      refreshXp();

      // Show reward effect — combined overlay when both XP and gold
      if (result.xpAwarded > 0 && result.goldAwarded > 0) {
        pendingRewardRef.current = null;
        setRewardEffect({ gold: result.goldAwarded, xp: result.xpAwarded, key: Date.now() });
      } else if (result.goldAwarded > 0) {
        pendingRewardRef.current = null;
        setRewardEffect({ type: 'gold', amount: result.goldAwarded, key: Date.now() });
      } else if (result.xpAwarded > 0) {
        pendingRewardRef.current = null;
        setRewardEffect({ type: 'xp', amount: result.xpAwarded, key: Date.now() });
      }
    } catch (err) {
      console.error('Failed to claim arena goal:', err);
    } finally {
      setClaiming(null);
    }
  }

  function handleRewardDone() {
    if (pendingRewardRef.current) {
      const next = pendingRewardRef.current;
      pendingRewardRef.current = null;
      setRewardEffect(next);
    } else {
      setRewardEffect(null);
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
        <h1 className="page-title">{'\uD83D\uDCDC'} Quest Board</h1>
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

      {/* Arena Daily Goals */}
      {arenaGoals && (
        <section className="daily-goals-section arena-goals-section">
          <h2 className="section-title">Arena Daily Goals</h2>
          <div className="daily-goals-list">
            {arenaGoals.map(goal => (
              <div key={goal.key} className={`daily-goal-row ${goal.claimed ? 'daily-goal-done' : ''}`}>
                <span className="daily-goal-icon">{goal.icon}</span>
                <div className="daily-goal-info">
                  <span className="daily-goal-label">{goal.label}</span>
                  <span className="daily-goal-progress">
                    {Math.min(goal.progress, goal.target)} / {goal.target}
                  </span>
                </div>
                <span className="daily-goal-xp">
                  +{goal.xp} XP{goal.gold > 0 ? ` +${goal.gold}g` : ''}
                </span>
                {goal.claimed ? (
                  <span className="daily-goal-check">&#10003;</span>
                ) : goal.completed ? (
                  <button
                    className="arena-goal-claim-btn"
                    disabled={claiming === goal.key}
                    onClick={() => claimArenaGoal(goal.key)}
                  >
                    {claiming === goal.key ? '...' : 'Claim'}
                  </button>
                ) : null}
              </div>
            ))}
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
            {f === 'all' ? 'All' : f === 'active' ? '\u2694\uFE0F Active' : '\u2705 Done'}
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

      {rewardEffect && (
        <DmAwardEffect
          key={rewardEffect.key}
          type={rewardEffect.type}
          amount={rewardEffect.amount}
          gold={rewardEffect.gold}
          xp={rewardEffect.xp}
          onDone={handleRewardDone}
        />
      )}
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
      return { done: (daily.gold_spend_xp || 0) >= goal.max, progress: daily.gold_spend_xp || 0, max: goal.max };
    default:
      return { done: false, progress: 0, max: null };
  }
}
