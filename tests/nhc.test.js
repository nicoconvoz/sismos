import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeNhc, NHC_URL } from '../lib/nhc.js';
import { windMagnitude } from '../lib/magnitude.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const feed = JSON.parse(readFileSync(join(fixtures, 'nhc-current.json'), 'utf-8'));

test('normalizeNhc converts the real CurrentStorms feed', () => {
  const events = normalizeNhc(feed);
  assert.ok(events.length >= 1, `expected active storms, got ${events.length}`);
  for (const e of events) {
    assert.equal(e.source, 'nhc');
    assert.equal(e.kind, 'cyclone');
    assert.ok(e.id.startsWith('nhc-'));
    assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lon));
    assert.ok(e.magnitude >= 0 && e.magnitude <= 10);
    assert.ok(e.eventName, 'storms are named');
    assert.ok(!Number.isNaN(Date.parse(e.time)));
  }
});

test('normalizeNhc maps a synthetic hurricane exactly', () => {
  const feed = {
    activeStorms: [
      {
        id: 'ep092026',
        name: 'Karina',
        classification: 'HU',
        intensity: '140',
        pressure: '915',
        latitudeNumeric: 18.3,
        longitudeNumeric: -130.8,
        lastUpdate: '2026-09-02T03:00:00.000Z',
        publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml' }
      }
    ]
  };
  const [e] = normalizeNhc(feed);
  assert.equal(e.id, 'nhc-ep092026');
  assert.equal(e.eventName, 'Karina');
  assert.equal(e.lat, 18.3);
  assert.equal(e.lon, -130.8);
  assert.equal(e.time, '2026-09-02T03:00:00.000Z');
  assert.equal(e.magnitude, windMagnitude(140)); // 140 kt -> 8, gigante
  assert.equal(e.tier, 'gigante');
  assert.equal(e.url, 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml');
  assert.deepEqual(e.severity, { value: 140, unit: 'kt', text: '140 kt, 915 mb' });
});

test('normalizeNhc skips storms without coordinates and tolerates malformed input', () => {
  const feed = {
    activeStorms: [
      { id: 'x', name: 'Ghost', intensity: '50', lastUpdate: '2026-09-02T00:00:00Z' }
    ]
  };
  assert.deepEqual(normalizeNhc(feed), []);
  assert.deepEqual(normalizeNhc(null), []);
  assert.deepEqual(normalizeNhc({}), []);
});

test('windMagnitude maps knots onto the engine scale', () => {
  assert.equal(windMagnitude(30), 2.5); // tropical depression
  assert.equal(windMagnitude(65), 4.25); // cat 1
  assert.equal(windMagnitude(140), 8); // cat 5
  assert.equal(windMagnitude(10), 2); // floor
  assert.equal(windMagnitude(200), 9); // ceiling
});

test('NHC_URL points at the keyless CurrentStorms feed', () => {
  assert.equal(NHC_URL, 'https://www.nhc.noaa.gov/CurrentStorms.json');
});
