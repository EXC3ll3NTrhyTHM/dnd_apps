import { useEffect } from 'react';
import '../styles/components.css';

export default function XpFloat({ amount, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="xp-float">+{amount} XP</div>
  );
}
