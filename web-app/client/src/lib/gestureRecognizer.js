/**
 * Gesture recognizer with custom M detection.
 *
 * Instead of Jager's section-based matching (which classifies diagonal M strokes
 * as horizontal), we analyze the path's Y-direction reversals directly.
 *
 * An M drawn left-to-right has this Y pattern (screen coords, Y increases downward):
 *   high → low → high → low → high  (bottom → top → bottom → top → bottom)
 * That's 4 Y-direction segments: up, down, up, down.
 */

const MIN_POINTS = 12;
const MIN_SIZE = 30; // px minimum width and height

export function createRecognizer() {
  let points = [];

  return {
    addPoint(x, y) {
      const last = points.length > 0 ? points[points.length - 1] : null;
      if (last) {
        // Only add if moved enough (basic deduplication)
        const dx = x - last.x;
        const dy = y - last.y;
        if (dx * dx + dy * dy < 9) return null; // < 3px, skip
      }
      points.push({ x, y });
      return last ? [last, { x, y }] : null;
    },

    recognize() {
      const result = detectM(points);
      points = [];
      return result ? 'M' : null;
    },

    reset() {
      points = [];
    },

    getPoints() {
      return points.map(p => ({ x: p.x, y: p.y }));
    },
  };
}

/**
 * Detect an M shape in the given points array.
 *
 * Strategy:
 * 1. Check minimum size
 * 2. Smooth Y values to filter jitter
 * 3. Find significant Y-direction reversals
 * 4. Verify M pattern: up → down → up → down (4 segments)
 * 5. Check start/end are near bottom, path moves left-to-right
 */
function detectM(points) {
  if (points.length < MIN_POINTS) return false;

  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width < MIN_SIZE || height < MIN_SIZE) return false;

  // Resample to evenly-spaced points for consistent analysis
  const resampled = resamplePath(points, 50);

  // Smooth Y values with moving average to kill jitter
  const smoothed = smoothPath(resampled, 3);

  // Find Y-direction segments (ignoring changes smaller than threshold)
  const noiseThreshold = height * 0.12;
  const segments = findDirectionSegments(smoothed, noiseThreshold);

  // Need at least 4 segments for an M: up, down, up, down
  if (segments.length < 4) return false;

  // Look for the core M pattern: up → down → up → down
  // "up" = Y decreasing (toward top of screen), "down" = Y increasing
  let mFound = false;
  for (let i = 0; i <= segments.length - 4; i++) {
    const a = segments[i], b = segments[i + 1], c = segments[i + 2], d = segments[i + 3];
    if (a.dir === -1 && b.dir === 1 && c.dir === -1 && d.dir === 1) {
      mFound = true;
      break;
    }
  }
  if (!mFound) return false;

  // Check start and end are in the bottom half of the gesture
  const midY = minY + height * 0.5;
  const startY = points[0].y;
  const endY = points[points.length - 1].y;
  if (startY < midY || endY < midY) return false;

  // Check path generally moves left to right
  const startX = points[0].x;
  const endX = points[points.length - 1].x;
  if (endX <= startX + width * 0.15) return false;

  return true;
}

/**
 * Resample a path to N evenly-spaced points by arc length.
 */
function resamplePath(points, n) {
  // Compute cumulative arc length
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  const totalLen = dists[dists.length - 1];
  if (totalLen < 1) return points.slice();

  const step = totalLen / (n - 1);
  const result = [{ ...points[0] }];
  let j = 1;

  for (let i = 1; i < n - 1; i++) {
    const targetDist = i * step;
    while (j < points.length - 1 && dists[j] < targetDist) j++;
    const prev = j - 1;
    const segLen = dists[j] - dists[prev];
    const t = segLen > 0 ? (targetDist - dists[prev]) / segLen : 0;
    result.push({
      x: points[prev].x + t * (points[j].x - points[prev].x),
      y: points[prev].y + t * (points[j].y - points[prev].y),
    });
  }

  result.push({ ...points[points.length - 1] });
  return result;
}

/**
 * Simple moving average to smooth a path.
 */
function smoothPath(points, radius) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(points.length - 1, i + radius); j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      count++;
    }
    result.push({ x: sumX / count, y: sumY / count });
  }
  return result;
}

/**
 * Find significant Y-direction segments.
 * Returns array of { dir: -1 (up/Y-decreasing) | 1 (down/Y-increasing), magnitude }.
 * Ignores reversals smaller than noiseThreshold.
 */
function findDirectionSegments(points, noiseThreshold) {
  if (points.length < 2) return [];

  const segments = [];
  let currentDir = 0; // -1 = up, 1 = down, 0 = undecided
  let extremeY = points[0].y; // tracks the peak/valley Y

  for (let i = 1; i < points.length; i++) {
    const dy = points[i].y - extremeY;

    if (currentDir === 0) {
      // Haven't committed to a direction yet
      if (dy < -noiseThreshold) {
        currentDir = -1; // going up
        extremeY = points[i].y;
      } else if (dy > noiseThreshold) {
        currentDir = 1; // going down
        extremeY = points[i].y;
      }
    } else if (currentDir === -1) {
      // Currently going up (Y decreasing)
      if (points[i].y < extremeY) {
        extremeY = points[i].y; // new peak
      } else if (points[i].y - extremeY > noiseThreshold) {
        // Significant reversal — we were going up, now going down
        segments.push({ dir: -1, magnitude: Math.abs(extremeY - points[0].y) });
        currentDir = 1;
        extremeY = points[i].y;
      }
    } else {
      // Currently going down (Y increasing)
      if (points[i].y > extremeY) {
        extremeY = points[i].y; // new valley
      } else if (extremeY - points[i].y > noiseThreshold) {
        // Significant reversal — we were going down, now going up
        segments.push({ dir: 1, magnitude: Math.abs(extremeY - points[0].y) });
        currentDir = -1;
        extremeY = points[i].y;
      }
    }
  }

  // Push the final segment
  if (currentDir !== 0) {
    segments.push({ dir: currentDir, magnitude: 0 });
  }

  return segments;
}
