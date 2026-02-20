/**
 * RollResultOverlay — Dramatic roll vs target comparison
 *
 * Shows after dice finish rolling, before the next phase.
 * Types: 'attack' (roll vs AC), 'damage' (damage vs HP), 'heal' (potion healing), 'spell_save' (save vs DC).
 * Auto-dismisses after a delay, or tap to dismiss early.
 */

import { useEffect } from 'react';

export default function RollResultOverlay({ data, onDismiss }) {
  const duration = data.type === 'attack' ? 4200 : data.type === 'spell_save' ? 4200 : data.type === 'heal' ? 3800 : 3800;

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  if (data.type === 'attack') {
    return <AttackResult data={data} onDismiss={onDismiss} />;
  }
  if (data.type === 'spell_save') {
    return <SpellSaveResult data={data} onDismiss={onDismiss} />;
  }
  if (data.type === 'heal') {
    return <HealResult data={data} onDismiss={onDismiss} />;
  }
  return <DamageResult data={data} onDismiss={onDismiss} />;
}

function Avatar({ src, name }) {
  if (src) {
    return <img src={src} alt={name || ''} className="rro-avatar" />;
  }
  return (
    <div className="rro-avatar rro-avatar-fallback">
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

function AttackResult({ data, onDismiss }) {
  const { total, breakdown, targetAC, isHit, isCrit, isFumble, attacker, defender, advantageType, roll1, roll2 } = data;

  let resultText, resultClass;
  if (isCrit) {
    resultText = 'CRITICAL HIT!';
    resultClass = 'rro-crit';
  } else if (isFumble) {
    resultText = 'FUMBLE!';
    resultClass = 'rro-fumble';
  } else if (isHit) {
    resultText = 'HIT!';
    resultClass = 'rro-hit';
  } else {
    resultText = 'MISS!';
    resultClass = 'rro-miss';
  }

  const hasAdvantage = advantageType === 'advantage' || advantageType === 'disadvantage';

  return (
    <div className={`rro-backdrop ${isCrit ? 'rro-backdrop-crit' : ''}`} onClick={onDismiss}>
      {isCrit && <div className="rro-particles" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="rro-particle" style={{
            '--px': `${Math.random() * 100}%`,
            '--py': `${Math.random() * 100}%`,
            '--dx': `${(Math.random() - 0.5) * 260}px`,
            '--dy': `${(Math.random() - 0.5) * 260}px`,
            '--delay': `${0.3 + Math.random() * 0.5}s`,
            '--size': `${3 + Math.random() * 5}px`,
          }} />
        ))}
      </div>}
      <div className={`rro-content ${isCrit ? 'rro-shake' : ''}`}>
        {hasAdvantage && (
          <div className={`rro-advantage-badge ${advantageType === 'advantage' ? 'rro-advantage-badge-adv' : 'rro-advantage-badge-dis'}`}>
            {advantageType === 'advantage' ? 'ADVANTAGE' : 'DISADVANTAGE'}
          </div>
        )}
        <div className={`rro-comparison ${isCrit ? 'rro-comparison-crit' : ''}`}>
          <div className="rro-side rro-fly-left">
            <Avatar src={attacker?.avatar} name={attacker?.name} />
            <div className="rro-side-name">{attacker?.name}</div>
            <div className="rro-side-number">{'\uD83C\uDFB2'} {total}</div>
            {hasAdvantage && roll1 != null && roll2 != null ? (
              <div className="rro-side-label rro-advantage-rolls">
                <span className={total - (data.attackBonus || 0) === roll1 ? 'rro-roll-used' : 'rro-roll-discarded'}>{roll1}</span>
                {' | '}
                <span className={total - (data.attackBonus || 0) === roll2 ? 'rro-roll-used' : 'rro-roll-discarded'}>{roll2}</span>
                {' + '}{data.attackBonus || 0}
              </div>
            ) : (
              <div className="rro-side-label">{breakdown}</div>
            )}
          </div>
          <div className="rro-clash">{'\u2694\uFE0F'}</div>
          <div className="rro-side rro-fly-right">
            <Avatar src={defender?.avatar} name={defender?.name} />
            <div className="rro-side-name">{defender?.name}</div>
            <div className="rro-side-number">{'\uD83D\uDEE1\uFE0F'} {targetAC}</div>
            <div className="rro-side-label">AC</div>
          </div>
        </div>
        <div className={`rro-result ${resultClass}`}>
          {resultText}
        </div>
        {isCrit && <div className="rro-crit-subtitle">Roll damage twice!</div>}
        {isFumble && <div className="rro-fumble-subtitle">NAT 1</div>}
      </div>
    </div>
  );
}

