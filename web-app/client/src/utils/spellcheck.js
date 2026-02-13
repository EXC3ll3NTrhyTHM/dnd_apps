import { WORDS, WORD_RANK } from '../data/wordlist';
import { CONTRACTIONS, SKIP_WORDS } from '../data/contractions';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Generate all words that are one edit distance away from `word`.
 * Edits: deletions, transpositions, replacements, insertions.
 */
function edits1(word) {
  const results = [];
  const len = word.length;

  // Deletions
  for (let i = 0; i < len; i++) {
    results.push(word.slice(0, i) + word.slice(i + 1));
  }

  // Transpositions
  for (let i = 0; i < len - 1; i++) {
    results.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }

  // Replacements
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < 26; j++) {
      const c = ALPHABET[j];
      if (c !== word[i]) {
        results.push(word.slice(0, i) + c + word.slice(i + 1));
      }
    }
  }

  // Insertions
  for (let i = 0; i <= len; i++) {
    for (let j = 0; j < 26; j++) {
      results.push(word.slice(0, i) + ALPHABET[j] + word.slice(i));
    }
  }

  return results;
}

/**
 * Return the known-word candidate with the highest frequency rank
 * (lowest rank number = most common).
 */
function bestMatch(candidates) {
  let best = null;
  let bestRank = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const w = candidates[i];
    if (WORDS.has(w)) {
      const rank = WORD_RANK.get(w);
      if (rank < bestRank) {
        bestRank = rank;
        best = w;
      }
    }
  }
  return best;
}

/**
 * Correct a single word (lowercase input expected).
 * Returns the corrected string, or null if no correction needed.
 *
 * Pipeline:
 * 1. Contraction map (dont → don't)
 * 2. Skip list (chat slang, gaming terms)
 * 3. Already a known word → no correction
 * 4. Edit distance 1
 * 5. Edit distance 2 (only for 5-10 char words)
 * 6. No match → null
 */
export function correctWord(word) {
  const lower = word.toLowerCase();

  // 1. Contraction map
  if (lower in CONTRACTIONS) return CONTRACTIONS[lower];

  // 2. Standalone "i" → "I"
  if (lower === 'i') return 'I';

  // 3. Skip list — never correct these
  if (SKIP_WORDS.has(lower)) return null;

  // 4. Very short words (1-2 chars) — skip
  if (lower.length <= 2) return null;

  // 4. Already a known English word
  if (WORDS.has(lower)) return null;

  // 5. Edit distance 1
  const e1 = edits1(lower);
  const match1 = bestMatch(e1);
  if (match1) return match1;

  // 6. Edit distance 2 (only for 5-10 char words to limit cost)
  if (lower.length >= 5 && lower.length <= 10) {
    let best = null;
    let bestRank = Infinity;
    for (let i = 0; i < e1.length; i++) {
      const e2 = edits1(e1[i]);
      for (let j = 0; j < e2.length; j++) {
        const w = e2[j];
        if (WORDS.has(w)) {
          const rank = WORD_RANK.get(w);
          if (rank < bestRank) {
            bestRank = rank;
            best = w;
          }
        }
      }
    }
    if (best) return best;
  }

  // 7. No correction found
  return null;
}
