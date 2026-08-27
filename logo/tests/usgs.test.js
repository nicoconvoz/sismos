import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeUsgs, usgsYearQueryUrl } from '../lib/usgs.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'usgs-all-day.json'), 'utf-8'));

test('normalizeUsgs converts the real all_day feed', () => {
  const quakes = normalizeUsgs(feed);
  assert.ok(quakes.length > 50, `expected a rich feed, got ${quakes.length}`);
  assert.ok(quakes.length <= feed.features.length);
  for (const q of quakes) {
    assert.equal(q.source, 'usgs');
    assert.equal(q.exactCoords, true);
    assert.ok(Number.isFinite(q.lat) && Number.isFinite(q.lon));
    assert.ok(Number.isFinite(q.magnitude));
    assert.ok(!Number.isNaN(Date.parse(q.time)));
  }
  // Sorted newest first.
  for (let i = 1; i < quakes.length; i++) {
    assert.ok(Date.parse(quakes[i - 1].time) >= Date.parse(quakes[i].time));
  }
});

test('normalizeUsgs maps a synthetic feature exactly', () => {
  const geojson = {
    features: [
      {
        id: 'us123',
        properties: {
          mag: 6.1,
          place: '10 km S of Somewhere, Chile',
          time: 1787755694000,
          url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us123'
        },
        geometry: { coordinates: [-71.6, -33.0, 45.3] }
      }
    ]
  };
  const [q] = normalizeUsgs(geojson, { damaging: true });
  assert.equal(q.id, 'us123');
  assert.equal(q.magnitude, 6.1);
  assert.equal(q.lat, -33);
  assert.equal(q.lon, -71.6);
  assert.equal(q.depthKm, 45.3);
  assert.equal(q.time, new Date(1787755694000).toISOString());
  assert.equal(q.damaging, true);
  assert.equal(q.country, 'Chile');
  assert.equal(q.continent, 'América del Sur');
});

test('normalizeUsgs skips features without magnitude or coordinates', () => {
  const geojson = {
    features: [
      { id: 'a', properties: { mag: null, time: 1 }, geometry: { coordinates: [0, 0, 0] } },
      { id: 'b', properties: { mag: 2, time: 1 }, geometry: null },
      { id: 'c', properties: { mag: 2, time: 1787755694000 }, geometry: { coordinates: [1, 2, 3] } }
    ]
  };
  const quakes = normalizeUsgs(geojson);
  assert.deepEqual(quakes.map((q) => q.id), ['c']);
});

test('normalizeUsgs tolerates malformed input', () => {
  assert.deepEqual(normalizeUsgs(null), []);
  assert.deepEqual(normalizeUsgs({}), []);
});

test('usgsYearQueryUrl builds the FDSN yearly query', () => {
  assert.equal(
    usgsYearQueryUrl(2026),
    'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-01-01&minmagnitude=6&orderby=time'
  );
});
