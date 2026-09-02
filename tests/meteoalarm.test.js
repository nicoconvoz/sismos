import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMeteoalarm, maKindOf, MA_COUNTRIES, meteoalarmFeedUrl } from '../lib/meteoalarm.js';
import { TIERS } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'meteoalarm-france.json'), 'utf-8'));

test('parseMeteoalarm converts the real France feed (one event per region)', () => {
  // Evaluate as of the fixture's own day so warnings are not all expired.
  const now = Date.parse('2026-09-02T05:00:00Z');
  const events = parseMeteoalarm(feed, now);
  // Most fixture warnings are green (Météo-France maps its "jaune" to
  // MeteoAlarm level green) or already expired; the real yellow+ ones stay.
  assert.ok(events.length >= 2, `expected regional events, got ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'meteoalarm');
    assert.ok(e.id.startsWith('ma-'));
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    // France spans roughly 41..51 N, -5..10 E — centroids must be real.
    assert.ok(e.lat > 40 && e.lat < 52, `lat ${e.lat}`);
    assert.ok(e.lon > -6 && e.lon < 11, `lon ${e.lon}`);
    assert.equal(e.cc, 'FR');
    assert.ok(TIERS.includes(e.tier));
    // Green/Minor routine notices are skipped: only yellow and up remain.
    assert.ok(['yellow', 'orange', 'red'].includes(e.alert), e.alert);
    assert.ok(e.area, 'official region name expected');
    assert.ok(!Number.isNaN(Date.parse(e.time)));
  }
});

test('parseMeteoalarm keeps the validity window and details', () => {
  const now = Date.parse('2026-09-02T05:00:00Z');
  const events = parseMeteoalarm(feed, now);
  const withWindow = events.filter((e) => e.starts && e.ends);
  assert.ok(withWindow.length > 0, 'warnings carry onset/expiry');
  const withDetails = events.filter((e) => e.details);
  assert.ok(withDetails.length > 0, 'descriptions become details');
});

test('parseMeteoalarm maps a synthetic warning exactly', () => {
  const feed = {
    warnings: [
      {
        alert: {
          identifier: 'test.1',
          info: [
            {
              language: 'fr-FR',
              event: 'Vigilance orange canicule',
              severity: 'Severe',
              onset: '2026-09-02T22:00:00+00:00',
              expires: '2026-09-03T22:00:00+00:00',
              description: 'Chaleur intense attendue.',
              parameter: [
                { valueName: 'awareness_level', value: '3; orange; Severe' },
                { valueName: 'awareness_type', value: '5; high-temperature' }
              ],
              area: [
                { areaDesc: 'Hérault', geocode: [{ valueName: 'NUTS3', value: 'FR813' }] }
              ]
            }
          ]
        }
      }
    ]
  };
  const [e] = parseMeteoalarm(feed, Date.parse('2026-09-02T05:00:00Z'));
  assert.equal(e.id, 'ma-test.1-FR813');
  assert.equal(e.kind, 'heat');
  assert.equal(e.alert, 'orange');
  assert.equal(e.tier, 'grande');
  assert.equal(e.area, 'Hérault');
  assert.equal(e.cc, 'FR');
  // Hérault centroid from the NUTS table (editions differ by ~1 km).
  assert.ok(Math.abs(e.lat - 43.6) < 0.05, `lat ${e.lat}`);
  assert.ok(Math.abs(e.lon - 3.36) < 0.05, `lon ${e.lon}`);
  assert.equal(e.details, 'Chaleur intense attendue.');
  assert.equal(e.starts, new Date('2026-09-02T22:00:00Z').toISOString());
});

test('parseMeteoalarm drops expired warnings and tolerates malformed input', () => {
  assert.deepEqual(parseMeteoalarm(feed, Date.parse('2027-06-01T00:00:00Z')), []);
  assert.deepEqual(parseMeteoalarm(null, Date.now()), []);
  assert.deepEqual(parseMeteoalarm({}, Date.now()), []);
});

test('maKindOf maps awareness types to kinds', () => {
  assert.equal(maKindOf('1; Wind'), 'wind');
  assert.equal(maKindOf('2; snow-ice'), 'snow');
  assert.equal(maKindOf('3; Thunderstorm'), 'storm');
  assert.equal(maKindOf('4; fog'), 'fog');
  assert.equal(maKindOf('5; high-temperature'), 'heat');
  assert.equal(maKindOf('6; low-temperature'), 'cold');
  assert.equal(maKindOf('8; forest-fire'), 'wildfire');
  assert.equal(maKindOf('9; avalanches'), 'avalanche');
  assert.equal(maKindOf('10; Rain'), 'storm');
  assert.equal(maKindOf('12; flooding'), 'flood');
  assert.equal(maKindOf('13; rain-flood'), 'flood');
  assert.equal(maKindOf(null), 'storm');
});

test('country list and feed urls are well-formed', () => {
  assert.ok(MA_COUNTRIES.length >= 30);
  assert.ok(MA_COUNTRIES.includes('spain') && MA_COUNTRIES.includes('germany'));
  assert.equal(
    meteoalarmFeedUrl('france'),
    'https://feeds.meteoalarm.org/api/v1/warnings/feeds-france'
  );
});
