import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeEmsc, titleCaseRegion } from '../lib/emsc.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'emsc-24h.json'), 'utf-8'));

test('normalizeEmsc converts the real fixture feed', () => {
  const quakes = normalizeEmsc(feed);
  assert.ok(quakes.length >= 5, `expected >= 5 quakes, got ${quakes.length}`);
  assert.ok(quakes.length <= feed.features.length);
  for (const q of quakes) {
    assert.equal(q.source, 'emsc');
    assert.equal(q.exactCoords, true);
    assert.ok(q.id.startsWith('emsc-'));
    assert.ok(Number.isFinite(q.lat) && q.lat >= -90 && q.lat <= 90);
    assert.ok(Number.isFinite(q.lon) && q.lon >= -180 && q.lon <= 180);
    assert.ok(Number.isFinite(q.magnitude));
    assert.ok(!Number.isNaN(Date.parse(q.time)));
    assert.match(q.url, /^https:\/\/www\.seismicportal\.eu\/eventdetails\.html\?unid=/);
    assert.ok(!/[A-Z]{4,}/.test(q.place), `place should not be shouting: ${q.place}`);
  }
});

test('normalizeEmsc maps a known fixture feature exactly', () => {
  const quakes = normalizeEmsc(feed);
  const q = quakes.find((x) => x.id === 'emsc-20260826_0000220');
  assert.ok(q, 'feature 20260826_0000220 should be normalized');
  assert.equal(q.magnitude, 2);
  assert.equal(q.lat, 38.2307);
  assert.equal(q.lon, 37.7795);
  assert.equal(q.depthKm, 12); // from properties.depth, not geometry z
  assert.equal(q.time, new Date('2026-08-26T16:07:40.1Z').toISOString());
  assert.equal(q.place, 'Central Turkey');
  assert.equal(q.url, 'https://www.seismicportal.eu/eventdetails.html?unid=20260826_0000220');
});

test('normalizeEmsc is null-safe on depth and skips broken features', () => {
  const quakes = normalizeEmsc({
    features: [
      {
        id: 'x1',
        properties: { unid: 'x1', mag: 3.1, time: '2026-08-26T00:00:00Z', flynn_region: 'SPAIN', depth: null },
        geometry: { coordinates: [-3.7, 40.4, 0] }
      },
      { id: 'x2', properties: { unid: 'x2', mag: null, time: '2026-08-26T00:00:00Z' }, geometry: { coordinates: [0, 0, 0] } },
      { id: 'x3', properties: { unid: 'x3', mag: 2, time: '2026-08-26T00:00:00Z' }, geometry: null }
    ]
  });
  assert.equal(quakes.length, 1);
  assert.equal(quakes[0].depthKm, null, 'null depth must stay null, not become 0');
  assert.equal(quakes[0].place, 'Spain');
});

test('normalizeEmsc tolerates malformed input', () => {
  assert.deepEqual(normalizeEmsc(null), []);
  assert.deepEqual(normalizeEmsc({}), []);
});

test('titleCaseRegion converts shouting case for display', () => {
  assert.equal(titleCaseRegion('KEPULAUAN SANGIHE, INDONESIA'), 'Kepulauan Sangihe, Indonesia');
  assert.equal(titleCaseRegion('OFF COAST OF NORTHERN CHILE'), 'Off Coast Of Northern Chile');
  assert.equal(titleCaseRegion(''), '');
});
