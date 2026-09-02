// USGS GeoJSON all_day feed adapter — dense US earthquake coverage with
// exact coordinates, refreshed about every minute. Richter magnitude is
// already the engine's scale for quakes; the PAGER alert (green/yellow/
// orange/red) passes through when present. Worldwide sub-M4 coverage comes
// from EMSC (lib/emsc.js) and the local agencies (lib/inpres.js, lib/csn.js).

import { makeQuakeEvent, sortByTimeDesc } from './normalize.js';

export const USGS_ALL_DAY_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

/**
 * Normalize a USGS GeoJSON FeatureCollection into the shared event shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeUsgs(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const events = [];
  for (const f of geojson.features) {
    const props = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const event = makeQuakeEvent({
      id: f.id ? `usgs-${f.id}` : null,
      time: Number.isFinite(props.time) ? new Date(props.time).toISOString() : null,
      magnitude: props.mag,
      depthKm: coords[2],
      place: props.place || '',
      lat: coords[1],
      lon: coords[0],
      exactCoords: true,
      source: 'usgs',
      url: props.url || null,
      alert: props.alert || null
    });
    if (event) events.push(event);
  }
  return sortByTimeDesc(events);
}

/** Fetch + normalize the last-24h USGS feed. */
export async function fetchUsgs() {
  const res = await fetch(USGS_ALL_DAY_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`USGS fetch failed: ${res.status}`);
  return normalizeUsgs(await res.json());
}
