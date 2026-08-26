// USGS GeoJSON feeds — fallback data source with exact coordinates.
//
// - Last 24 h: the official all_day.geojson summary feed.
// - Damaging quakes of the current year: the significant_month feed only
//   covers ~30 days, so we use the USGS FDSN event API instead, querying
//   minmagnitude=6 from Jan 1st of the current year. This was verified to
//   work reliably and is the documented fallback for /api/damaging.

import { makeQuake, sortByTimeDesc } from './normalize.js';

export const USGS_ALL_DAY_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export function usgsYearQueryUrl(year) {
  return (
    'https://earthquake.usgs.gov/fdsnws/event/1/query' +
    `?format=geojson&starttime=${year}-01-01&minmagnitude=6&orderby=time`
  );
}

/**
 * Normalize a USGS GeoJSON FeatureCollection into the shared quake shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeUsgs(geojson, { damaging = undefined } = {}) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const quakes = [];
  for (const f of geojson.features) {
    const props = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const quake = makeQuake({
      id: f.id || props.code,
      time: Number.isFinite(props.time) ? new Date(props.time).toISOString() : null,
      magnitude: props.mag,
      depthKm: coords[2],
      place: props.place || '',
      lat: coords[1],
      lon: coords[0],
      exactCoords: true,
      source: 'usgs',
      url: props.url || null,
      damaging
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(quakes);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`USGS fetch failed: ${res.status} ${url}`);
  return res.json();
}

/** Fetch + normalize the last-24h USGS feed. */
export async function fetchAllDay() {
  return normalizeUsgs(await fetchJson(USGS_ALL_DAY_URL));
}

/** Fetch + normalize M6+ quakes of the given year (damaging fallback). */
export async function fetchDamagingYear(year) {
  return normalizeUsgs(await fetchJson(usgsYearQueryUrl(year)), { damaging: true });
}
