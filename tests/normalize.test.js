import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEvent,
  inferContinent,
  filterByTimeWindow,
  sortByTimeDesc,
  haversineKm,
  mergeEvents,
  dedupeById
} from '../lib/normalize.js';

const base = {
  id: 'x1',
  time: '2026-09-01T12:00:00Z',
  title: 'Test event',
  kind: 'wildfire',
  lat: -33,
  lon: -71.6,
  country: 'Chile',
  source: 'gdacs',
  url: 'https://example.org/e/x1',
  magnitude: 4.2
};

test('makeEvent builds the normalized shape and derives continent + tier', () => {
  const e = makeEvent(base);
  assert.equal(e.id, 'x1');
  assert.equal(e.time, '2026-09-01T12:00:00.000Z');
  assert.equal(e.updated, e.time); // defaults to time
  assert.equal(e.kind, 'wildfire');
  assert.equal(e.magnitude, 4.2);
  assert.equal(e.tier, 'mediano');
  assert.equal(e.continent, 'América del Sur');
  assert.equal(e.country, 'Chile');
  assert.equal(e.alert, null);
  assert.equal(e.severity, null);
});

test('makeEvent clamps magnitude into [0, 10]', () => {
  assert.equal(makeEvent({ ...base, magnitude: -0.4 }).magnitude, 0);
  assert.equal(makeEvent({ ...base, magnitude: 12 }).magnitude, 10);
});

test('makeEvent returns null when mandatory fields are missing or invalid', () => {
  assert.equal(makeEvent({ ...base, id: null }), null);
  assert.equal(makeEvent({ ...base, time: 'not-a-date' }), null);
  assert.equal(makeEvent({ ...base, lat: null }), null);
  assert.equal(makeEvent({ ...base, lon: '' }), null);
  assert.equal(makeEvent({ ...base, magnitude: null }), null);
  assert.equal(makeEvent({ ...base, kind: '' }), null);
});

test('makeEvent normalizes alert to lowercase and keeps severity as given', () => {
  const e = makeEvent({
    ...base,
    alert: 'Red',
    severity: { value: 5.6, unit: 'M', text: 'Magnitude 5.6M' }
  });
  assert.equal(e.alert, 'red');
  assert.deepEqual(e.severity, { value: 5.6, unit: 'M', text: 'Magnitude 5.6M' });
});

test('inferContinent places well-known coordinates', () => {
  assert.equal(inferContinent(-33.45, -70.66), 'América del Sur'); // Santiago
  assert.equal(inferContinent(40.7, -74.0), 'América del Norte'); // New York
  assert.equal(inferContinent(48.85, 2.35), 'Europa'); // Paris
  assert.equal(inferContinent(35.68, 139.69), 'Asia'); // Tokyo
  assert.equal(inferContinent(-33.87, 151.2), 'Oceanía'); // Sydney
  assert.equal(inferContinent(9.05, 7.49), 'África'); // Abuja
  assert.equal(inferContinent(-77.8, 166.6), 'Antártida'); // McMurdo
});

test('filterByTimeWindow keeps only events inside the window', () => {
  const now = Date.parse('2026-09-02T00:00:00Z');
  const mk = (id, iso) => makeEvent({ ...base, id, time: iso });
  const events = [
    mk('old', '2026-08-25T00:00:00Z'),
    mk('recent', '2026-09-01T22:00:00Z'),
    mk('edge', '2026-09-01T00:00:00Z')
  ];
  const kept = filterByTimeWindow(events, 24, now);
  assert.deepEqual(kept.map((e) => e.id).sort(), ['edge', 'recent']);
});

test('sortByTimeDesc sorts newest first without mutating input', () => {
  const a = makeEvent({ ...base, id: 'a', time: '2026-09-01T01:00:00Z' });
  const b = makeEvent({ ...base, id: 'b', time: '2026-09-01T02:00:00Z' });
  const input = [a, b];
  const sorted = sortByTimeDesc(input);
  assert.deepEqual(sorted.map((e) => e.id), ['b', 'a']);
  assert.deepEqual(input.map((e) => e.id), ['a', 'b']);
});

