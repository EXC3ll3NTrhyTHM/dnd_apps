import { DICE_COLORS } from '../data/diceColors';
import GoldBadge from './GoldBadge';
import '../styles/components.css';

export default function ItemCard({ item, onBuy, buying, disabled }) {
  const diceColor = item.type === 'dice_set' && item.colorset ? DICE_COLORS[item.colorset] : null;

  return (
    <div className={`item-card ${disabled ? 'item-card-disabled' : ''}`}>
      <div className="item-card-header">
        <div className="item-card-title">
          {diceColor && (
            <span
              className="dice-swatch"
              style={{ background: diceColor.bg, borderColor: diceColor.border }}
            />
          )}
          <h3 className="item-card-name">{item.name}</h3>
        </div>
        <GoldBadge amount={item.price} size="sm" />
      </div>
      <p className="item-card-description">{item.description}</p>
      {item.flavor_text && (
        <p className="item-card-flavor">{item.flavor_text}</p>
      )}
      {onBuy && (
        <button
          className="btn btn-primary btn-buy"
          onClick={() => onBuy(item)}
          disabled={buying || disabled}
        >
          {buying ? 'Buying...' : disabled ? 'Not enough gold' : 'Buy'}
        </button>
      )}
    </div>
  );
}
