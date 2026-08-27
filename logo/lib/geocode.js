// Offline reverse geocoding: nearest-city lookup with seismology-style
// Spanish labels ("23 km al NE de Jáchal, San Juan, Argentina").
//
// Replaces the earlier Nominatim proxy: epicenters usually fall in
// unpopulated areas where Nominatim reverse returns no locality (only the
// province), so labels degraded to "San Juan, Argentina". A nearest-city
// computation against the GeoNames cities1000 dataset (population > 1000,
// bundled at lib/data/cities.json by tools/build-cities.js) always names the
// closest actual town — and needs no external calls or usage policies.
//
// Dataset row shape: [name, lat, lon, admin1Name, countryCode].

import { readFileSync } from 'node:fs';

const KM_PER_DEG = 111.195; // mean Earth degree length (R = 6371 km)
const OCEAN_CUTOFF_KM = 400; // farther than this from any city -> open sea
const NEARBY_KM = 5; // closer than this -> no "N km al X de" prefix

// Order matters: index = round(bearing / 45 deg) mod 8, clockwise from north.
const COMPASS_ES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

let citiesCache = null;
let citiesIndex = null; // spatial bucket index over citiesCache (see below)

// ---- Spatial bucket index -------------------------------------------------
// 5-degree cells: 36 latitude bands x 72 wrapped longitude columns. Built
// once at dataset load; nearestCity scans the query cell plus expanding
// Chebyshev rings until no unexplored ring can beat the best hit. This is an
// internal optimization only — results are identical to the linear scan.

const CELL_DEG = 5;
const LAT_CELLS = 36;
const LON_CELLS = 72;

function latCellOf(lat) {
  return Math.min(LAT_CELLS - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)));
}

function lonCellOf(lon) {
  return Math.floor((((lon + 180) % 360) + 360) % 360 / CELL_DEG) % LON_CELLS;
}

function buildIndex(cities) {
  const index = new Map();
  for (const row of cities) {
    const key = latCellOf(row[1]) * LON_CELLS + lonCellOf(row[2]);
    let bucket = index.get(key);
    if (!bucket) index.set(key, (bucket = []));
    bucket.push(row);
  }
  return index;
}

/** Lazily load and cache the bundled cities dataset (one parse per instance). */
export function loadCities() {
  if (!citiesCache) {
    citiesCache = JSON.parse(
      readFileSync(new URL('./data/cities.json', import.meta.url), 'utf-8')
    );
    citiesIndex = buildIndex(citiesCache);
  }
  return citiesCache;
}

/** Validate a coordinate query param: finite number within ±range, else null. */
export function validCoord(value, range) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > range) return null;
  return n;
}

/** Shortest longitude difference, antimeridian-safe (result in -180..180). */
function lonDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function scanRows(rows, lat, lon, cosLat, state) {
  for (const row of rows) {
    const dLat = row[1] - lat;
    const dLon = lonDelta(row[2], lon) * cosLat;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < state.bestD2) {
      state.bestD2 = d2;
      state.best = row;
    }
  }
}

function nearestIndexed(lat, lon, index) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const latC = latCellOf(lat);
  const lonC = lonCellOf(lon);
  const state = { best: null, bestD2: Infinity };
  const visited = new Set();

  const visit = (cy, cx) => {
    if (cy < 0 || cy >= LAT_CELLS) return;
    cx = ((cx % LON_CELLS) + LON_CELLS) % LON_CELLS; // wrap at ±180
    const key = cy * LON_CELLS + cx;
    if (visited.has(key)) return; // rings re-wrap onto themselves near poles
    visited.add(key);
    const rows = index.get(key);
    if (rows) scanRows(rows, lat, lon, cosLat, state);
  };

  // Expand Chebyshev rings until no unexplored ring can hold a closer city.
  // Lower bound for ring r: a cell there differs by >= (r-1) cells in lat
  // (>= (r-1)*5 deg in the metric) or in lon (>= (r-1)*5*cosLat deg) — the
  // weaker of the two is the lon one, which degrades near the poles; the
  // visited-set makes the worst (polar) case a full scan, never wrong.
  const maxRings = LAT_CELLS + LON_CELLS; // full coverage with wrapping
  for (let r = 0; r <= maxRings; r++) {
    if (state.best) {
      const boundDeg = (r - 1) * CELL_DEG * cosLat;
      if (boundDeg > 0 && boundDeg * boundDeg > state.bestD2) break;
    }
    if (r === 0) {
      visit(latC, lonC);
      continue;
    }
    for (let dx = -r; dx <= r; dx++) {
      visit(latC - r, lonC + dx);
      visit(latC + r, lonC + dx);
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      visit(latC + dy, lonC - r);
      visit(latC + dy, lonC + r);
    }
  }
  return state;
}

