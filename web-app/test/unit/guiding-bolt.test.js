/**
 * Unit tests for Guiding Bolt spell — advantage flag lifecycle.
 * Uses Node's built-in test runner (node:test).
 * Run: node --test test/unit/guiding-bolt.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  SPELL_DEFINITIONS,
  resolveSingleAction,
  resolveCastSpell,
  resolveBonusAction,
} = require('../../server/lib/encounters');

// ── Helpers ──

/** Create a minimal encounter with a Cleric participant and a monster. */
function createTestEncounter(overrides = {}) {
  const playerId = 'test-cleric-123';
  const encounter = {
    id: 'test-enc-gb',
    locationId: 'test_arena',
    phase: 'action',
    round: 1,
    currentTurnIndex: 0,
    initiativeOrder: [{ id: playerId, type: 'player', name: 'Aly' }],
    monster: {
      name: 'Goblin',
      currentHp: 50,
      maxHp: 50,
      ac: 13,
      cr: 1,
      attacks: [{ name: 'Scimitar', dice: '1d6', bonus: 4, type: 'slashing' }],
      conditions: [],
      savingThrows: { STR: 1, DEX: 2, CON: 1, INT: 0, WIS: 0, CHA: -1 },
      guidingBoltAdvantage: false,
    },
    participants: {
      [playerId]: {
        name: 'Aly',
        avatar: null,
        sprite: null,
        maxHp: 30,
        currentHp: 30,
        ac: 16,
        attackBonus: 4,
        damageMod: 2,
        damageNotation: '1d8',
        weaponName: 'Mace',
        damageType: 'bludgeoning',
        weapons: [],
        dexMod: 1,
        action: null,
        totalDamage: 0,
        knockedOut: false,
        dodging: false,
        advantageOnNextAttack: false,
        bonusActionUsed: false,
        spellSlots: [{ level: 1, total: 3, used: 0 }],
        classNames: ['Cleric'],
        classFeatures: ['Spellcasting', 'Disciple of Life'],
        layOnHandsPool: 0,
        layOnHandsUsed: 0,
        hasBardicInspiration: false,
        bardicInspirationUses: 0,
        bardicInspirationMax: 0,
        bardicInspirationDie: 'd6',
        inspirationDie: null,
        inspiredBy: null,
        sneakAttackDice: 0,
        sneakAttackUsed: false,
        spellSaveDC: 13,
        spellAttackBonus: 5,
        spellcastingMod: 3,
        channelDivinityMax: 1,
        channelDivinityUsed: 0,
        hasNaturesWrath: false,
        concentration: null,
        ensnaringStrikeActive: false,
        huntersMarkActive: false,
        conMod: 2,
        hasKiPoints: false,
        kiPointsMax: 0,
        kiPointsUsed: 0,
        kiSaveDC: 0,
        martialArtsDie: '1d4',
        stunningStrikeActive: false,
        conditions: [],
        canOffhandAttack: false,
        spiritualWeaponActive: false,
        raging: false,
        ...overrides,
      },
    },
    log: [],
    lastActivity: Date.now(),
  };
  return { encounter, playerId };
}

