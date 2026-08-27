import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validCoord,
  nearestCity,
  compass8,
  buildNearLabel,
  reverseGeocode,
  annotateNear,
  loadCities
} from '../lib/geocode.js';

// Small inline fixture in the cities.json row shape:
// [name, lat, lon, admin1Name, countryCode]
const FIX = [
  ['Jáchal', -30.241, -68.744, 'San Juan', 'AR'],
  ['Mendoza', -32.89, -68.844, 'Mendoza', 'AR'],
  ['NearDateEast', -17, 179.95, '', 'FJ'],
  ['FarDateEast', -17, 178.0, '', 'FJ'],
  ['HighLatLonOff', 60, 1.5, '', 'NO'],
  ['HighLatLatOff', 61, 0, '', 'NO']
];

test('nearestCity finds the closest city across the antimeridian', () => {
  // Epicenter just west of the date line: NearDateEast sits 0.1 deg away
  // across it (~11 km), FarDateEast is ~2 deg away on the same side.
  const hit = nearestCity(-17, -179.95, FIX);
  assert.equal(hit.name, 'NearDateEast');
  assert.ok(hit.distKm < 15, `expected ~11 km, got ${hit.distKm}`);
});

test('nearestCity applies the cos-lat longitude correction', () => {
  // At lat 60, 1.5 deg of longitude (~83 km) is shorter than 1 deg of
  // latitude (~111 km). Without the correction the lat-offset city would win.
  const hit = nearestCity(60, 0, FIX);
  assert.equal(hit.name, 'HighLatLonOff');
});

test('compass8 returns Spanish 8-wind directions (city -> epicenter)', () => {
  // City at origin; epicenter offset in each direction (equator: 1 deg lat
  // and 1 deg lon are the same length, so diagonals are exact 45 deg).
  const cases = [
    [1, 0, 'N'],
    [1, 1, 'NE'],
    [0, 1, 'E'],
    [-1, 1, 'SE'],
    [-1, 0, 'S'],
    [-1, -1, 'SO'],
    [0, -1, 'O'],
    [1, -1, 'NO']
  ];
  for (const [dLat, dLon, expected] of cases) {
    assert.equal(compass8(0, 0, dLat, dLon), expected, `offset (${dLat}, ${dLon})`);
  }
});

test('buildNearLabel formats seismology-style labels', () => {
  const jachal = { name: 'Jáchal', admin1: 'San Juan', cc: 'AR' };
  assert.equal(buildNearLabel(jachal, 23.4, 'NE'), '23 km al NE de Jáchal, San Juan, Argentina');
  assert.equal(buildNearLabel(jachal, 4.9, 'NE'), 'Jáchal, San Juan, Argentina');
});

test('buildNearLabel skips missing or duplicated admin1 and resolves country in Spanish', () => {
  assert.equal(
    buildNearLabel({ name: 'Suva', admin1: '', cc: 'FJ' }, 12, 'S'),
    '12 km al S de Suva, Fiyi'
  );
  // admin1 identical to the city name would read "Mendoza, Mendoza, Argentina".
  assert.equal(
    buildNearLabel({ name: 'Mendoza', admin1: 'Mendoza', cc: 'AR' }, 2, 'N'),
    'Mendoza, Argentina'
  );
  assert.equal(
    buildNearLabel({ name: 'Tokio', admin1: 'Tokio', cc: 'JP' }, 30, 'O'),
    '30 km al O de Tokio, Japón'
  );
});

test('reverseGeocode returns null in mid-ocean (> 400 km from any city)', () => {
  assert.equal(reverseGeocode(0, -140, FIX), null);
});

test('reverseGeocode against the real dataset resolves localities, not just provinces', () => {
  const cities = loadCities();
  assert.ok(cities.length > 100000, `expected the full dataset, got ${cities.length}`);

  // Rural San Juan (Argentina): must name a locality near Jáchal, never the
  // province-only "San Juan, Argentina" that Nominatim used to produce.
  const rural = reverseGeocode(-30.24, -68.75, cities);
  assert.ok(rural, 'expected a label for rural San Juan');
  assert.notEqual(rural, 'San Juan, Argentina');
  assert.match(rural, /Jáchal|San José de Jáchal/);
  assert.match(rural, /Argentina$/);

  // Mendoza city coordinates must resolve to a Mendoza locality.
  const mendoza = reverseGeocode(-32.89, -68.84, cities);
  assert.ok(mendoza, 'expected a label for Mendoza');
  assert.match(mendoza, /Mendoza|Godoy Cruz|Guaymallén/);
  assert.match(mendoza, /Argentina$/);
});

test('annotateNear sets near labels (or null) on every quake', () => {
  const quakes = [
    { id: 'a', lat: -30.24, lon: -68.75 }, // rural San Juan
    { id: 'b', lat: 0, lon: -140 } // mid-Pacific
  ];
  const out = annotateNear(quakes);
  assert.equal(out, quakes, 'mutates and returns the same array');
  assert.match(quakes[0].near, /Jáchal/);
  assert.equal(quakes[1].near, null);
});

test('spatial index returns exactly what the linear scan returns', () => {
  const cities = loadCities();
  const linearCopy = cities.slice(); // a non-cached array forces the linear path
  // Deterministic pseudo-random sample covering land, ocean, poles and the
  // antimeridian (mulberry32 PRNG, fixed seed).
  let s = 42;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const points = [];
  for (let i = 0; i < 40; i++) points.push([rnd() * 180 - 90, rnd() * 360 - 180]);
  points.push([-89.5, 10], [89.5, -170], [0, 179.99], [0, -179.99], [-30.24, -68.75]);

  for (const [lat, lon] of points) {
    const indexed = nearestCity(lat, lon); // default dataset -> indexed path
    const linear = nearestCity(lat, lon, linearCopy);
    assert.ok(indexed && linear, `both paths must resolve (${lat}, ${lon})`);
    assert.ok(
      Math.abs(indexed.distKm - linear.distKm) < 1e-9,
      `distance mismatch at (${lat}, ${lon}): ${indexed.distKm} vs ${linear.distKm}`
    );
    assert.equal(indexed.name, linear.name, `city mismatch at (${lat}, ${lon})`);
  }
});

test('validCoord validates ranges', () => {
  assert.equal(validCoord('-33.08', 90), -33.08);
  assert.equal(validCoord('91', 90), null);
  assert.equal(validCoord('abc', 180), null);
  assert.equal(validCoord('', 180), null);
  assert.equal(validCoord('179.9', 180), 179.9);
});