/**
 * Nearest city to (lat, lon) by equirectangular distance (cos-lat corrected).
 * The bundled dataset goes through the spatial bucket index; explicit city
 * lists (tests, fixtures) use the plain linear scan. Both paths share the
 * same metric and return identical results.
 * Returns { name, lat, lon, admin1, cc, distKm } or null on an empty list.
 */
export function nearestCity(lat, lon, cities = loadCities()) {
  let state;
  if (cities === citiesCache && citiesIndex) {
    state = nearestIndexed(lat, lon, citiesIndex);
  } else {
    state = { best: null, bestD2: Infinity };
    scanRows(cities, lat, lon, Math.cos((lat * Math.PI) / 180), state);
  }
  const { best, bestD2 } = state;
  if (!best) return null;
  return {
    name: best[0],
    lat: best[1],
    lon: best[2],
    admin1: best[3],
    cc: best[4],
    distKm: Math.sqrt(bestD2) * KM_PER_DEG
  };
}

/**
 * 8-wind Spanish compass direction FROM the city TO the epicenter
 * ("al NE de X" = the epicenter lies NE of city X).
 */
export function compass8(cityLat, cityLon, lat, lon) {
  const dLat = lat - cityLat;
  const dLon = lonDelta(lon, cityLon) * Math.cos(((lat + cityLat) / 2) * (Math.PI / 180));
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI; // 0 = N, 90 = E
  return COMPASS_ES[Math.round(((deg + 360) % 360) / 45) % 8];
}

/** Country name in Spanish from an ISO code, falling back to the code. */
function countryNameEs(cc) {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(cc) || cc;
  } catch {
    return cc;
  }
}

/** Accent-insensitive comparison: GeoNames admin1 names are ASCII-folded. */
function sameName(a, b) {
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return fold(a) === fold(b);
}

/**
 * Seismology-style label: "23 km al NE de Jáchal, San Juan, Argentina",
 * or just "Jáchal, San Juan, Argentina" when the epicenter is < 5 km away.
 * admin1 is skipped when missing or identical to the city name (compared
 * accent-insensitively, e.g. "Valparaíso" vs admin1 "Valparaiso").
 */
export function buildNearLabel(city, distKm, direction) {
  const parts = [city.name];
  if (city.admin1 && !sameName(city.admin1, city.name)) parts.push(city.admin1);
  parts.push(countryNameEs(city.cc));
  const base = parts.join(', ');
  return distKm < NEARBY_KM ? base : `${Math.round(distKm)} km al ${direction} de ${base}`;
}

/**
 * Full offline reverse geocode: label for the nearest city, or null when the
 * point is farther than 400 km from any city (mid-ocean).
 */
export function reverseGeocode(lat, lon, cities = loadCities()) {
  const city = nearestCity(lat, lon, cities);
  if (!city || city.distKm > OCEAN_CUTOFF_KM) return null;
  return buildNearLabel(city, city.distKm, compass8(city.lat, city.lon, lat, lon));
}

/**
 * Annotate each quake with `near`: the offline nearest-city label, or null
 * for mid-ocean epicenters. Mutates and returns the same array; runs once per
 * API cache rebuild so tooltips and cards can render the label synchronously.
 */
export function annotateNear(quakes) {
  for (const q of quakes) {
    q.near = reverseGeocode(q.lat, q.lon);
  }
  return quakes;
}
