import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS,
  tierFor,
  clampMagnitude,
  logScale,
  alertMagnitude,
  decayWeight
} from '../lib/magnitude.js';

test('TIERS lists the four user-facing tiers in ascending order', () => {
  assert.deepEqual(TIERS, ['pequeño', 'mediano', 'grande', 'gigante']);
});

test('tierFor maps magnitude bands to tiers', () => {
  assert.equal(tierFor(0), 'pequeño');
  assert.equal(tierFor(2.9), 'pequeño');
  assert.equal(tierFor(3), 'mediano');
  assert.equal(tierFor(4.9), 'mediano');
  assert.equal(tierFor(5), 'grande');
  assert.equal(tierFor(6.9), 'grande');
  assert.equal(tierFor(7), 'gigante');
  assert.equal(tierFor(10), 'gigante');
});

test('clampMagnitude keeps values inside [0, 10]', () => {
  assert.equal(clampMagnitude(-1.2), 0);
  assert.equal(clampMagnitude(5.5), 5.5);
  assert.equal(clampMagnitude(14), 10);
});

test('logScale maps a value logarithmically between two anchors', () => {
  const opts = { v0: 100, m0: 2.5, v1: 1e6, m1: 6.5 };
  assert.equal(logScale(100, opts), 2.5);
  assert.equal(logScale(1e6, opts), 6.5);
  assert.equal(logScale(1e4, opts), 4.5); // halfway in log space
  // Clamped outside the anchor range.
  assert.equal(logScale(1, opts), 2.5);
  assert.equal(logScale(1e9, opts), 6.5);
  // Non-positive values collapse to the low anchor.
  assert.equal(logScale(0, opts), 2.5);
  assert.equal(logScale(-5, opts), 2.5);
});

test('alertMagnitude keeps each GDACS alert level inside its tier band', () => {
  // Green events stay "mediano" for any plausible alertscore.
  for (const score of [0, 1, 2, 4, 10]) {
    const m = alertMagnitude('green', score);
    assert.equal(tierFor(m), 'mediano', `green score=${score} -> ${m}`);
  }
  // Orange events stay "grande".
  for (const score of [0, 2, 4, 10]) {
    const m = alertMagnitude('orange', score);
    assert.equal(tierFor(m), 'grande', `orange score=${score} -> ${m}`);
  }
  // Red events stay "gigante" and never exceed 10.
  for (const score of [0, 2, 4, 10]) {
    const m = alertMagnitude('red', score);
    assert.equal(tierFor(m), 'gigante', `red score=${score} -> ${m}`);
    assert.ok(m <= 10);
  }
  // Yellow (CAP Moderate, e.g. SMN) sits above green, still "mediano".
  for (const score of [0, 2, 4, 10]) {
    const m = alertMagnitude('yellow', score);
    assert.equal(tierFor(m), 'mediano', `yellow score=${score} -> ${m}`);
  }
  assert.ok(alertMagnitude('yellow', 0) > alertMagnitude('green', 0));
  // A higher score means a higher magnitude within the band.
  assert.ok(alertMagnitude('orange', 3) > alertMagnitude('orange', 0));
  // Unknown levels fall back to a small default.
  assert.equal(tierFor(alertMagnitude('purple', 3)), 'pequeño');
  assert.equal(tierFor(alertMagnitude(null, 0)), 'pequeño');
});

test('alertMagnitude is case-insensitive (GDACS sends "Green"/"Orange"/"Red")', () => {
  assert.equal(alertMagnitude('Green', 1), alertMagnitude('green', 1));
  assert.equal(alertMagnitude('RED', 0), alertMagnitude('red', 0));
});

test('decayWeight is 1 when fresh and decays monotonically (Omori-like)', () => {
  assert.equal(decayWeight(0), 1);
  assert.equal(decayWeight(-5), 1); // clock skew tolerated
  let prev = 1;
  for (const h of [1, 6, 24, 72, 24 * 7]) {
    const w = decayWeight(h);
    assert.ok(w > 0 && w < prev, `decay at ${h}h: ${w}`);
    prev = w;
  }
});