/** Add a second participant (Fighter) to an encounter. */
function addFighter(encounter) {
  const fighterId = 'test-fighter-456';
  encounter.participants[fighterId] = {
    name: 'Tyren',
    avatar: null,
    sprite: null,
    maxHp: 40,
    currentHp: 40,
    ac: 18,
    attackBonus: 7,
    damageMod: 4,
    damageNotation: '1d10',
    weaponName: 'Longsword',
    damageType: 'slashing',
    weapons: [],
    dexMod: 2,
    action: null,
    totalDamage: 0,
    knockedOut: false,
    dodging: false,
    advantageOnNextAttack: false,
    bonusActionUsed: false,
    spellSlots: [],
    classNames: ['Fighter'],
    classFeatures: [],
    layOnHandsPool: 0,
    layOnHandsUsed: 0,
    hasBardicInspiration: false,
    bardicInspirationUses: 0,
    bardicInspirationMax: 0,
    bardicInspirationDie: 'd6',
    inspirationDie: null,
    inspiredBy: null,
    sneakAttackDice: 0,
    sneakAttackUsed: false,
    spellSaveDC: 0,
    spellAttackBonus: 0,
    spellcastingMod: 0,
    channelDivinityMax: 0,
    channelDivinityUsed: 0,
    hasNaturesWrath: false,
    concentration: null,
    ensnaringStrikeActive: false,
    huntersMarkActive: false,
    conMod: 2,
    hasKiPoints: false,
    kiPointsMax: 0,
    kiPointsUsed: 0,
    kiSaveDC: 0,
    martialArtsDie: '1d4',
    stunningStrikeActive: false,
    conditions: [],
    canOffhandAttack: false,
    raging: false,
  };
  encounter.initiativeOrder.push({ id: fighterId, type: 'player', name: 'Tyren' });
  return fighterId;
}

// ── Tests ──

