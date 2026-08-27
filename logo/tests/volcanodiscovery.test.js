import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHoyQuakes, parseDamagingQuakes, decodeEntities } from '../lib/volcanodiscovery.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const hoyHtml = readFileSync(join(fixtures, 'vd-hoy.html'), 'utf-8');
const damagingHtml = readFileSync(join(fixtures, 'vd-daninos.html'), 'utf-8');

test('parseHoyQuakes extracts the server-rendered last-24h rows', () => {
  const quakes = parseHoyQuakes(hoyHtml);
  assert.ok(quakes.length >= 5, `expected at least 5 quakes, got ${quakes.length}`);
  for (const q of quakes) {
    assert.equal(typeof q.id, 'string');
    assert.equal(typeof q.magnitude, 'number');
    assert.ok(Number.isFinite(q.lat) && q.lat >= -90 && q.lat <= 90);
    assert.ok(Number.isFinite(q.lon) && q.lon >= -180 && q.lon <= 180);
    assert.equal(q.exactCoords, true);
    assert.equal(q.source, 'volcanodiscovery');
    assert.ok(!Number.isNaN(Date.parse(q.time)));
    assert.ok(q.url.includes(q.id));
  }
});

test('parseHoyQuakes extracts known fields of a specific fixture row', () => {
  const quakes = parseHoyQuakes(hoyHtml);
  const q = quakes.find((x) => x.id === '23314258');
  assert.ok(q, 'row quake-23314258 should be parsed');
  assert.equal(q.magnitude, 3.8);
  assert.equal(q.depthKm, 10);
  assert.equal(q.lat, -8.28);
  assert.equal(q.lon, 121.55);
  assert.equal(q.time, '2026-08-26T15:45:16.000Z');
  assert.match(q.place, /Flores Sea/);
  assert.match(q.place, /Indonesia/);
  assert.ok(!/Lo sent/i.test(q.place), 'felt-report link text must be stripped');
  assert.equal(q.country, 'Indonesia');
  assert.equal(q.continent, 'Asia');
});

test('parseHoyQuakes excludes the "largest quakes ever" table', () => {
  const quakes = parseHoyQuakes(hoyHtml);
  // Valdivia 1960 (M9.5) lives in qTableLargest in the fixture.
  assert.ok(!quakes.some((q) => q.id === '2949829'), 'must not include all-time rows');
  assert.ok(!quakes.some((q) => q.magnitude >= 9), 'no historic M9 rows expected');
});

test('parseDamagingQuakes extracts the full damaging list', () => {
  const quakes = parseDamagingQuakes(damagingHtml);
  assert.ok(quakes.length >= 30, `expected at least 30 rows, got ${quakes.length}`);
  for (const q of quakes) {
    assert.equal(q.damaging, true);
    assert.equal(q.exactCoords, true);
    assert.equal(q.source, 'volcanodiscovery');
    assert.ok(Number.isFinite(q.lat) && Number.isFinite(q.lon));
    // Note: damaging quakes are not magnitude-bound (e.g. shallow swarm
    // events with local damage appear with M < 1 in the real fixture).
    assert.ok(Number.isFinite(q.magnitude) && q.magnitude > 0);
  }
});

test('parseDamagingQuakes extracts known fields of a specific fixture row', () => {
  const quakes = parseDamagingQuakes(damagingHtml);
  const q = quakes.find((x) => x.id === '23272106');
  assert.ok(q, 'row 23272106 should be parsed');
  assert.equal(q.magnitude, 7.7);
  assert.equal(q.lat, -8.3101);
  assert.equal(q.lon, 121.3517);
  assert.equal(q.time, new Date(1786744701 * 1000).toISOString());
  assert.match(q.place, /Flores Region/);
  assert.match(q.place, /Indonesia/);
  assert.match(q.url, /sismos\/23272106\//);
  assert.equal(q.depthKm, null);
});

test('parseDamagingQuakes falls back to a detail URL when the row has no link', () => {
  const quakes = parseDamagingQuakes(damagingHtml);
  for (const q of quakes) assert.ok(typeof q.url === 'string' && q.url.startsWith('https://'));
});

test('parsers return empty arrays on unrelated HTML', () => {
  assert.deepEqual(parseHoyQuakes('<html><body>nothing</body></html>'), []);
  assert.deepEqual(parseDamagingQuakes('<html><body>nothing</body></html>'), []);
});

test('decodeEntities handles the entities used in VD markup', () => {
  assert.equal(decodeEntities('a&nbsp;b&emsp;c &amp; d &#233;'), 'a b c & d é');
});
