import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Daily quest completion banner — slides down from top, auto-dismisses after 10s.
 * Fades out before dismissing. Clicking navigates to the Quests page to claim rewards.
 */
export default function QuestToast({ goal, onDismiss }) {
  const navigate = useNavigate();
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 9000);
    const dismissTimer = setTimeout(onDismiss, 10000);
    return () => { clearTimeout(fadeTimer); clearTimeout(dismissTimer); };
  }, [onDismiss]);

  if (!goal) return null;

  return (
    <div
      className={`quest-toast${fading ? ' quest-toast-fadeout' : ''}`}
      onClick={() => { onDismiss(); navigate('/quests'); }}
    >
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
