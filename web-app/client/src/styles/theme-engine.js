/**
 * Theme Decay Engine
 *
 * Defines 3 color palettes and interpolates between them
 * based on the campaign phase value (0.0 to 3.0).
 *
 * Phase 1 (1.0): Illuminated Manuscript — warm leather/gold/clean
 * Phase 2 (2.0): Creeping Rot — tarnished copper, green-tinged
 * Phase 3 (3.0): Full Decay — bioluminescent, organic
 */

// Color palettes keyed by phase
const PALETTES = {
  1: {
    bgDeepest: [12, 10, 7],       // #0c0a07
    bgDark: [20, 17, 16],         // #141110
    bgSurface: [28, 24, 19],      // #1c1813
    bgElevated: [38, 33, 26],     // #26211a
    bgCard: [33, 28, 21],         // #211c15
    bgCardHover: [43, 36, 27],    // #2b241b
    colorGold: [212, 168, 67],    // #d4a843
    colorGoldBright: [240, 200, 80], // #f0c850
    colorGoldDim: [160, 125, 47], // #a07d2f
    colorAccent: [196, 149, 106], // #c4956a
    borderColor: [51, 41, 28],    // #33291c
    borderColorLight: [74, 60, 40], // #4a3c28
    textPrimary: [232, 224, 212], // #e8e0d4
    textSecondary: [168, 154, 136], // #a89a88
    textMuted: [110, 98, 82],     // #6e6252
    textBright: [255, 245, 230],  // #fff5e6
    shadowGlow: [212, 168, 67, 0.20] // gold glow
  },
  2: {
    bgDeepest: [8, 12, 10],       // greenish dark
    bgDark: [12, 16, 14],
    bgSurface: [22, 28, 24],
    bgElevated: [30, 36, 30],
    bgCard: [25, 32, 26],
    bgCardHover: [32, 40, 33],
    colorGold: [184, 132, 60],    // tarnished copper
    colorGoldBright: [200, 155, 70],
    colorGoldDim: [140, 100, 45],
    colorAccent: [170, 125, 80],
    borderColor: [38, 45, 38],
    borderColorLight: [52, 60, 50],
    textPrimary: [210, 205, 195],
    textSecondary: [155, 148, 135],
    textMuted: [95, 90, 78],
    textBright: [235, 228, 215],
    shadowGlow: [140, 100, 45, 0.12]
  },
  3: {
    bgDeepest: [5, 8, 12],        // deep dark blue-black
    bgDark: [8, 12, 18],
    bgSurface: [14, 20, 28],
    bgElevated: [20, 28, 36],
    bgCard: [16, 24, 32],
    bgCardHover: [22, 32, 40],
    colorGold: [60, 200, 180],    // bioluminescent teal
    colorGoldBright: [80, 230, 200],
    colorGoldDim: [40, 160, 140],
    colorAccent: [140, 80, 200],  // purple accent
    borderColor: [20, 35, 45],
    borderColorLight: [30, 50, 60],
    textPrimary: [200, 210, 215],
    textSecondary: [140, 150, 155],
    textMuted: [80, 90, 95],
    textBright: [220, 235, 240],
    shadowGlow: [60, 200, 180, 0.15]
  }
};

/**
 * Linearly interpolate between two values
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Interpolate between two color arrays [r, g, b] or [r, g, b, a]
 */
function lerpColor(a, b, t) {
  return a.map((v, i) => lerp(v, b[i] ?? v, t));
}

/**
 * Convert [r, g, b] to hex string
 */
function toHex(rgb) {
  return '#' + rgb.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Convert [r, g, b, a] to rgba string
 */
function toRgba(rgba) {
  const [r, g, b, a = 1] = rgba;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/**
 * Given a phase (0.0-3.0), compute interpolated CSS custom properties.
 * Returns an object of { '--var-name': 'value' } pairs.
 */
export function computeThemeVars(phase) {
  // Clamp phase
  const p = Math.max(1, Math.min(3, phase));

  // Determine which two palettes to interpolate between
  let fromPhase, toPhase, t;
  if (p <= 2) {
    fromPhase = 1;
    toPhase = 2;
    t = p - 1; // 0 to 1
  } else {
    fromPhase = 2;
    toPhase = 3;
    t = p - 2; // 0 to 1
  }

  const from = PALETTES[fromPhase];
  const to = PALETTES[toPhase];

  const vars = {};

  // Interpolate each color variable
  const colorMap = {
    '--bg-deepest': 'bgDeepest',
    '--bg-dark': 'bgDark',
    '--bg-surface': 'bgSurface',
    '--bg-elevated': 'bgElevated',
    '--bg-card': 'bgCard',
    '--bg-card-hover': 'bgCardHover',
    '--color-gold': 'colorGold',
    '--color-gold-bright': 'colorGoldBright',
    '--color-gold-dim': 'colorGoldDim',
    '--color-accent': 'colorAccent',
    '--border-color': 'borderColor',
    '--border-color-light': 'borderColorLight',
    '--text-primary': 'textPrimary',
    '--text-secondary': 'textSecondary',
    '--text-muted': 'textMuted',
    '--text-bright': 'textBright'
  };

  for (const [cssVar, key] of Object.entries(colorMap)) {
    const interpolated = lerpColor(from[key], to[key], t);
    vars[cssVar] = toHex(interpolated);
  }

  // Shadow glow (has alpha)
  const glowColor = lerpColor(from.shadowGlow, to.shadowGlow, t);
  vars['--shadow-glow'] = `0 0 20px ${toRgba(glowColor)}`;

  return vars;
}

/**
 * Apply computed theme variables to the document root
 */
export function applyTheme(phase) {
  const vars = computeThemeVars(phase);
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
}
