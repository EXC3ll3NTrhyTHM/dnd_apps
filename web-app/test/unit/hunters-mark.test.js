/**
 * Unit tests for Hunter's Mark spell.
 * Uses Node's built-in test runner (node:test).
 * Run: node --test test/unit/hunters-mark.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  SPELL_DEFINITIONS,
  getAvailableBonusActions,
  resolveBonusAction,
} = require('../../server/lib/encounters');

// ── Helpers ──

/** Create a minimal encounter with a Ranger participant and a monster. */
function createTestEncounter(overrides = {}) {
  const playerId = 'test-ranger-123';
  const encounter = {
    id: 'test-enc-1',
    locationId: 'test_arena',
    phase: 'action',
    round: 1,
    currentTurnIndex: 0,
    initiativeOrder: [{ id: playerId, type: 'player', name: 'Tyren' }],
    monster: {
      name: 'Goblin',
      currentHp: 30,
      maxHp: 30,
      ac: 13,
      cr: 1,
      attacks: [{ name: 'Scimitar', dice: '1d6', bonus: 4, type: 'slashing' }],
      conditions: [],
      savingThrows: { STR: 1, DEX: 2, CON: 1 },
    },
    participants: {
      [playerId]: {
        name: 'Tyren',
        avatar: null,
        sprite: null,
        maxHp: 25,
        currentHp: 25,
        ac: 15,
        attackBonus: 5,
        damageMod: 3,
        damageNotation: '1d8',
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
        spellSlots: [{ level: 1, total: 2, used: 0 }],
        classNames: ['Ranger'],
        classFeatures: ['Spellcasting'],
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
        ...overrides,
      },
    },
    log: [],
    lastActivity: Date.now(),
  };
  return { encounter, playerId };
}

// ── Tests ──

