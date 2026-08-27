import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeQuake,
  inferContinent,
  extractCountry,
  filterByTimeWindow,
  sortByTimeDesc,
  dedupeById,
  haversineKm,
  mergeQuakes,
  localTimeToUtc
} from '../lib/normalize.js';

test('makeQuake normalizes types and derives fields', () => {
  const q = makeQuake({
    id: 123,
    time: '2026-08-26T12:00:00Z',
    magnitude: '5.5',
    depthKm: '33',
    place: 'Offshore Valparaiso, Chile',
    lat: '-33.0',
    lon: '-71.6',
    exactCoords: true,
    source: 'usgs',
    url: 'https://example.org/q/123'
  });
  assert.equal(q.id, '123');
  assert.equal(q.time, '2026-08-26T12:00:00.000Z');
  assert.equal(q.magnitude, 5.5);
  assert.equal(q.depthKm, 33);
  assert.equal(q.lat, -33);
  assert.equal(q.lon, -71.6);
  assert.equal(q.country, 'Chile');
  assert.equal(q.continent, 'América del Sur');
  assert.ok(!('damaging' in q), 'damaging omitted unless provided');
});

test('makeQuake returns null on missing mandatory fields', () => {
  assert.equal(makeQuake({ id: 1, time: null, magnitude: 5, lat: 0, lon: 0 }), null);
  assert.equal(makeQuake({ id: 1, time: '2026-01-01', magnitude: 'x', lat: 0, lon: 0 }), null);
  assert.equal(makeQuake({ id: 1, time: '2026-01-01', magnitude: 5, lat: 'n/a', lon: 0 }), null);
  assert.equal(makeQuake({ id: 1, time: 'not-a-date', magnitude: 5, lat: 0, lon: 0 }), null);
});

test('inferContinent maps known locations to continents', () => {
  const cases = [
    [40.4, -3.7, 'Europa'], // Madrid
    [64.1, -21.9, 'Europa'], // Reykjavik
    [35.6, 139.7, 'Asia'], // Tokyo
    [-8.28, 121.55, 'Asia'], // Flores Sea, Indonesia
    [28.6, 77.2, 'Asia'], // Delhi
    [30.0, 31.2, 'África'], // Cairo
    [-1.3, 36.8, 'África'], // Nairobi
    [34.0, -118.2, 'América del Norte'], // Los Angeles
    [19.4, -99.1, 'América del Norte'], // Mexico City
    [-33.4, -70.6, 'América del Sur'], // Santiago
    [4.8, -76.2, 'América del Sur'], // Choco, Colombia
    [-33.8, 151.2, 'Oceanía'], // Sydney
    [-41.3, 174.8, 'Oceanía'], // Wellington
    [19.9, -155.5, 'Oceanía'], // Hawaii
    [-77.8, 166.7, 'Antártida'] // McMurdo
  ];
  for (const [lat, lon, expected] of cases) {
    assert.equal(inferContinent(lat, lon), expected, `(${lat}, ${lon})`);
  }
});

test('extractCountry takes the last comma-separated token', () => {
  assert.equal(extractCountry('Flores Sea, 64 km al norte de Ende, Indonesia'), 'Indonesia');
  assert.equal(extractCountry('Chile'), 'Chile');
  assert.equal(extractCountry(''), null);
  assert.equal(extractCountry('Off coast, Chile (mar)'), 'Chile');
});

test('filterByTimeWindow keeps only quakes inside the window', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const mk = (iso) => ({ time: iso });
  const quakes = [
    mk('2026-08-26T11:30:00Z'), // 30 min ago -> in 1h
    mk('2026-08-26T09:00:00Z'), // 3 h ago -> in 3h
    mk('2026-08-26T01:00:00Z'), // 11 h ago -> in 12h
    mk('2026-08-25T11:00:00Z'), // 25 h ago -> outside 24h
    mk('invalid')
  ];
  assert.equal(filterByTimeWindow(quakes, 1, now).length, 1);
  assert.equal(filterByTimeWindow(quakes, 3, now).length, 2);
  assert.equal(filterByTimeWindow(quakes, 12, now).length, 3);
  assert.equal(filterByTimeWindow(quakes, 24, now).length, 3);
});

