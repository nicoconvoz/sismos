// Shared event shape, continent inference and merge/filter helpers.
// All events across sources normalize to:
// { id, time (ISO UTC), updated (ISO UTC), title, kind, lat, lon,
//   country, continent, source, url, alert, severity, magnitude, tier }
//
// `magnitude` is the engine's 0–10 scale (lib/magnitude.js); `tier` derives
// from it. `alert` is green|orange|red|null. `severity` keeps the raw signal
// ({ value, unit, text }) for tooltips, or null when the feed has none.

import { clampMagnitude, tierFor } from './magnitude.js';

/**
 * Build a normalized event. Performs light coercion/validation and derives
 * continent/tier. Returns null when mandatory fields are missing.
 */
export function makeEvent({
  id,
  time,
  updated = null,
  title = '',
  kind,
  lat,
  lon,
  country = null,
  cc = null,
  source,
  url = null,
  alert = null,
  severity = null,
  magnitude
}) {
  // Guard against Number(null|'') === 0 coercions before converting.
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  const latN = num(lat);
  const lonN = num(lon);
  const magN = num(magnitude);
  if (!id || !time || !kind || !Number.isFinite(latN) || !Number.isFinite(lonN) || !Number.isFinite(magN)) {
    return null;
  }
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const updatedDate = updated ? new Date(updated) : date;
  const mag = clampMagnitude(magN);

  return {
    id: String(id),
    time: date.toISOString(),
    updated: Number.isNaN(updatedDate.getTime()) ? date.toISOString() : updatedDate.toISOString(),
    title: String(title).trim(),
    kind: String(kind),
    lat: latN,
    lon: lonN,
    country: country ? String(country).trim() : null,
    cc: cc ? String(cc).toUpperCase() : null,
    continent: inferContinent(latN, lonN),
    source,
    url,
    alert: alert ? String(alert).toLowerCase() : null,
    severity: severity || null,
    magnitude: mag,
    tier: tierFor(mag)
  };
}

/**
 * Build a normalized earthquake event from a seismic-catalog row (the quake
 * shape of the sismos reference project: magnitude/depth/place). Adds the
 * quake-specific fields (place, depthKm, exactCoords) on top of the shared
 * event shape so seismic adapters and their tests port faithfully.
 * Returns null when mandatory fields are missing.
 */
export function makeQuakeEvent({
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
  alert = null,
  cc = null
}) {
  // Guard against Number(null|'') === 0 coercions before converting.
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  const magN = num(magnitude);
  if (!Number.isFinite(magN)) return null;
  const depthN = num(depthKm);
  const placeStr = String(place).trim();

  const event = makeEvent({
    id,
    time,
    title: placeStr ? `Sismo: ${placeStr}` : 'Sismo',
    kind: 'earthquake',
    lat,
    lon,
    country: extractCountry(placeStr),
    cc,
    source,
    url,
    alert,
    severity: {
      value: magN,
      unit: 'M',
      text: Number.isFinite(depthN) ? `M ${magN}, ${depthN} km deep` : `M ${magN}`
    },
    magnitude: clampMagnitude(magN)
  });
  if (!event) return null;
  event.place = placeStr;
  event.depthKm = Number.isFinite(depthN) ? depthN : null;
  event.exactCoords = Boolean(exactCoords);
  return event;
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
 * Keep events whose start time falls within the last `hours` hours.
 */
export function filterByTimeWindow(events, hours, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const minMs = nowMs - hours * 3600 * 1000;
  return events.filter((e) => {
    const t = Date.parse(e.time);
    return Number.isFinite(t) && t >= minMs && t <= nowMs + 5 * 60 * 1000;
  });
}

/** Sort newest first. */
export function sortByTimeDesc(events) {
  return [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
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

// Kinds that describe the same physical phenomenon across feeds dedupe
// against each other (GDACS "cyclone" vs EONET "storm").
const KIND_FAMILY = { cyclone: 'storm', storm: 'storm' };

function familyOf(kind) {
  return KIND_FAMILY[kind] || kind;
}

// Ongoing events (fires, storms) have fuzzy start times across agencies, so
// the default window is wide; earthquake merges pass a tight 90 s window.
const DUP_TIME_MS = 48 * 3600 * 1000;
const DUP_DIST_KM = 150;

/**
 * Proper-name key for named phenomena (cyclones): agencies write the same
 * storm as "Karina" (NHC) or "KARINA-26" (GDACS). Null when unnamed.
 */
function stormNameOf(event) {
  if (!event.eventName) return null;
  const m = /^[\p{L}]+/u.exec(String(event.eventName).toUpperCase());
  return m ? m[0] : null;
}

/**
 * Merge two event lists: returns all primary events plus the secondary events
 * that do not duplicate any primary one. A duplicate is the same phenomenon
 * reported by both feeds: same kind family AND either the same proper name
 * (named storms — agencies date the same cyclone days apart, so time windows
 * cannot catch those) or |Δtime| <= maxDtMs AND distance <= maxKm. The
 * primary feed's solution wins (e.g. GDACS with its alert level beats the
 * EONET copy of the same storm).
 */
export function mergeEvents(primary, secondary, { maxDtMs = DUP_TIME_MS, maxKm = DUP_DIST_KM } = {}) {
  const extras = secondary.filter((s) => {
    const st = Date.parse(s.time);
    const sf = familyOf(s.kind);
    const sName = stormNameOf(s);
    return !primary.some((p) => {
      if (familyOf(p.kind) !== sf) return false;
      if (sName && stormNameOf(p) === sName) return true;
      return (
        Math.abs(Date.parse(p.time) - st) <= maxDtMs &&
        haversineKm(p.lat, p.lon, s.lat, s.lon) <= maxKm
      );
    });
  });
  return [...primary, ...extras];
}

/** Convert a SHOUTING-CASE label to Title Case for display. */
export function titleCaseRegion(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/**
 * Convert a wall-clock time expressed in an IANA time zone to a UTC Date,
 * honoring DST (e.g. America/Santiago switches between UTC-4 and UTC-3).
 * Uses Intl to resolve the zone offset — no hardcoded offsets.
 */
export function localTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two-pass correction: guess the instant, measure the zone offset at that
  // instant, re-apply. Converges for any real-world offset.
  let ts = wallMs;
  for (let i = 0; i < 2; i++) {
    ts = wallMs - zoneOffsetMs(ts, timeZone);
  }
  return new Date(ts);
}

function zoneOffsetMs(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const p = Object.fromEntries(dtf.formatToParts(ts).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    p.hour === '24' ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - ts;
}

/** Deduplicate by id, keeping the first occurrence. */
export function dedupeById(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}
