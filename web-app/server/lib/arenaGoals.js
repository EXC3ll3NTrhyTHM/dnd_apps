/**
 * Arena Daily Goal definitions.
 * Shared by the API endpoints and optionally the client.
 */

const ARENA_DAILY_GOALS = [
  { key: 'arena_win_1',        label: 'Victory!',       icon: '\u2694\uFE0F', stat: 'arena_wins',        target: 1, xp: 50,  gold: 10 },
  { key: 'arena_win_3',        label: 'Triple Threat',  icon: '\uD83D\uDD25', stat: 'arena_wins',        target: 3, xp: 100, gold: 25 },
  { key: 'arena_killing_blow', label: 'Killing Blow',   icon: '\uD83D\uDDE1\uFE0F', stat: 'arena_kills', target: 1, xp: 40,  gold: 5  },
  { key: 'arena_crit',         label: 'Critical Strike', icon: '\uD83C\uDFAF', stat: 'arena_crits',      target: 1, xp: 30,  gold: 5  },
  { key: 'arena_untouchable',  label: 'Untouchable',    icon: '\uD83D\uDEE1\uFE0F', stat: 'arena_untouchable', target: 1, xp: 75, gold: 15 },
  { key: 'arena_potion',       label: 'Bottoms Up',     icon: '\uD83E\uDDEA', stat: 'arena_potions',     target: 1, xp: 20,  gold: 0  },
];

module.exports = { ARENA_DAILY_GOALS };