test('haversineKm computes great-circle distances', () => {
  assert.equal(haversineKm(0, 0, 0, 0), 0);
  // Madrid -> Barcelona is ~505 km.
  const d = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
  assert.ok(d > 480 && d < 530, `got ${d}`);
});

test('mergeQuakes removes duplicates within 90 s and 100 km', () => {
  const t = '2026-08-26T12:00:00Z';
  const primary = [{ id: 'p1', time: t, lat: -20, lon: -70, magnitude: 5 }];
  const dupExact = { id: 's1', time: t, lat: -20, lon: -70, magnitude: 5.1 };
  const dupNear = { id: 's2', time: '2026-08-26T12:01:00Z', lat: -20.3, lon: -70.2, magnitude: 4.9 };
  const merged = mergeQuakes(primary, [dupExact, dupNear]);
  assert.deepEqual(merged.map((q) => q.id), ['p1']);
});

test('mergeQuakes keeps nearby-but-different-time and same-time-far-away quakes', () => {
  const t = '2026-08-26T12:00:00Z';
  const primary = [{ id: 'p1', time: t, lat: -20, lon: -70, magnitude: 5 }];
  const sameSpotLater = { id: 's1', time: '2026-08-26T12:10:00Z', lat: -20, lon: -70, magnitude: 4 };
  const sameTimeFar = { id: 's2', time: t, lat: 35, lon: 139, magnitude: 4 };
  const merged = mergeQuakes(primary, [sameSpotLater, sameTimeFar]);
  assert.deepEqual(merged.map((q) => q.id).sort(), ['p1', 's1', 's2']);
});

test('mergeQuakes accepts a custom time tolerance for cross-agency merges', () => {
  const primary = [{ id: 'local', time: '2026-08-27T12:00:00Z', lat: -33, lon: -70, magnitude: 4 }];
  // 110 s apart, 30 km away: duplicate only with the widened 120 s window.
  const secondary = [{ id: 'global', time: '2026-08-27T12:01:50Z', lat: -33.2, lon: -70.2, magnitude: 4.1 }];
  assert.deepEqual(mergeQuakes(primary, secondary).map((q) => q.id), ['local', 'global']);
  assert.deepEqual(
    mergeQuakes(primary, secondary, { maxDtMs: 120000 }).map((q) => q.id),
    ['local']
  );
});

test('localTimeToUtc converts zone-local wall time to UTC across DST', () => {
  // Argentina: fixed UTC-3, no DST.
  assert.equal(
    localTimeToUtc({ year: 2026, month: 8, day: 27, hour: 9, minute: 38, second: 0 }, 'America/Argentina/Buenos_Aires').toISOString(),
    '2026-08-27T12:38:00.000Z'
  );
  // Chile winter: UTC-4 (verified against the official CSN informe UTC time).
  assert.equal(
    localTimeToUtc({ year: 2026, month: 8, day: 27, hour: 8, minute: 59, second: 15 }, 'America/Santiago').toISOString(),
    '2026-08-27T12:59:15.000Z'
  );
  // Chile summer (DST): UTC-3.
  assert.equal(
    localTimeToUtc({ year: 2026, month: 1, day: 15, hour: 8, minute: 0, second: 0 }, 'America/Santiago').toISOString(),
    '2026-01-15T11:00:00.000Z'
  );
});

test('mergeQuakes handles empty lists', () => {
  const a = [{ id: 'a', time: '2026-08-26T12:00:00Z', lat: 0, lon: 0, magnitude: 1 }];
  assert.deepEqual(mergeQuakes([], []), []);
  assert.deepEqual(mergeQuakes(a, []).map((q) => q.id), ['a']);
  assert.deepEqual(mergeQuakes([], a).map((q) => q.id), ['a']);
});

test('sortByTimeDesc and dedupeById helpers', () => {
  const a = { id: 'a', time: '2026-08-26T01:00:00Z' };
  const b = { id: 'b', time: '2026-08-26T02:00:00Z' };
  const sorted = sortByTimeDesc([a, b]);
  assert.deepEqual(sorted.map((q) => q.id), ['b', 'a']);
  assert.deepEqual(dedupeById([a, a, b]).map((q) => q.id), ['a', 'b']);
});
