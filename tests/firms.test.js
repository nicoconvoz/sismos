import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFirmsCsv, FIRMS_MODIS_URL } from '../lib/firms.js';
import { TIERS, logScale } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const csv = readFileSync(join(fixtures, 'firms-modis-24h.csv'), 'utf-8');

test('parseFirmsCsv clusters the real MODIS feed into fire events', () => {
  const events = parseFirmsCsv(csv);
  assert.ok(events.length > 20, `expected clustered fires, got ${events.length}`);
  // Clustering must compress pixels massively (8k rows -> hundreds max).
  assert.ok(events.length < 3000, `too many clusters: ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'firms');
    assert.equal(e.kind, 'wildfire');
    assert.ok(e.id.startsWith('firms-'));
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.magnitude >= 0 && e.magnitude <= 10);
    assert.ok(TIERS.includes(e.tier));
    assert.ok(!Number.isNaN(Date.parse(e.time)));
    assert.ok(e.severity && e.severity.unit === 'MW');
  }
  // The whole point: South America coverage EONET lacks.
  const southAmerica = events.filter((e) => e.continent === 'América del Sur');
  assert.ok(southAmerica.length >= 5, `expected SA fires, got ${southAmerica.length}`);
});

const HEADER =
  'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight';

function row(lat, lon, date, time, conf, frp) {
  return `${lat},${lon},300,1,1,${date},${time},T,${conf},6.1NRT,290,${frp},D`;
}

test('parseFirmsCsv unions adjacent cells and FRP-weights the centroid', () => {
  const csvStr = [
    HEADER,
    row(-10.1, -55.1, '2026-09-01', '0130', 80, 100),
    row(-10.2, -55.2, '2026-09-01', '0250', 60, 200),
    // Diagonal-neighbor 0.5° cell -> same cluster via 8-neighbor union.
    row(-10.6, -55.6, '2026-09-01', '0110', 90, 50)
  ].join('\n');
  const events = parseFirmsCsv(csvStr);
  assert.equal(events.length, 1);
  const [e] = events;
  // FRP-weighted centroid of the three pixels.
  assert.ok(Math.abs(e.lat - -10.2286) < 0.001, `lat ${e.lat}`);
  assert.ok(Math.abs(e.lon - -55.2286) < 0.001, `lon ${e.lon}`);
  // Latest acquisition wins as the event time.
  assert.equal(e.time, '2026-09-01T02:50:00.000Z');
  assert.equal(e.severity.value, 350);
  assert.equal(e.magnitude, logScale(350, { v0: 50, m0: 2.2, v1: 50000, m1: 6.8 }));
  assert.equal(e.continent, 'América del Sur');
});

test('parseFirmsCsv drops low-confidence pixels and insignificant clusters', () => {
  const csvStr = [
    HEADER,
    // Low confidence -> ignored entirely.
    row(40, -100, '2026-09-01', '0100', 30, 500),
    // Lone weak pixel: 1 px and 10 MW -> below both keep thresholds.
    row(0, 10, '2026-09-01', '0100', 90, 10),
    // Lone STRONG pixel (>= 100 MW) survives on FRP alone.
    row(5, 20, '2026-09-01', '0100', 90, 150)
  ].join('\n');
  const events = parseFirmsCsv(csvStr);
  assert.equal(events.length, 1);
  assert.equal(events[0].severity.value, 150);
});

test('parseFirmsCsv accepts VIIRS-style textual confidence', () => {
  const viirsHeader =
    'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
  const csvStr = [
    viirsHeader,
    `-3.0,-60.0,320,0.5,0.6,2026-09-01,0400,N,nominal,2.0NRT,290,120,N`,
    `-3.0,-60.05,320,0.5,0.6,2026-09-01,0410,N,low,2.0NRT,290,300,N` // low conf -> dropped
  ].join('\n');
  const events = parseFirmsCsv(csvStr);
  assert.equal(events.length, 1);
  assert.equal(events[0].severity.value, 120);
});

test('parseFirmsCsv tolerates malformed input', () => {
  assert.deepEqual(parseFirmsCsv(''), []);
  assert.deepEqual(parseFirmsCsv(null), []);
  assert.deepEqual(parseFirmsCsv('garbage without header\n1,2,3'), []);
});

test('FIRMS_MODIS_URL points at the keyless global 24h CSV', () => {
  assert.equal(
    FIRMS_MODIS_URL,
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv'
  );
});
