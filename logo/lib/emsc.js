// EMSC (seismicportal.eu) FDSN event feed — complements USGS worldwide.
//
// Rationale (verified 2026-08-26): the USGS all_day feed covers the US
// densely but misses most sub-M4 quakes elsewhere (e.g. South America).
// The EMSC FDSN query returned 349 quakes in 24 h, 44 of them in South
// America. Feature shape: properties { unid, mag, time (ISO), depth,
// flynn_region (SHOUTING CASE) }, geometry.coordinates [lon, lat, z].
// Depth is taken from properties.depth (geometry z is inconsistent in sign).

import { makeQuake, sortByTimeDesc, titleCaseRegion } from './normalize.js';

// Re-exported for backwards compatibility (implementation lives in normalize).
export { titleCaseRegion };

export function emsc24hQueryUrl(now = Date.now()) {
  const start = new Date(now - 24 * 3600 * 1000).toISOString();
  return (
    'https://www.seismicportal.eu/fdsnws/event/1/query' +
    `?format=json&starttime=${start}&limit=1500&orderby=time`
  );
}

/**
 * Normalize an EMSC FDSN FeatureCollection into the shared quake shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeEmsc(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const quakes = [];
  for (const f of geojson.features) {
    const props = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const unid = props.unid || f.id;
    // Null-safe depth: Number(null) === 0, so keep null explicit.
    const depthKm = props.depth == null ? null : Math.round(Number(props.depth));
    const quake = makeQuake({
      id: unid ? `emsc-${unid}` : null,
      time: props.time,
      magnitude: props.mag,
      depthKm,
      place: titleCaseRegion(props.flynn_region),
      lat: coords[1],
      lon: coords[0],
      exactCoords: true,
      source: 'emsc',
      url: unid ? `https://www.seismicportal.eu/eventdetails.html?unid=${unid}` : null
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(quakes);
}

/** Fetch + normalize the last-24h EMSC feed. */
export async function fetchEmsc24h() {
  const res = await fetch(emsc24hQueryUrl(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`EMSC fetch failed: ${res.status}`);
  return normalizeEmsc(await res.json());
}
