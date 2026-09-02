import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSwic, swicKindOf, SWIC_URL } from '../lib/swic.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'swic-latam.json'), 'utf-8'));

// The fixture's warnings expire Sep 2; evaluate before that.
const NOW = Date.parse('2026-09-02T05:00:00Z');

test('parseSwic converts the real Latin America WFS feed', () => {
  // No skip list, so the fixture's Argentina warnings validate the parser.
  const events = parseSwic(feed, NOW, { skip: [] });
  assert.ok(events.length >= 10, `expected warnings, got ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'swic');
    assert.ok(e.id.startsWith('swic-'));
    assert.equal(e.cc, 'AR');
    // Polygon centroids must land in Argentina, roughly.
    assert.ok(e.lat < -20 && e.lat > -56, `lat ${e.lat}`);
    assert.ok(e.lon < -50 && e.lon > -77, `lon ${e.lon}`);
    assert.ok(TIERS.includes(e.tier));
    assert.ok(['yellow', 'orange', 'red'].includes(e.alert));
    assert.ok(!Number.isNaN(Date.parse(e.time)));
    assert.ok(e.starts && e.ends, 'validity window expected');
  }
});

test('parseSwic skips relayed countries covered by native adapters', () => {
  // Default skip: Argentina (the native SMN adapter is richer).
  assert.deepEqual(parseSwic(feed, NOW), []);
});

test('parseSwic drops expired warnings and tolerates malformed input', () => {
  assert.deepEqual(parseSwic(feed, Date.parse('2027-01-01T00:00:00Z'), { skip: [] }), []);
  assert.deepEqual(parseSwic(null, NOW), []);
  assert.deepEqual(parseSwic({}, NOW), []);
});

test('swicKindOf maps official event wording to kinds', () => {
  assert.equal(swicKindOf('Typhoon'), 'cyclone');
  assert.equal(swicKindOf('Tropical Cyclone'), 'cyclone');
  assert.equal(swicKindOf('Rainstorm'), 'storm');
  assert.equal(swicKindOf('Thunderstorms'), 'storm');
  assert.equal(swicKindOf('Tormentas'), 'storm');
  assert.equal(swicKindOf('Flood'), 'flood');
  assert.equal(swicKindOf('Flash Flood'), 'flood');
  assert.equal(swicKindOf('gale'), 'wind');
  assert.equal(swicKindOf('Strong Wind'), 'wind');
  assert.equal(swicKindOf('Snowstorm'), 'snow');
  assert.equal(swicKindOf('Heat Wave'), 'heat');
  assert.equal(swicKindOf('Cold Wave'), 'cold');
  assert.equal(swicKindOf('Forest (grassland) fire risk'), 'wildfire');
  assert.equal(swicKindOf('Hail'), 'hail');
  assert.equal(swicKindOf('Fog'), 'fog');
  assert.equal(swicKindOf('??'), 'storm');
});

test('SWIC_URL queries the Latin America bounding box', () => {
  assert.ok(SWIC_URL.includes('severeweather.wmo.int'));
  assert.ok(SWIC_URL.includes('BBOX(wkb_geometry,-120,-60,-25,33)'));
});
