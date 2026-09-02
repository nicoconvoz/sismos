// CSN Chile (Centro Sismológico Nacional) via the boostr.cl mirror.
//
// Source selection (probed 2026-08-27):
// - https://api.gael.cloud/general/public/sismos responds but carries NO
//   coordinates (only Fecha local, Profundidad, Magnitud, RefGeografica) —
//   useless for plotting.
// - sismologia.cl itself only lists links to per-event informe pages on its
//   homepage (coordinates live inside each informe HTML) — scraping would
//   need one request per event.
// - https://api.boostr.cl/earthquakes/recent.json returns the CSN recent list
//   (~15 events, current day) WITH latitude/longitude, magnitude, depth and
//   the official sismologia.cl informe URL per event. Chosen for that reason.
//
// Time handling: boostr's date/hour is CHILE LOCAL TIME — verified against
// the official informe (boostr hour 08:59:15 <-> "Hora UTC 12:59:15" on
// sismologia.cl informe 380775, i.e. UTC-4 in austral winter). Chile observes
// DST (UTC-3 in summer), so conversion goes through America/Santiago via
// Intl, never a hardcoded offset.

import { makeQuakeEvent, sortByTimeDesc, dedupeById, localTimeToUtc } from './normalize.js';

export const CSN_FEED_URL = 'https://api.boostr.cl/earthquakes/recent.json';
const CL_TZ = 'America/Santiago';

/**
 * Normalize the boostr/CSN feed into the shared event shape.
 * Pure function — safe for fixture-based tests.
 */
export function normalizeCsn(feed) {
  const rows = feed && Array.isArray(feed.data) ? feed.data : [];
  const quakes = [];
  for (const row of rows) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.date || '');
    const hm = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(row.hour || '');
    if (!dm || !hm) continue;
    const date = localTimeToUtc(
      {
        year: Number(dm[1]),
        month: Number(dm[2]),
        day: Number(dm[3]),
        hour: Number(hm[1]),
        minute: Number(hm[2]),
        second: Number(hm[3])
      },
      CL_TZ
    );

    // Stable id from the official informe number when present.
    const informe = /informes\/\d{4}\/\d{2}\/(\d+)\.html/.exec(row.info || '');
    const id = informe ? informe[1] : `${date.getTime()}-${row.latitude}`;
    const depth = /([\d.]+)/.exec(row.depth || '');

    const quake = makeQuakeEvent({
      id: `csn-${id}`,
      time: date.toISOString(),
      magnitude: row.magnitude,
      depthKm: depth ? depth[1] : null,
      place: row.place ? `${row.place}, Chile` : 'Chile',
      lat: row.latitude,
      lon: row.longitude,
      exactCoords: true,
      source: 'csn',
      cc: 'CL',
      url: row.info || 'https://www.sismologia.cl/'
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(dedupeById(quakes));
}

/** Fetch + normalize the CSN recent-quakes feed. */
export async function fetchCsn() {
  const res = await fetch(CSN_FEED_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CSN (boostr) fetch failed: ${res.status}`);
  return normalizeCsn(await res.json());
}