describe('Guiding Bolt', () => {

  describe('Spell Definition', () => {
    it('exists in SPELL_DEFINITIONS with advantage_next_attack', () => {
      const gb = SPELL_DEFINITIONS.guiding_bolt;
      assert.ok(gb, 'guiding_bolt should be defined');
      assert.strictEqual(gb.extraEffect, 'advantage_next_attack');
      assert.strictEqual(gb.effectType, 'attack_damage');
      assert.ok(gb.classes.includes('Cleric'));
    });
  });

  describe('Sets flag on hit', () => {
    it('sets guidingBoltAdvantage on monster when Guiding Bolt hits', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];
      player.action = 'cast_spell';

      // Force a high attack roll to guarantee a hit (18 + 5 = 23 vs AC 13)
      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 18,
        damageTotal: 14,
      });

      assert.strictEqual(result.hit, true);
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, true);
      assert.strictEqual(result.extraEffect, 'advantage_next_attack');
    });
  });

  describe('Does NOT set flag on miss', () => {
    it('keeps guidingBoltAdvantage false when Guiding Bolt misses', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];
      player.action = 'cast_spell';

      // Force a nat 1 to guarantee a miss
      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 1,
        damageTotal: 0,
      });

      assert.strictEqual(result.hit, false);
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, false);
    });
  });

  describe('Melee attack clears flag', () => {
    it('clears guidingBoltAdvantage after a melee attack', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];

      // Set the flag as if Guiding Bolt already hit
      encounter.monster.guidingBoltAdvantage = true;

      // Submit a melee attack action
      player.action = 'attack';
      player.attackRollValue = 15;
      player.attackRollValue2 = 10;
      player.damageRollValue = 6;

      const result = resolveSingleAction(encounter, playerId);

      assert.strictEqual(encounter.monster.guidingBoltAdvantage, false,
        'guidingBoltAdvantage should be cleared after melee attack');
      assert.strictEqual(result.advantageType, 'advantage',
        'Attack should have had advantage from Guiding Bolt');
    });
  });

  describe('Spell attack clears flag (Bug B fix)', () => {
    it('clears guidingBoltAdvantage after an attack spell', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];

      // Set the flag as if Guiding Bolt already hit
      encounter.monster.guidingBoltAdvantage = true;

      player.action = 'cast_spell';

      // Cast a second Guiding Bolt (or any attack spell) — the flag should be cleared
      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 15,
        attackRoll2: 10,
        damageTotal: 14,
      });

      // The attack itself benefits from advantage, then clears the flag
      assert.strictEqual(result.advantageType, 'advantage',
        'Spell attack should have had advantage from Guiding Bolt');
      // The new Guiding Bolt hit sets the flag again, but the OLD flag was cleared first
      // Since this Guiding Bolt also hits, the flag gets re-set
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, true,
        'New Guiding Bolt hit re-sets the flag');
    });

    it('clears flag when attack spell misses (no re-set)', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];

      encounter.monster.guidingBoltAdvantage = true;
      player.action = 'cast_spell';

      // Force a miss — even with advantage, both rolls miss
      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 2,
        attackRoll2: 3,
        damageTotal: 0,
      });

      assert.strictEqual(result.hit, false);
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, false,
        'guidingBoltAdvantage should be cleared even on miss');
    });
  });

  describe('Spiritual weapon clears flag (Bug B fix)', () => {
    it('clears guidingBoltAdvantage after spiritual weapon attack', () => {
      const { encounter, playerId } = createTestEncounter({
        spiritualWeaponActive: true,
      });

      encounter.monster.guidingBoltAdvantage = true;

      const result = resolveBonusAction(encounter, playerId, 'spiritual_weapon_attack', {
        attackRoll: 15,
        attackRoll2: 10,
        damageTotal: 8,
      });

      assert.strictEqual(result.type, 'spiritual_weapon_attack');
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, false,
        'guidingBoltAdvantage should be cleared after spiritual weapon attack');
      assert.strictEqual(result.advantageType, 'advantage',
        'Spiritual weapon should have had advantage');
    });
  });

  describe('Second attack does NOT get advantage', () => {
    it('only first attacker benefits from Guiding Bolt advantage', () => {
      const { encounter, playerId } = createTestEncounter();
      const fighterId = addFighter(encounter);

      encounter.monster.guidingBoltAdvantage = true;

      // Player A (Cleric) melee attack — should get advantage
      const playerA = encounter.participants[playerId];
      playerA.action = 'attack';
      playerA.attackRollValue = 15;
      playerA.attackRollValue2 = 10;
      playerA.damageRollValue = 6;

      const resultA = resolveSingleAction(encounter, playerId);
      assert.strictEqual(resultA.advantageType, 'advantage',
        'First attack should have advantage');
      assert.strictEqual(encounter.monster.guidingBoltAdvantage, false,
        'Flag should be cleared after first attack');

      // Player B (Fighter) melee attack — should NOT get advantage
      const playerB = encounter.participants[fighterId];
      playerB.action = 'attack';
      playerB.attackRollValue = 12;
      playerB.damageRollValue = 8;

      const resultB = resolveSingleAction(encounter, fighterId);
      assert.strictEqual(resultB.advantageType, 'normal',
        'Second attack should NOT have advantage');
    });
  });

  describe('Spell attack benefits from advantage (Bug B fix)', () => {
    it('uses higher of two rolls when Guiding Bolt advantage is active', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];

      encounter.monster.guidingBoltAdvantage = true;
      player.action = 'cast_spell';

      // Force rolls: attackRoll=5, attackRoll2=15. With advantage, should use 15.
      // 15 + 5 (spellAttackBonus) = 20 vs AC 13 = hit
      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 5,
        attackRoll2: 15,
        damageTotal: 14,
      });

      assert.strictEqual(result.advantageType, 'advantage');
      // Total should be based on the higher roll (15), not the lower (5)
      assert.strictEqual(result.totalAttack, 15 + 5,
        'Should use higher roll (15) + spellAttackBonus (5) = 20');
      assert.strictEqual(result.hit, true,
        'Attack should hit using the higher roll');
    });

    it('would miss without advantage using only the first roll', () => {
      const { encounter, playerId } = createTestEncounter();
      const player = encounter.participants[playerId];

      // No advantage — single roll of 5 + 5 = 10 vs AC 13 = miss
      encounter.monster.guidingBoltAdvantage = false;
      player.action = 'cast_spell';

      const result = resolveCastSpell(encounter, playerId, 'guiding_bolt', {
        attackRoll: 5,
        damageTotal: 14,
      });

      assert.strictEqual(result.advantageType, 'normal');
      assert.strictEqual(result.totalAttack, 5 + 5,
        'Should use single roll (5) + spellAttackBonus (5) = 10');
      assert.strictEqual(result.hit, false,
        'Attack should miss without advantage');
    });
  });
});
