// Magnitude engine — the feed-agnostic core of Perioteca.
//
// Every adapter maps its raw severity signal (Richter magnitude, GDACS alert
// level, burned acres, wind speed…) onto one shared 0–10 magnitude scale.
// The engine owns: the scale, the user-facing tiers, log-space anchoring for
// heavy-tailed quantities, and the Omori-inspired temporal decay used by the
// map to fade aging events. Feeds are adapters; this module never imports one.

// Tier labels are user-facing (Spanish UI), hence the Spanish values.
export const TIERS = ['pequeño', 'mediano', 'grande', 'gigante'];

const TIER_BOUNDS = [3, 5, 7]; // [0,3) [3,5) [5,7) [7,∞)

/** Map a 0–10 magnitude to its user-facing tier. */
export function tierFor(magnitude) {
  const m = Number(magnitude);
  if (m < TIER_BOUNDS[0]) return TIERS[0];
  if (m < TIER_BOUNDS[1]) return TIERS[1];
  if (m < TIER_BOUNDS[2]) return TIERS[2];
  return TIERS[3];
}

/** Clamp any magnitude into the engine's [0, 10] scale. */
export function clampMagnitude(m, lo = 0, hi = 10) {
  return Math.min(hi, Math.max(lo, Number(m)));
}

/**
 * Log-space linear interpolation between two anchors:
 * value v0 maps to magnitude m0, v1 to m1, clamped to the anchor band.
 * Right tool for heavy-tailed quantities (acres burned, people affected)
 * where a 10x jump in the raw value should read as one step up in scale.
 */
export function logScale(value, { v0, m0, v1, m1 }) {
  const lo = Math.min(m0, m1);
  const hi = Math.max(m0, m1);
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return m0;
  const t = (Math.log10(v) - Math.log10(v0)) / (Math.log10(v1) - Math.log10(v0));
  return Math.min(hi, Math.max(lo, m0 + (m1 - m0) * t));
}

// Alert levels carry an expert-computed impact estimate (GDACS green/orange/
// red, CAP-style yellow); each level anchors a tier band, with alertscore
// refining position inside it. Each level's cap keeps it from leaking into
// the band above (green/yellow stay "mediano", orange "grande", red
// "gigante").
const ALERT_BASE = { green: 3.2, yellow: 3.9, orange: 5.2, red: 7.2 };
const ALERT_CAP = { green: 4.5, yellow: 4.9, orange: 6.9, red: 10 };
const ALERT_SCORE_STEP = 0.4;
const ALERT_SCORE_MAX = 4;

/** Magnitude for an alert-graded event (green/yellow/orange/red + score). */
export function alertMagnitude(alertlevel, alertscore = 0) {
  const level = String(alertlevel || '').toLowerCase();
  const base = ALERT_BASE[level];
  if (base === undefined) return 2.5;
  const score = Math.min(ALERT_SCORE_MAX, Math.max(0, Number(alertscore) || 0));
  return clampMagnitude(Math.min(ALERT_CAP[level], base + score * ALERT_SCORE_STEP));
}

/**
 * Sustained-wind magnitude: 30 kt depression ≈ 2.5, 65 kt cat-1 ≈ 4.25,
 * 140 kt cat-5 = 8. Shared by every feed that reports winds in knots.
 */
export function windMagnitude(kts) {
  return clampMagnitude(1 + Number(kts) / 20, 2, 9);
}

/**
 * Omori-inspired decay weight in [0, 1] for an event `ageHours` old:
 * w = (1 + age/c)^-p — sharp initial drop, long tail, like aftershock rates
 * and like media coverage of a big story. Used for point opacity/size fade.
 */
export function decayWeight(ageHours, { c = 6, p = 1.1 } = {}) {
  const h = Number(ageHours);
  if (!Number.isFinite(h) || h <= 0) return 1;
  return (1 + h / c) ** -p;
}
