import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Achievement unlock banner — slides down from top, auto-dismisses after 5s.
 * Clicking navigates to the Profile page to claim rewards.
 */
export default function AchievementToast({ achievement, onDismiss }) {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!achievement) return null;

  return (
    <div className="achievement-toast" onClick={() => { onDismiss(); navigate('/profile'); }}>
      <span className="achievement-toast-icon">{achievement.icon}</span>
      <div className="achievement-toast-body">
        <div className="achievement-toast-label">Achievement Unlocked!</div>
        <div className="achievement-toast-name">{achievement.name}</div>
        <div className="achievement-toast-rewards">
          {achievement.xp > 0 && <span className="achievement-toast-badge achievement-toast-xp">+{achievement.xp} XP</span>}
          {achievement.gold > 0 && <span className="achievement-toast-badge achievement-toast-gold">+{achievement.gold} Gold</span>}
        </div>
        <div className="achievement-toast-hint">Tap to claim</div>
      </div>
    </div>
  );
}