describe("Hunter's Mark", () => {

  describe('Spell Definition', () => {
    it('exists in SPELL_DEFINITIONS', () => {
      assert.ok(SPELL_DEFINITIONS.hunters_mark, "hunters_mark should be defined");
    });

    it('is a level 1 bonus action concentration spell', () => {
      const hm = SPELL_DEFINITIONS.hunters_mark;
      assert.strictEqual(hm.level, 1);
      assert.strictEqual(hm.actionType, 'bonus');
      assert.strictEqual(hm.concentration, true);
      assert.strictEqual(hm.damageDice, '1d6');
    });

    it('is available to Rangers', () => {
      const hm = SPELL_DEFINITIONS.hunters_mark;
      assert.ok(hm.classes.includes('Ranger'));
    });
  });

  describe('Bonus Action Availability', () => {
    it('appears in available bonus actions for a Ranger with spell slots', () => {
      const { encounter, playerId } = createTestEncounter();
      const actions = getAvailableBonusActions(encounter, playerId);
      const hmAction = actions.find(a => a.type === 'hunters_mark');
      assert.ok(hmAction, "Hunter's Mark should be available");
      assert.strictEqual(hmAction.spellName, "Hunter's Mark");
    });

    it('does not appear when already active', () => {
      const { encounter, playerId } = createTestEncounter({ huntersMarkActive: true });
      const actions = getAvailableBonusActions(encounter, playerId);
      const hmAction = actions.find(a => a.type === 'hunters_mark');
      assert.strictEqual(hmAction, undefined, "Hunter's Mark should not appear when already active");
    });

    it('does not appear when no spell slots remain', () => {
      const { encounter, playerId } = createTestEncounter({
        spellSlots: [{ level: 1, total: 2, used: 2 }],
      });
      const actions = getAvailableBonusActions(encounter, playerId);
      const hmAction = actions.find(a => a.type === 'hunters_mark');
      assert.strictEqual(hmAction, undefined, "Hunter's Mark should not appear with no spell slots");
    });

    it('does not appear for non-Ranger classes', () => {
      const { encounter, playerId } = createTestEncounter({
        classNames: ['Fighter'],
      });
      const actions = getAvailableBonusActions(encounter, playerId);
      const hmAction = actions.find(a => a.type === 'hunters_mark');
      assert.strictEqual(hmAction, undefined, "Hunter's Mark should not appear for Fighter");
    });
  });

  describe('Casting (resolveBonusAction)', () => {
    it('consumes a spell slot and sets huntersMarkActive', () => {
      const { encounter, playerId } = createTestEncounter();
      const result = resolveBonusAction(encounter, playerId, 'hunters_mark', {});

      assert.strictEqual(result.type, 'hunters_mark');
      assert.strictEqual(result.spellName, "Hunter's Mark");
      assert.ok(result.text.includes("Hunter's Mark"), "Result text should mention Hunter's Mark");

      const player = encounter.participants[playerId];
      assert.strictEqual(player.huntersMarkActive, true);
      assert.strictEqual(player.bonusActionUsed, true);
      assert.strictEqual(player.spellSlots[0].used, 1, 'Should consume one spell slot');
      assert.deepStrictEqual(player.concentration, {
        spellId: 'hunters_mark',
        targetId: 'monster',
        conditionId: null,
      });
    });

    it('fails for non-Ranger class', () => {
      const { encounter, playerId } = createTestEncounter({ classNames: ['Fighter'] });
      const result = resolveBonusAction(encounter, playerId, 'hunters_mark', {});
      assert.ok(result.error, 'Should return an error');
    });

    it('fails when no spell slots remain', () => {
      const { encounter, playerId } = createTestEncounter({
        spellSlots: [{ level: 1, total: 2, used: 2 }],
      });
      const result = resolveBonusAction(encounter, playerId, 'hunters_mark', {});
      assert.ok(result.error, 'Should return an error about spell slots');
    });

    it('breaks existing Ensnaring Strike concentration', () => {
      const { encounter, playerId } = createTestEncounter({
        ensnaringStrikeActive: true,
        concentration: { spellId: 'ensnaring_strike', targetId: 'monster', conditionId: 'ensnared' },
      });
      // Add ensnared condition to monster so we can verify it gets removed
      encounter.monster.conditions = [{ id: 'ensnared', name: 'Ensnared' }];

      const result = resolveBonusAction(encounter, playerId, 'hunters_mark', {});
      assert.strictEqual(result.type, 'hunters_mark');

      const player = encounter.participants[playerId];
      assert.strictEqual(player.ensnaringStrikeActive, false, 'Ensnaring Strike should be cleared');
      assert.strictEqual(player.huntersMarkActive, true);
      assert.strictEqual(player.concentration.spellId, 'hunters_mark');

      // Ensnared condition should be removed from monster
      const ensnared = encounter.monster.conditions.find(c => c.id === 'ensnared');
      assert.strictEqual(ensnared, undefined, 'Ensnared condition should be removed from monster');
    });

    it('fails when bonus action already used', () => {
      const { encounter, playerId } = createTestEncounter({ bonusActionUsed: true });
      const result = resolveBonusAction(encounter, playerId, 'hunters_mark', {});
      assert.ok(result.error, 'Should fail when bonus action already used');
    });
  });

  describe('Concentration tracking', () => {
    it('sets concentration to hunters_mark targeting monster', () => {
      const { encounter, playerId } = createTestEncounter();
      resolveBonusAction(encounter, playerId, 'hunters_mark', {});

      const player = encounter.participants[playerId];
      assert.strictEqual(player.concentration.spellId, 'hunters_mark');
      assert.strictEqual(player.concentration.targetId, 'monster');
    });

    it('casting Ensnaring Strike after Hunter\'s Mark clears the mark', () => {
      const { encounter, playerId } = createTestEncounter();

      // Cast Hunter's Mark first
      resolveBonusAction(encounter, playerId, 'hunters_mark', {});
      const player = encounter.participants[playerId];
      assert.strictEqual(player.huntersMarkActive, true);

      // Reset bonus action for next cast
      player.bonusActionUsed = false;

      // Cast Ensnaring Strike (also available to Rangers)
      resolveBonusAction(encounter, playerId, 'ensnaring_strike', {});
      assert.strictEqual(player.huntersMarkActive, false,
        "Hunter's Mark should be cleared when new concentration spell is cast");
      assert.strictEqual(player.ensnaringStrikeActive, true);
      assert.strictEqual(player.concentration.spellId, 'ensnaring_strike');
    });
  });
});
