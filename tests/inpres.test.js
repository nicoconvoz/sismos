import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseInpresXml } from '../lib/inpres.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const xml = readFileSync(join(fixtures, 'inpres-sismos.xml'), 'utf-8');

test('parseInpresXml extracts the quake list', () => {
  const quakes = parseInpresXml(xml);
  assert.ok(quakes.length >= 10, `expected >= 10 quakes, got ${quakes.length}`);
  for (const q of quakes) {
    assert.equal(q.source, 'inpres');
    assert.equal(q.exactCoords, true);
    assert.ok(q.id.startsWith('inpres-'));
    assert.ok(Number.isFinite(q.lat) && q.lat < 0, 'Argentina latitudes are negative');
    assert.ok(Number.isFinite(q.lon) && q.lon < 0);
    assert.ok(Number.isFinite(q.magnitude));
    assert.ok(!Number.isNaN(Date.parse(q.time)));
    assert.match(q.place, /, Argentina$/);
    assert.equal(q.country, 'Argentina');
  }
});

test('parseInpresXml takes UTC time from idSismo (verified against local hora)', () => {
  const quakes = parseInpresXml(xml);
  // Fixture row: idSismo 20260827123841, fecha 27/08, hora 09:38 (UTC-3).
  // Hand-computed: 09:38 local Argentina + 3 h = 12:38:41 UTC (id has seconds).
  const q = quakes.find((x) => x.id === 'inpres-20260827123841');
  assert.ok(q, 'row 20260827123841 should be parsed');
  assert.equal(q.time, '2026-08-27T12:38:41.000Z');
  assert.equal(q.lat, -33.217);
  assert.equal(q.lon, -68.152);
  assert.equal(q.depthKm, 11);
  assert.equal(q.magnitude, 2.8);
  assert.equal(q.place, 'Mendoza, Argentina');
  assert.equal(q.url, 'https://www.inpres.gob.ar/mapa/20260827123841');
});

test('parseInpresXml handles the midnight-crossing local date correctly', () => {
  const quakes = parseInpresXml(xml);
  // Fixture row: fecha 26/08 hora 23:53 LOCAL, idSismo 20260827025336
  // -> 2026-08-27T02:53:36Z UTC (next UTC day).
  const q = quakes.find((x) => x.id === 'inpres-20260827025336');
  assert.ok(q);
  assert.equal(q.time, '2026-08-27T02:53:36.000Z');
});

test('parseInpresXml falls back to fecha/hora (America/Argentina, UTC-3) without idSismo', () => {
  const synthetic = `<?xml version="1.0"?><lista><item>
    <idSismo>n/a</idSismo>
    <fecha>27/08</fecha><hora>09:38</hora>
    <latitud>-33.2</latitud><longitud>-68.1</longitud>
    <prof>10</prof><mg>3.0</mg><prov>MENDOZA</prov>
    <link>"../mapa/x"</link><color_link>000</color_link>
  </item></lista>`;
  // Hand-computed: 2026-08-27 09:38 Argentina local (UTC-3) = 12:38 UTC.
  const [q] = parseInpresXml(synthetic, Date.parse('2026-08-27T18:00:00Z'));
  assert.ok(q, 'synthetic row should parse via fallback');
  assert.equal(q.time, '2026-08-27T12:38:00.000Z');
});

test('parseInpresXml returns empty on unrelated content', () => {
  assert.deepEqual(parseInpresXml('<html>no</html>'), []);
  assert.deepEqual(parseInpresXml(''), []);
});
