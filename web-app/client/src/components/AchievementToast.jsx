import { useEffect } from 'react';

/**
 * Achievement unlock banner — slides down from top, auto-dismisses after 4s.
 */
export default function AchievementToast({ achievement, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!achievement) return null;

  return (
    <div className="achievement-toast" onClick={onDismiss}>
      <span className="achievement-toast-icon">{achievement.icon}</span>
      <div className="achievement-toast-body">
        <div className="achievement-toast-label">Achievement Unlocked!</div>
        <div className="achievement-toast-name">{achievement.name}</div>
        <div className="achievement-toast-rewards">
          {achievement.xp > 0 && <span className="achievement-toast-badge achievement-toast-xp">+{achievement.xp} XP</span>}
          {achievement.gold > 0 && <span className="achievement-toast-badge achievement-toast-gold">+{achievement.gold} Gold</span>}
        </div>
      </div>
    </div>
  );
}
