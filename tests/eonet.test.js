import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeEonet, EONET_URL } from '../lib/eonet.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'eonet-open.json'), 'utf-8'));

test('normalizeEonet converts the real open-events feed', () => {
  const events = normalizeEonet(feed);
  assert.ok(events.length > 300, `expected a rich feed, got ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'eonet');
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.magnitude >= 0 && e.magnitude <= 10);
    assert.ok(TIERS.includes(e.tier));
    assert.ok(!Number.isNaN(Date.parse(e.time)));
    assert.ok(e.kind, 'kind expected');
  }
});

test('normalizeEonet maps a synthetic wildfire exactly (log-scaled acres)', () => {
  const geojson = {
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'EONET_23656',
          title: 'Wildfire Ruggs, Morrow, Oregon',
          link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_23656/geojson',
          date: '2026-08-31T15:38:00Z',
          magnitudeValue: 10000,
          magnitudeUnit: 'acres',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
          sources: [{ id: 'IRWIN', url: 'https://irwin.doi.gov/x' }]
        },
        geometry: { type: 'Point', coordinates: [-119.69, 45.25] }
      }
    ]
  };
  const [e] = normalizeEonet(geojson);
  assert.equal(e.id, 'eonet-EONET_23656');
  assert.equal(e.kind, 'wildfire');
  assert.equal(e.time, '2026-08-31T15:38:00.000Z');
  assert.equal(e.lat, 45.25);
  assert.equal(e.lon, -119.69);
  // 10^4 acres sits halfway between the 100 -> 2.5 and 1e6 -> 6.5 anchors.
  assert.equal(e.magnitude, 4.5);
  assert.equal(e.tier, 'mediano');
  assert.equal(e.url, 'https://irwin.doi.gov/x'); // prefer the human source url
  assert.deepEqual(e.severity, { value: 10000, unit: 'acres', text: '10000 acres' });
});

test('normalizeEonet scales storm winds in knots and follows a LineString track', () => {
  const geojson = {
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'EONET_X',
          title: 'Hurricane Test',
          link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_X/geojson',
          date: '2026-09-01T00:00:00Z',
          magnitudeValue: 140,
          magnitudeUnit: 'kts',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          sources: []
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-40, 15],
            [-42, 16],
            [-45.5, 18.2]
          ]
        }
      }
    ]
  };
  const [e] = normalizeEonet(geojson);
  assert.equal(e.kind, 'storm');
  // The last track point is the current position.
  assert.equal(e.lat, 18.2);
  assert.equal(e.lon, -45.5);
  // 1 + kts/20 -> 140 kts = 8 (gigante).
  assert.equal(e.magnitude, 8);
  assert.equal(e.tier, 'gigante');
});

test('normalizeEonet gives unmeasured events a small default magnitude', () => {
  const geojson = {
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'EONET_Y',
          title: 'Iceberg A23a',
          link: 'https://eonet.gsfc.nasa.gov/x',
          date: '2026-09-01T00:00:00Z',
          magnitudeValue: null,
          magnitudeUnit: null,
          categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
          sources: []
        },
        geometry: { type: 'Point', coordinates: [-38, -55] }
      }
    ]
  };
  const [e] = normalizeEonet(geojson);
  assert.equal(e.kind, 'ice');
  assert.equal(e.magnitude, 2.5);
  assert.equal(e.tier, 'pequeño');
  assert.equal(e.severity, null);
});

test('normalizeEonet tolerates malformed input', () => {
  assert.deepEqual(normalizeEonet(null), []);
  assert.deepEqual(normalizeEonet({}), []);
});

test('EONET_URL requests open events of the last 30 days', () => {
  assert.equal(EONET_URL, 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30');
});
