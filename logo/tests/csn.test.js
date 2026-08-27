import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeCsn } from '../lib/csn.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'csn-boostr.json'), 'utf-8'));

test('normalizeCsn converts the real boostr/CSN feed', () => {
  const quakes = normalizeCsn(feed);
  assert.ok(quakes.length >= 10, `expected >= 10 quakes, got ${quakes.length}`);
  for (const q of quakes) {
    assert.equal(q.source, 'csn');
    assert.equal(q.exactCoords, true);
    assert.ok(q.id.startsWith('csn-'));
    assert.ok(Number.isFinite(q.lat) && Number.isFinite(q.lon));
    assert.ok(Number.isFinite(q.magnitude));
    assert.match(q.place, /, Chile$/);
    assert.equal(q.country, 'Chile');
  }
});

test('normalizeCsn converts Chile winter local time to UTC (verified vs official informe)', () => {
  const quakes = normalizeCsn(feed);
  // Fixture row: 2026-08-27 08:59:15 Chile local. The official CSN informe
  // (sismologia.cl/sismicidad/informes/2026/08/380775.html) states
  // "Hora UTC 12:59:15 27/08/2026" -> winter offset UTC-4.
  const q = quakes.find((x) => x.id === 'csn-380775');
  assert.ok(q, 'informe 380775 should be parsed with id from its info URL');
  assert.equal(q.time, '2026-08-27T12:59:15.000Z');
  assert.equal(q.lat, -21.8);
  assert.equal(q.lon, -68.81);
  assert.equal(q.depthKm, 98);
  assert.equal(q.magnitude, 2.8);
  assert.equal(q.place, '76 km al norte de Calama, Chile');
  assert.equal(q.url, 'https://sismologia.cl/sismicidad/informes/2026/08/380775.html');
});

test('normalizeCsn applies Chile summer time (DST, UTC-3)', () => {
  const [q] = normalizeCsn({
    status: 'success',
    data: [
      {
        date: '2026-01-15',
        hour: '08:00:00',
        place: 'Costa de Valparaíso',
        magnitude: '4.0',
        depth: '30 km',
        latitude: '-33.00',
        longitude: '-71.80',
        info: 'https://sismologia.cl/sismicidad/informes/2026/01/999999.html'
      }
    ]
  });
  // Hand-computed: January is Chilean summer (DST) -> UTC-3 -> 11:00 UTC.
  assert.equal(q.time, '2026-01-15T11:00:00.000Z');
});

test('normalizeCsn tolerates malformed input and rows', () => {
  assert.deepEqual(normalizeCsn(null), []);
  assert.deepEqual(normalizeCsn({}), []);
  assert.deepEqual(
    normalizeCsn({ data: [{ date: 'x', hour: 'y', magnitude: '1', latitude: 'z', longitude: '0' }] }),
    []
  );
});
