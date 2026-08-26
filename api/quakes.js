// GET /api/quakes — normalized worldwide quakes of the last 24 hours.
//
// Source strategy (see lib/volcanodiscovery.js for the probe notes):
// VolcanoDiscovery is attempted first, but its "hoy" page only server-renders
// ~9 recent rows (M >= 3.5); the full list is loaded by client-side JS with no
// stable public JSON endpoint. When the VD parse yields fewer than
// VD_MIN_QUAKES usable quakes, we automatically fall back to USGS + EMSC,
// fetched in parallel and merged with time/distance dedupe: USGS all_day
// covers the US densely but misses most sub-M4 quakes elsewhere, while EMSC
// (seismicportal.eu) fills in the rest of the world (e.g. South America).
// If only one of the two succeeds, it serves alone. In practice this merged
// fallback serves the endpoint (source: 'usgs+emsc').

import { fetchHoyQuakes } from '../lib/volcanodiscovery.js';
import { fetchAllDay } from '../lib/usgs.js';
import { fetchEmsc24h } from '../lib/emsc.js';
import { filterByTimeWindow, mergeQuakes, sortByTimeDesc } from '../lib/normalize.js';

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
  // USGS + EMSC in parallel; merge when both succeed (USGS as primary,
  // EMSC filling in non-duplicate events), otherwise use whichever worked.
  const [usgsRes, emscRes] = await Promise.allSettled([fetchAllDay(), fetchEmsc24h()]);
  const usgs = usgsRes.status === 'fulfilled' ? filterByTimeWindow(usgsRes.value, 24) : null;
  const emsc = emscRes.status === 'fulfilled' ? filterByTimeWindow(emscRes.value, 24) : null;

  if (usgs && emsc) {
    return { source: 'usgs+emsc', quakes: sortByTimeDesc(mergeQuakes(usgs, emsc)), fallbackReason: vdError };
  }
  if (usgs) return { source: 'usgs', quakes: usgs, fallbackReason: vdError };
  if (emsc) return { source: 'emsc', quakes: emsc, fallbackReason: vdError };
  throw new Error(
    `all sources failed: ${vdError}; usgs: ${usgsRes.reason?.message}; emsc: ${emscRes.reason?.message}`
  );
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
    const { source, quakes, fallbackReason } = await loadQuakes();
    const payload = {
      updatedAt: new Date(now).toISOString(),
      source,
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
