import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeUsgs, USGS_ALL_DAY_URL } from '../lib/usgs.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'usgs-all-day.json'), 'utf-8'));

test('normalizeUsgs converts the real all_day feed into events', () => {
  const events = normalizeUsgs(feed);
  assert.ok(events.length > 50, `expected a rich feed, got ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'usgs');
    assert.equal(e.kind, 'earthquake');
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.magnitude >= 0 && e.magnitude <= 10);
    assert.ok(TIERS.includes(e.tier));
    assert.ok(!Number.isNaN(Date.parse(e.time)));
  }
});

test('normalizeUsgs maps a synthetic quake exactly', () => {
  const geojson = {
    features: [
      {
        id: 'us123',
        properties: {
          mag: 6.1,
          place: '10 km S of Somewhere, Chile',
          time: 1787755694000,
          url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us123',
          alert: 'orange'
        },
        geometry: { coordinates: [-71.6, -33.0, 45.3] }
      }
    ]
  };
  const [e] = normalizeUsgs(geojson);
  assert.equal(e.id, 'usgs-us123');
  assert.equal(e.kind, 'earthquake');
  assert.equal(e.magnitude, 6.1);
  assert.equal(e.tier, 'grande');
  assert.equal(e.lat, -33);
  assert.equal(e.lon, -71.6);
  assert.equal(e.time, new Date(1787755694000).toISOString());
  assert.equal(e.country, 'Chile');
  assert.equal(e.continent, 'América del Sur');
  assert.equal(e.alert, 'orange'); // USGS PAGER alert passes through
  assert.deepEqual(e.severity, { value: 6.1, unit: 'M', text: 'M 6.1, 45.3 km deep' });
});

test('normalizeUsgs clamps negative micro-quake magnitudes to 0', () => {
  const geojson = {
    features: [
      {
        id: 'tiny',
        properties: { mag: -0.3, place: 'Nevada', time: 1787755694000, url: null },
        geometry: { coordinates: [-116, 38, 2] }
      }
    ]
  };
  const [e] = normalizeUsgs(geojson);
  assert.equal(e.magnitude, 0);
  assert.equal(e.tier, 'pequeño');
});

test('normalizeUsgs skips features without magnitude or coordinates', () => {
  const geojson = {
    features: [
      { id: 'a', properties: { mag: null, time: 1 }, geometry: { coordinates: [0, 0, 0] } },
      { id: 'b', properties: { mag: 2, time: 1 }, geometry: null },
      { id: 'c', properties: { mag: 2, time: 1787755694000 }, geometry: { coordinates: [1, 2, 3] } }
    ]
  };
  assert.deepEqual(normalizeUsgs(geojson).map((e) => e.id), ['usgs-c']);
});

test('normalizeUsgs tolerates malformed input', () => {
  assert.deepEqual(normalizeUsgs(null), []);
  assert.deepEqual(normalizeUsgs({}), []);
});

test('USGS_ALL_DAY_URL points at the official 24h summary feed', () => {
  assert.equal(
    USGS_ALL_DAY_URL,
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
  );
});
