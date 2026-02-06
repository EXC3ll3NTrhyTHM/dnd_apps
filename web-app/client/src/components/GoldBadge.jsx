import '../styles/components.css';

export default function GoldBadge({ amount, size = 'md' }) {
  return (
    <span className={`gold-badge gold-badge-${size}`}>
      <span className="gold-badge-icon">🪙</span>
      <span className="gold-badge-amount">{amount}G</span>
    </span>
  );
}
