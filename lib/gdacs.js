// GDACS (Global Disaster Alert and Coordination System, EU/UN JRC) adapter.
//
// EVENTS4APP returns the current worldwide event set as GeoJSON point
// centroids with an expert-computed alert level (Green/Orange/Red) and an
// alertscore — humanitarian impact, not media attention. That grading is the
// primary magnitude signal; earthquakes additionally carry their Richter-like
// severity, which maps onto the engine scale directly.
//
// Gotcha: GDACS dates come without a zone marker ("2026-09-02T00:04:54") but
// are UTC; parsing them as-is would silently apply the server's local zone.

import { makeEvent, sortByTimeDesc } from './normalize.js';
import { alertMagnitude, clampMagnitude } from './magnitude.js';

export const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';

const KIND_BY_EVENTTYPE = {
  EQ: 'earthquake',
  TC: 'cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'drought',
  WF: 'wildfire',
  TS: 'tsunami'
};

/** Force-parse a GDACS local-less timestamp as UTC. Returns null if invalid. */
function gdacsUtc(value) {
  if (!value) return null;
  const s = String(value);
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normalize a GDACS EVENTS4APP FeatureCollection into the shared event shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeGdacs(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const events = [];
  for (const f of geojson.features) {
    const props = f.properties || {};
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates || [];

    const sev = props.severitydata || {};
    const sevValue = Number(sev.severity);
    const kind = KIND_BY_EVENTTYPE[props.eventtype] || String(props.eventtype || '').toLowerCase();

    // Earthquakes carry a Richter-like magnitude; everything else is graded
    // by the GDACS alert level + score.
    const magnitude =
      props.eventtype === 'EQ' && sev.severityunit === 'M' && Number.isFinite(sevValue)
        ? clampMagnitude(sevValue)
        : alertMagnitude(props.alertlevel, props.alertscore);

    const affected = Array.isArray(props.affectedcountries) ? props.affectedcountries[0] : null;
    const event = makeEvent({
      id: `gdacs-${props.eventtype}-${props.eventid}`,
      time: gdacsUtc(props.fromdate),
      updated: gdacsUtc(props.datemodified || props.todate),
      title: props.name || props.description || '',
      kind,
      lat,
      lon,
      country: props.country || null,
      cc: (affected && affected.iso2) || null,
      source: 'gdacs',
      url: (props.url && props.url.report) || null,
      alert: props.alertlevel || null,
      // GDACS pads unmeasured events with "Magnitude 0" placeholders; a zero
      // severity carries no information, so keep the card clean instead.
      severity: Number.isFinite(sevValue) && sevValue > 0
        ? { value: sevValue, unit: sev.severityunit || '', text: sev.severitytext || '' }
        : null,
      magnitude
    });
    if (event) {
      // Proper name of the phenomenon (e.g. cyclone "KARINA-26") for
      // client-side title construction.
      event.eventName = props.eventname ? String(props.eventname).trim() || null : null;
      events.push(event);
    }
  }
  return sortByTimeDesc(events);
}

/** Fetch + normalize the current GDACS event set. */
export async function fetchGdacs() {
  const res = await fetch(GDACS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GDACS fetch failed: ${res.status}`);
  return normalizeGdacs(await res.json());
}
