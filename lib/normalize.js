// Shared quake shape, continent inference and filter helpers.
// All quakes across sources normalize to:
// { id, time (ISO UTC), magnitude, depthKm, place, lat, lon,
//   exactCoords, source, url, continent, country, [damaging] }

/**
 * Build a normalized quake object. Performs light coercion/validation and
 * derives continent/country. Returns null when mandatory fields are missing.
 */
export function makeQuake({
  id,
  time,
  magnitude,
  depthKm = null,
  place = '',
  lat,
  lon,
  exactCoords = false,
  source,
  url = null,
  damaging = undefined
}) {
  // Guard against Number(null|'') === 0 coercions before converting.
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  const latN = num(lat);
  const lonN = num(lon);
  const magN = num(magnitude);
  if (!id || !time || !Number.isFinite(latN) || !Number.isFinite(lonN) || !Number.isFinite(magN)) {
    return null;
  }
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const depthN = num(depthKm);

  const quake = {
    id: String(id),
    time: date.toISOString(),
    magnitude: magN,
    depthKm: Number.isFinite(depthN) ? depthN : null,
    place: String(place).trim(),
    lat: latN,
    lon: lonN,
    exactCoords: Boolean(exactCoords),
    source,
    url,
    continent: inferContinent(latN, lonN),
    country: extractCountry(place)
  };
  if (damaging !== undefined) quake.damaging = Boolean(damaging);
  return quake;
}

// Continent names are user-facing (Spanish UI), hence the Spanish values.
export const CONTINENTS = [
  'África',
  'América del Norte',
  'América del Sur',
  'Antártida',
  'Asia',
  'Europa',
  'Oceanía'
];

/**
 * Rough continent inference from lat/lon bounding boxes.
 * Intentionally approximate: good enough for a coarse geographic filter.
 */
export function inferContinent(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  if (lat <= -60) return 'Antártida';

  // Oceania: Australia, Melanesia, New Zealand, Polynesia, Hawaii.
  if (lon >= 110 && lon <= 155 && lat <= -10) return 'Oceanía';
  if (lon >= 155 && lon <= 180 && lat <= 0) return 'Oceanía';
  if (lon <= -140 && lat <= 0 && lat >= -60) return 'Oceanía';
  if (lat >= 15 && lat <= 26 && lon >= -162 && lon <= -152) return 'Oceanía'; // Hawaii

  // Americas (western hemisphere beyond the Mid-Atlantic).
  if (lon < -25) {
    if (lat < 0) return 'América del Sur';
    if (lat < 13 && lon > -82) return 'América del Sur';
    return 'América del Norte';
  }

  // Africa, carving out the Levant and the Arabian peninsula (-> Asia).
  if (lon >= -18 && lon <= 52 && lat >= -35 && lat <= 37) {
    const levant = lon >= 34 && lat >= 28;
    const arabia = lon >= 40 && lat >= 12;
    if (!levant && !arabia) return 'África';
  }

  // Europe, carving out Anatolia (-> Asia).
  if (lat >= 36 && lat <= 82 && lon >= -25 && lon <= 45) {
    const anatolia = lon >= 27 && lat <= 42;
    if (!anatolia) return 'Europa';
  }

  return 'Asia';
}

/**
 * Extract a country-ish token from a "region, subregion, Country" place string.
 */
export function extractCountry(place) {
  if (!place) return null;
  const parts = String(place)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // Drop trailing parenthetical annotations, e.g. "Chile (mar)".
  return parts[parts.length - 1].replace(/\s*\(.*\)\s*$/, '').trim() || null;
}

/**
 * Keep quakes whose time falls within the last `hours` hours relative to `now`.
 */
export function filterByTimeWindow(quakes, hours, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const minMs = nowMs - hours * 3600 * 1000;
  return quakes.filter((q) => {
    const t = Date.parse(q.time);
    return Number.isFinite(t) && t >= minMs && t <= nowMs + 5 * 60 * 1000;
  });
}

/** Sort newest first. */
export function sortByTimeDesc(quakes) {
  return [...quakes].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const DUP_TIME_MS = 90 * 1000;
const DUP_DIST_KM = 100;

/**
 * Merge two quake lists: returns all primary quakes plus the secondary quakes
 * that do not duplicate any primary one. A duplicate is the same event
 * reported by both catalogs: |Δtime| <= 90 s AND distance <= 100 km.
 */
export function mergeQuakes(primary, secondary) {
  const extras = secondary.filter((s) => {
    const st = Date.parse(s.time);
    return !primary.some(
      (p) =>
        Math.abs(Date.parse(p.time) - st) <= DUP_TIME_MS &&
        haversineKm(p.lat, p.lon, s.lat, s.lon) <= DUP_DIST_KM
    );
  });
  return [...primary, ...extras];
}

/** Deduplicate by id, keeping the first occurrence. */
export function dedupeById(quakes) {
  const seen = new Set();
  const out = [];
  for (const q of quakes) {
    if (!seen.has(q.id)) {
      seen.add(q.id);
      out.push(q);
    }
  }
  return out;
}
