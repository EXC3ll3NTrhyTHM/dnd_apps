import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Daily quest completion banner — slides down from top, auto-dismisses after 5s.
 * Clicking navigates to the Quests page to claim rewards.
 */
export default function QuestToast({ goal, onDismiss }) {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!goal) return null;

  return (
    <div className="quest-toast" onClick={() => { onDismiss(); navigate('/quests'); }}>
      <span className="quest-toast-icon">{goal.icon}</span>
      <div className="quest-toast-body">
        <div className="quest-toast-label">Quest Complete!</div>
        <div className="quest-toast-name">{goal.label}</div>
        <div className="quest-toast-rewards">
          {goal.xp > 0 && <span className="quest-toast-badge quest-toast-xp">+{goal.xp} XP</span>}
          {goal.gold > 0 && <span className="quest-toast-badge quest-toast-gold">+{goal.gold} Gold</span>}
        </div>
        <div className="quest-toast-hint">Tap to claim</div>
      </div>
    </div>
  );
}