function SpellSaveResult({ data, onDismiss }) {
  const { spellName, saveAbility, saveRoll, saveBonus, saveTotal, saveDC, saved, attacker, defender } = data;

  const resultText = saved ? 'SAVED!' : 'FAILED!';
  const resultClass = saved ? 'rro-saved' : 'rro-failed';
  const bonusStr = saveBonus >= 0 ? `+${saveBonus}` : `${saveBonus}`;

  return (
    <div className={`rro-backdrop ${!saved ? 'rro-backdrop-spell' : ''}`} onClick={onDismiss}>
      <div className="rro-content">
        <div className="rro-spell-name">{spellName}</div>
        <div className="rro-comparison">
          <div className="rro-side rro-fly-left">
            <Avatar src={attacker?.avatar} name={attacker?.name} />
            <div className="rro-side-name">{attacker?.name}</div>
            <div className="rro-side-number rro-spell-dc">{'\u2728'} DC {saveDC}</div>
            <div className="rro-side-label">Spell Save</div>
          </div>
          <div className="rro-clash">{'\u2694\uFE0F'}</div>
          <div className="rro-side rro-fly-right">
            <Avatar src={defender?.avatar} name={defender?.name} />
            <div className="rro-side-name">{defender?.name}</div>
            <div className="rro-side-number">{'\uD83C\uDFB2'} {saveTotal}</div>
            <div className="rro-side-label">{saveRoll} {bonusStr} {saveAbility}</div>
          </div>
        </div>
        <div className={`rro-result ${resultClass}`}>
          {resultText}
        </div>
      </div>
    </div>
  );
}

function DamageResult({ data, onDismiss }) {
  const { damage, isCrit, monsterHp, newHp, attacker, defender, smiteDamage, sneakAttackDamage } = data;
  const hasSmite = smiteDamage > 0;
  const hasSneakAttack = sneakAttackDamage > 0;
  const bonusDmg = (smiteDamage || 0) + (sneakAttackDamage || 0);
  const weaponDmg = bonusDmg > 0 ? damage - bonusDmg : damage;

  // Build breakdown label
  let breakdownLabel = 'damage';
  if (hasSmite && hasSneakAttack) {
    breakdownLabel = `${weaponDmg} + ${smiteDamage} radiant + ${sneakAttackDamage} sneak`;
  } else if (hasSmite) {
    breakdownLabel = `${weaponDmg} + ${smiteDamage} radiant`;
  } else if (hasSneakAttack) {
    breakdownLabel = `${weaponDmg} + ${sneakAttackDamage} sneak`;
  }

  // Result banner text and style
  const bannerClass = hasSmite ? 'rro-smite' : hasSneakAttack ? 'rro-sneak-attack' : isCrit ? 'rro-crit' : 'rro-hit';
  const bannerText = hasSmite ? 'DIVINE SMITE!' : hasSneakAttack ? 'SNEAK ATTACK!' : isCrit ? 'CRITICAL DAMAGE!' : `${damage} DAMAGE`;
  const backdropClass = hasSmite ? 'rro-backdrop-smite' : hasSneakAttack ? 'rro-backdrop-sneak' : '';

  return (
    <div className={`rro-backdrop ${backdropClass}`} onClick={onDismiss}>
      <div className="rro-content">
        <div className="rro-comparison">
          <div className="rro-side rro-fly-left">
            <Avatar src={attacker?.avatar} name={attacker?.name} />
            <div className="rro-side-name">{attacker?.name}</div>
            <div className="rro-side-number rro-damage-num">{'\u2694\uFE0F'} {damage}</div>
            <div className="rro-side-label">
              {breakdownLabel}
            </div>
          </div>
          <div className="rro-clash rro-arrow">{'\u2192'}</div>
          <div className="rro-side rro-fly-right">
            <Avatar src={defender?.avatar} name={defender?.name} />
            <div className="rro-side-name">{defender?.name}</div>
            <div className="rro-side-number rro-hp-num">{'\u2764\uFE0F'} {newHp}</div>
            <div className="rro-side-label rro-hp-from">{monsterHp} {'\u2192'} {newHp}</div>
          </div>
        </div>
        <div className={`rro-result ${bannerClass}`}>
          {bannerText}
        </div>
      </div>
    </div>
  );
}

function HealResult({ data, onDismiss }) {
  const { healAmount, potionName, isSpell, diceNotation, diceRoll, spellMod, healer, target, newHp, maxHp, revived } = data;
  const icon = isSpell || potionName === 'Lay on Hands' ? '\u2728' : '\uD83E\uDDEA';

  return (
    <div className="rro-backdrop rro-backdrop-heal" onClick={onDismiss}>
      <div className="rro-content">
        <div className="rro-comparison">
          <div className="rro-side rro-fly-left">
            <Avatar src={healer?.avatar} name={healer?.name} />
            <div className="rro-side-name">{healer?.name}</div>
            <div className="rro-side-number rro-heal-num">{icon} {potionName || 'Potion'}</div>
            {diceNotation ? (
              <div className="rro-side-label">{'\uD83C\uDFB2'} {diceRoll}{spellMod ? ` + ${spellMod}` : ''} = +{healAmount} HP</div>
            ) : (
              <div className="rro-side-label">+{healAmount} HP</div>
            )}
          </div>
          <div className="rro-clash rro-arrow rro-arrow-heal">{'\u2192'}</div>
          <div className="rro-side rro-fly-right">
            <Avatar src={target?.avatar} name={target?.name} />
            <div className="rro-side-name">{target?.name}</div>
            <div className="rro-side-number rro-hp-num rro-heal-hp">{'\u2764\uFE0F'} {newHp}</div>
            <div className="rro-side-label">{newHp}/{maxHp} HP</div>
          </div>
        </div>
        <div className={`rro-result ${revived ? 'rro-revived' : 'rro-healed'}`}>
          {revived ? 'REVIVED!' : `+${healAmount} HP`}
        </div>
      </div>
    </div>
  );
}
