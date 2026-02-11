/**
 * Unambiguous contraction mappings (no apostrophe → with apostrophe).
 * Only includes words that are NOT valid English on their own.
 * Excluded: its, well, hell, shell, were, wed, shed, ill, id, etc.
 */
export const CONTRACTIONS = {
  'dont': "don't",
  'doesnt': "doesn't",
  'didnt': "didn't",
  'cant': "can't",
  'wont': "won't",
  'wouldnt': "wouldn't",
  'shouldnt': "shouldn't",
  'couldnt': "couldn't",
  'isnt': "isn't",
  'arent': "aren't",
  'wasnt': "wasn't",
  'werent': "weren't",
  'havent': "haven't",
  'hasnt': "hasn't",
  'hadnt': "hadn't",
  'youre': "you're",
  'theyre': "they're",
  'weve': "we've",
  'youve': "you've",
  'theyve': "they've",
  'wouldve': "would've",
  'shouldve': "should've",
  'couldve': "could've",
  'mustve': "must've",
  'mightve': "might've",
  'im': "I'm",
  'ive': "I've",
  'hes': "he's",
  'shes': "she's",
  'thats': "that's",
  'whats': "what's",
  'whos': "who's",
  'wheres': "where's",
  'heres': "here's",
  'theres': "there's",
  'lets': "let's",
  'yall': "y'all",
};

/**
 * Words the spell corrector should never touch.
 * Chat slang, gaming terms, short words, abbreviations.
 */
export const SKIP_WORDS = new Set([
  // Chat slang
  'lol', 'lmao', 'lmfao', 'rofl', 'brb', 'afk', 'omg', 'omfg', 'smh',
  'tbh', 'imo', 'imho', 'idk', 'idc', 'idgaf', 'stfu', 'gtfo', 'ftw',
  'fyi', 'btw', 'gg', 'wp', 'ez', 'rn', 'ngl', 'fr', 'irl', 'til',
  'tldr', 'dm', 'dms', 'pm', 'pms', 'ty', 'tyvm', 'yw', 'np', 'nvm',
  'ofc', 'ikr', 'ily', 'wyd', 'wya', 'hmu', 'fomo', 'yolo', 'smth',
  'sth', 'ppl', 'rly', 'tho', 'thru', 'ur', 'u', 'r', 'k', 'ok', 'kk',
  'pls', 'plz', 'thx', 'tx', 'sry', 'jk', 'jfc', 'wtf', 'wth', 'omw',
  'bff', 'sus', 'goat', 'oof', 'uwu', 'owo',
  // Gaming terms
  'npc', 'npcs', 'hp', 'mp', 'xp', 'dps', 'aoe', 'pvp', 'pve', 'rpg',
  'mmo', 'mmorpg', 'fps', 'rng', 'op', 'nerf', 'buff', 'debuff', 'aggro',
  'respawn', 'noob', 'newb', 'gg', 'glhf', 'afk', 'dc', 'lfg', 'lf',
  'wts', 'wtb', 'gm', 'mod', 'mods', 'bot', 'bots', 'rp',
  // Common abbreviations
  'etc', 'vs', 'aka', 'asap', 'eta', 'diy', 'tba', 'tbd',
  // Informal words that should stay as-is
  'gonna', 'wanna', 'kinda', 'sorta', 'gotta', 'lemme', 'gimme',
  'dunno', 'innit', 'aint', 'yep', 'yup', 'nah', 'nope', 'huh',
  'hmm', 'hmmm', 'uhh', 'umm', 'ahh', 'ohh', 'ooh', 'mhm', 'ugh',
  'eww', 'aww', 'whoa', 'woah', 'bruh', 'bro', 'dude', 'fam',
  'yo', 'ay', 'aye', 'yay', 'woo', 'haha', 'hahaha', 'lolol',
  'hehe', 'hihi', 'xd', 'xdd',
  // NPC names / app-specific
  'bonesy', 'kumo', 'ximena', 'mai', 'ember', 'brynleaf', 'mira', 'rhea',
  'nibby', 'jonah', 'cena', 'kai', 'aurelia', 'ithrae', 'djinn', 'marcel',
  'varrow', 'marella', 'blackwell', 'dawnwrath', 'galecrest', 'zenatsu',
  'stoic',
]);
