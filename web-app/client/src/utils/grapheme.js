/**
 * Grapheme-aware cursor helpers using Intl.Segmenter.
 * Ensures emoji (and other multi-code-unit characters) are treated
 * as single units for backspace and arrow key navigation.
 */

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Returns the code-unit length of the grapheme cluster immediately
 * before `pos` in `str`. Used for backspace.
 * Falls back to 1 if Segmenter isn't available or pos is 0.
 */
export function prevGraphemeLength(str, pos) {
  if (pos <= 0 || !str) return 0;
  const before = str.slice(0, pos);
  const segments = [...segmenter.segment(before)];
  if (segments.length === 0) return 1;
  return segments[segments.length - 1].segment.length;
}

/**
 * Returns the code-unit length of the grapheme cluster immediately
 * after `pos` in `str`. Used for right arrow.
 * Falls back to 1 if Segmenter isn't available or pos is at end.
 */
export function nextGraphemeLength(str, pos) {
  if (pos >= str.length || !str) return 0;
  const after = str.slice(pos);
  const segments = segmenter.segment(after);
  const first = segments[Symbol.iterator]().next();
  if (first.done) return 1;
  return first.value.segment.length;
}
