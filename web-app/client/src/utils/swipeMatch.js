import { WORDS, WORD_RANK } from '../data/wordlist.js';

/**
 * Swipe-to-type matching using shape-template comparison (SHARK2-lite).
 *
 * Instead of detecting which keys the finger physically crosses (unreliable
 * for natural swipes that take shortcuts between distant keys), this compares
 * the *shape* of the finger's path against pre-computed ideal path templates
 * for every word in the dictionary.
 *
 * Pipeline:
 *  1. Pre-index words by (first, last) character pair at module load.
 *  2. On swipe end, find nearest keys to gesture start/end points.
 *  3. Gather candidate words matching those first/last pairs.
 *  4. For each candidate, generate the ideal path (connecting key centers),
 *     resample both paths to N equidistant points, and compare:
 *       - Shape channel: normalized paths (scale/position invariant)
 *       - Location channel: raw pixel paths (penalizes wrong keyboard region)
 *  5. Combine scores with word frequency and return top 3.
 */

const RESAMPLE_N = 50;

// ── Geometry helpers ──

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/** Resample a polyline to N equidistant points */
function resample(pts, N) {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array(N).fill(pts[0]);
  const total = pathLength(pts);
  if (total === 0) return Array(N).fill(pts[0]);

  const step = total / (N - 1);
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  let j = 1;

  for (let i = 1; i < N; i++) {
    const target = step * i;
    while (j < pts.length) {
      const d = dist(pts[j - 1], pts[j]);
      if (acc + d >= target) break;
      acc += d;
      j++;
    }
    if (j >= pts.length) {
      out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
      continue;
    }
    const d = dist(pts[j - 1], pts[j]);
    const t = d > 0 ? (target - acc) / d : 0;
    out.push({
      x: pts[j - 1].x + t * (pts[j].x - pts[j - 1].x),
      y: pts[j - 1].y + t * (pts[j].y - pts[j - 1].y),
    });
  }

  return out;
}

/** Normalize points into a [0,1] bounding box preserving aspect ratio */
function normalizePath(pts) {
  if (pts.length === 0) return pts;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  return pts.map(p => ({ x: (p.x - minX) / s, y: (p.y - minY) / s }));
}

/** Average Euclidean distance between corresponding points in two equal-length arrays */
function avgDist(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += dist(a[i], b[i]);
  return total / a.length;
}

/** Collapse consecutive duplicate characters: "hello" → "helo" */
function dedup(word) {
  let r = '';
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== word[i - 1]) r += word[i];
  }
  return r;
}

// ── Pre-index words by (first, last) character pair at module load ──

const wordsByFL = new Map();
for (const word of WORDS) {
  if (word.length < 2) continue;
  // Only index words that are all lowercase alpha
  let valid = true;
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    if (c < 97 || c > 122) { valid = false; break; }
  }
  if (!valid) continue;
  const key = word[0] + word[word.length - 1];
  let list = wordsByFL.get(key);
  if (!list) { list = []; wordsByFL.set(key, list); }
  list.push(word);
}
// Sort each bucket by frequency (most common first)
for (const [, list] of wordsByFL) {
  list.sort((a, b) => (WORD_RANK.get(a) ?? 9999) - (WORD_RANK.get(b) ?? 9999));
}

/** Find the N nearest key characters to a given point */
function nearestKeys(pt, centers, n) {
  const arr = [];
  for (const [ch, pos] of Object.entries(centers)) {
    arr.push({ ch, d: dist(pt, pos) });
  }
  arr.sort((a, b) => a.d - b.d);
  return arr.slice(0, n).map(a => a.ch);
}

/**
 * Match a swipe gesture to the best word(s) using shape-template matching.
 *
 * @param {Array<{x: number, y: number}>} points – Touch points (board-relative pixels)
 * @param {Array<{char: string, rect: DOMRect}>} keyRects – Key bounding rects (screen pixels)
 * @param {{left: number, top: number}} boardOrigin – Board's screen position
 * @returns {string[]} Up to 3 ranked word candidates
 */
export function matchSwipePath(points, keyRects, boardOrigin) {
  if (!points || points.length < 2 || !keyRects || keyRects.length === 0) return [];

  // Build key center positions in board-relative pixels
  const centers = {};
  for (const kr of keyRects) {
    centers[kr.char] = {
      x: (kr.rect.left + kr.rect.right) / 2 - boardOrigin.left,
      y: (kr.rect.top + kr.rect.bottom) / 2 - boardOrigin.top,
    };
  }

  // Find nearest 3 keys to start and end of gesture
  const startKeys = nearestKeys(points[0], centers, 3);
  const endKeys = nearestKeys(points[points.length - 1], centers, 3);
  if (startKeys.length === 0 || endKeys.length === 0) return [];

  // Gather candidate words from all (first, last) key combinations
  const seen = new Set();
  const candidates = [];
  for (const sk of startKeys) {
    for (const ek of endKeys) {
      const bucket = wordsByFL.get(sk + ek);
      if (!bucket) continue;
      for (const w of bucket) {
        if (seen.has(w)) continue;
        seen.add(w);
        candidates.push(w);
      }
    }
  }
  if (candidates.length === 0) return [];

  // Resample and normalize user path
  const userResampled = resample(points, RESAMPLE_N);
  const userNormalized = normalizePath(userResampled);

  // Compute keyboard diagonal for location score normalization
  let kbMinX = Infinity, kbMaxX = -Infinity, kbMinY = Infinity, kbMaxY = -Infinity;
  for (const pos of Object.values(centers)) {
    if (pos.x < kbMinX) kbMinX = pos.x;
    if (pos.x > kbMaxX) kbMaxX = pos.x;
    if (pos.y < kbMinY) kbMinY = pos.y;
    if (pos.y > kbMaxY) kbMaxY = pos.y;
  }
  const kbDiag = Math.sqrt((kbMaxX - kbMinX) ** 2 + (kbMaxY - kbMinY) ** 2) || 1;

  // Score each candidate
  const scored = [];
  for (const word of candidates) {
    // Build ideal path by connecting key centers
    const chars = dedup(word);
    const idealPts = [];
    let valid = true;
    for (const ch of chars) {
      if (!centers[ch]) { valid = false; break; }
      idealPts.push(centers[ch]);
    }
    if (!valid || idealPts.length < 2) continue;

    // Resample and normalize ideal path
    const idealResampled = resample(idealPts, RESAMPLE_N);
    const idealNormalized = normalizePath(idealResampled);

    // Shape channel (normalized — captures gesture shape regardless of scale/position)
    const shape = avgDist(userNormalized, idealNormalized);

    // Location channel (raw pixel coordinates — penalizes wrong keyboard region)
    const location = avgDist(userResampled, idealResampled) / kbDiag;

    // Frequency bonus (lower rank = more common word = lower bonus penalty)
    const freq = (WORD_RANK.get(word) ?? 9999) / 10000;

    // Combined score (lower = better match)
    const score = shape * 0.4 + location * 0.4 + freq * 0.2;
    scored.push({ word, score });
  }

  // Sort by score (lower = better)
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 3).map(s => s.word);
}