test('haversineKm measures real-world distances', () => {
  // Santiago -> Buenos Aires ≈ 1140 km.
  const d = haversineKm(-33.45, -70.66, -34.6, -58.38);
  assert.ok(d > 1100 && d < 1180, `got ${d}`);
  assert.equal(haversineKm(10, 20, 10, 20), 0);
});

test('mergeEvents drops same-family duplicates close in time and space', () => {
  const gdacsCyclone = makeEvent({
    ...base,
    id: 'gdacs-tc',
    kind: 'cyclone',
    lat: 18.3,
    lon: -130.8,
    time: '2026-09-01T12:00:00Z',
    source: 'gdacs'
  });
  const eonetStorm = makeEvent({
    ...base,
    id: 'eonet-storm',
    kind: 'storm',
    lat: 18.6,
    lon: -130.5,
    time: '2026-09-01T09:00:00Z',
    source: 'eonet'
  });
  // cyclone and storm belong to the same family -> deduped.
  const merged = mergeEvents([gdacsCyclone], [eonetStorm]);
  assert.deepEqual(merged.map((e) => e.id), ['gdacs-tc']);
});

test('mergeEvents keeps different families even when close', () => {
  const quake = makeEvent({ ...base, id: 'q', kind: 'earthquake' });
  const fire = makeEvent({ ...base, id: 'f', kind: 'wildfire' });
  const merged = mergeEvents([quake], [fire]);
  assert.deepEqual(merged.map((e) => e.id).sort(), ['f', 'q']);
});

test('mergeEvents keeps same-family events far apart or distant in time', () => {
  const a = makeEvent({ ...base, id: 'a', kind: 'wildfire', lat: -33, lon: -71 });
  const far = makeEvent({ ...base, id: 'far', kind: 'wildfire', lat: -20, lon: -60 });
  const later = makeEvent({
    ...base,
    id: 'later',
    kind: 'wildfire',
    lat: -33.1,
    lon: -71.1,
    time: '2026-09-08T12:00:00Z'
  });
  const merged = mergeEvents([a], [far, later]);
  assert.deepEqual(merged.map((e) => e.id).sort(), ['a', 'far', 'later']);
});

test('mergeEvents dedupes named storms by name across any time gap', () => {
  // GDACS dates a cyclone at its START; NHC at its latest advisory — the
  // same storm can differ by days and hundreds of km between agencies, but
  // both carry its proper name.
  const gdacs = makeEvent({
    ...base,
    id: 'gdacs-TC-1',
    kind: 'cyclone',
    lat: 15,
    lon: -120,
    time: '2026-08-28T00:00:00Z'
  });
  gdacs.eventName = 'KARINA-26';
  const nhc = makeEvent({
    ...base,
    id: 'nhc-ep1',
    kind: 'cyclone',
    lat: 19,
    lon: -131,
    time: '2026-09-02T03:00:00Z'
  });
  nhc.eventName = 'Karina';
  const other = makeEvent({
    ...base,
    id: 'nhc-ep2',
    kind: 'cyclone',
    lat: 14,
    lon: -115,
    time: '2026-09-02T03:00:00Z'
  });
  other.eventName = 'Lowell';
  const merged = mergeEvents([gdacs], [nhc, other]);
  assert.deepEqual(merged.map((e) => e.id).sort(), ['gdacs-TC-1', 'nhc-ep2']);
});

test('mergeEvents honors a custom time window (tight EQ dedupe)', () => {
  const a = makeEvent({ ...base, id: 'a', kind: 'earthquake', time: '2026-09-01T12:00:00Z' });
  const b = makeEvent({ ...base, id: 'b', kind: 'earthquake', time: '2026-09-01T12:01:00Z' });
  // Within 90 s -> duplicate; with a 30 s window -> distinct.
  assert.deepEqual(mergeEvents([a], [b], { maxDtMs: 90e3 }).map((e) => e.id), ['a']);
  assert.deepEqual(
    mergeEvents([a], [b], { maxDtMs: 30e3 }).map((e) => e.id).sort(),
    ['a', 'b']
  );
});

test('dedupeById keeps the first occurrence', () => {
  const a = makeEvent({ ...base, id: 'dup', source: 'gdacs' });
  const b = makeEvent({ ...base, id: 'dup', source: 'eonet' });
  const out = dedupeById([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'gdacs');
});
