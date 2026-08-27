// GET /api/quakes — normalized worldwide quakes of the last 24 hours.
//
// Source strategy (see lib/volcanodiscovery.js for the probe notes):
// VolcanoDiscovery is attempted first, but its "hoy" page only server-renders
// ~9 recent rows (M >= 3.5); the full list is loaded by client-side JS with no
// stable public JSON endpoint. When the VD parse yields fewer than
// VD_MIN_QUAKES usable quakes, we fall back to four catalogs fetched in
// parallel and merged with time/distance dedupe:
// - Local agencies (highest priority — they win over global duplicates):
//   INPRES (Argentina, lib/inpres.js) and CSN Chile (lib/csn.js).
// - Global catalogs: USGS all_day (dense US coverage) merged with EMSC
//   (seismicportal.eu — fills in sub-M4 quakes outside the US).
// Local-vs-global dedupe window: we measured all 26 real INPRES/CSN vs
// USGS/EMSC duplicate pairs on 2026-08-27 — origin-time deltas were 0-18 s
// (max 18 s), so the standard 90 s window covers cross-agency differences
// with a 5x margin. A wider 120 s window was considered and rejected: it
// found zero additional pairs while raising the risk of wrongly suppressing
// distinct aftershocks in swarms (mergeQuakes still accepts maxDtMs if the
// data ever changes).
// Any source may fail without breaking the endpoint; `source` lists only the
// catalogs that contributed quakes (e.g. 'inpres+csn+usgs+emsc').

import { fetchHoyQuakes } from '../lib/volcanodiscovery.js';
import { fetchAllDay } from '../lib/usgs.js';
import { fetchEmsc24h } from '../lib/emsc.js';
import { fetchInpres } from '../lib/inpres.js';
import { fetchCsn } from '../lib/csn.js';
import { filterByTimeWindow, mergeQuakes, sortByTimeDesc } from '../lib/normalize.js';
import { annotateNear } from '../lib/geocode.js';


// Minimum quake count for the VolcanoDiscovery scrape to be considered a
// usable primary result for a worldwide 24h view.
const VD_MIN_QUAKES = 25;
// Near-real-time: USGS refreshes all_day.geojson about every minute, so a
// 60s cache keeps the endpoint fresh without hammering the upstream.
const CACHE_TTL_MS = 60 * 1000;

// Module-level cache: persists across invocations while the serverless
// instance stays warm; combined with s-maxage for CDN-level caching.
let cache = { payload: null, at: 0 };

async function loadQuakes() {
  let vdError = null;
  try {
    const vd = filterByTimeWindow(await fetchHoyQuakes(), 24);
    if (vd.length >= VD_MIN_QUAKES) {
      return { source: 'volcanodiscovery', quakes: vd };
    }
    vdError = `volcanodiscovery returned only ${vd.length} quakes (< ${VD_MIN_QUAKES})`;
  } catch (err) {
    vdError = err.message;
  }
  // Four catalogs in parallel; local agencies get merge priority so their
  // solutions replace matching USGS/EMSC duplicates.
  const results = await Promise.allSettled([fetchInpres(), fetchCsn(), fetchAllDay(), fetchEmsc24h()]);
  const [inpres, csn, usgs, emsc] = results.map((r) =>
    r.status === 'fulfilled' ? filterByTimeWindow(r.value, 24) : null
  );

  if (!inpres && !csn && !usgs && !emsc) {
    const reasons = results.map((r) => r.reason?.message).join('; ');
    throw new Error(`all sources failed: ${vdError}; ${reasons}`);
  }

  // Local networks rarely overlap, but dedupe the AR/CL border anyway.
  const local = mergeQuakes(inpres || [], csn || []);
  const global = usgs && emsc ? mergeQuakes(usgs, emsc) : usgs || emsc || [];
  const merged = sortByTimeDesc(mergeQuakes(local, global));

  const counts = {};
  for (const q of merged) counts[q.source] = (counts[q.source] || 0) + 1;
  const source =
    ['inpres', 'csn', 'usgs', 'emsc'].filter((s) => counts[s] > 0).join('+') || 'none';

  return { source, sourceCounts: counts, quakes: merged, fallbackReason: vdError };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(cache.payload);
  }

  try {
    const { source, sourceCounts, quakes, fallbackReason } = await loadQuakes();
    // Offline nearest-city labels so tooltips can render "Cerca de:"
    // synchronously; runs once per cache rebuild (spatially indexed).
    annotateNear(quakes);
    const payload = {
      updatedAt: new Date(now).toISOString(),
      source,
      ...(sourceCounts ? { sourceCounts } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      count: quakes.length,
      quakes
    };
    cache = { payload, at: now };
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(payload);
  } catch (err) {
    // Serve stale data if both sources fail but a previous payload exists.
    if (cache.payload) {
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(200).json({ ...cache.payload, stale: true });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
