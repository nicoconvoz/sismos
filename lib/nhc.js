// NOAA NHC (National Hurricane Center) adapter — active tropical cyclones
// in the Atlantic and eastern Pacific, keyless JSON, hourly advisories with
// exact position and sustained winds. Complements GDACS TC entries with
// fresher positions and catches depressions GDACS has not yet listed.

import { makeEvent, sortByTimeDesc } from './normalize.js';
import { windMagnitude } from './magnitude.js';

export const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

/**
 * Normalize the CurrentStorms feed into the shared event shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeNhc(feed) {
  const storms = feed && Array.isArray(feed.activeStorms) ? feed.activeStorms : [];
  const events = [];
  for (const s of storms) {
    const lat = Number(s.latitudeNumeric);
    const lon = Number(s.longitudeNumeric);
    const kts = Number(s.intensity);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pressure = Number(s.pressure);
    const event = makeEvent({
      id: s.id ? `nhc-${s.id}` : null,
      time: s.lastUpdate,
      title: `${s.classification || 'TC'} ${s.name || ''}`.trim(),
      kind: 'cyclone',
      lat,
      lon,
      source: 'nhc',
      url: (s.publicAdvisory && s.publicAdvisory.url) || 'https://www.nhc.noaa.gov/',
      severity: Number.isFinite(kts)
        ? {
            value: kts,
            unit: 'kt',
            text: Number.isFinite(pressure) ? `${kts} kt, ${pressure} mb` : `${kts} kt`
          }
        : null,
      magnitude: Number.isFinite(kts) ? windMagnitude(kts) : 2.5
    });
    if (event) {
      event.eventName = s.name || null;
      events.push(event);
    }
  }
  return sortByTimeDesc(events);
}

/** Fetch + normalize the active-storms feed. */
export async function fetchNhc() {
  const res = await fetch(NHC_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHC fetch failed: ${res.status}`);
  return normalizeNhc(await res.json());
}
