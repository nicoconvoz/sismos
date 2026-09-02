// GET /api/events — normalized ongoing world events from all feeds.
//
// Source strategy (learned from the sismos project: no single feed is
// reliable — GDELT was down the very day this repo was scaffolded):
// three stable no-key feeds are fetched in parallel and merged with
// kind-aware time/distance dedupe. Any source may fail without breaking the
// endpoint; `source` lists only the feeds that contributed events.
//
// Earthquake coverage replicates the sismos reference faithfully: local
// agencies INPRES (Argentina) and CSN (Chile) win over the global catalogs
// USGS (dense US) + EMSC (fills sub-M4 outside the US, incl. South America),
// deduped with the 90 s window measured there (all 26 real local-vs-global
// duplicate pairs had 0-18 s origin-time deltas). GDACS EQ entries (NEIC
// solutions with alert grading) take top priority over their catalog copies.
//
// Merge priority: GDACS first (its Green/Orange/Red alert grading is the
// best magnitude signal), then local quake agencies, then global quake
// catalogs, then EONET (wide window: ongoing fires/storms have fuzzy start
// times across agencies).

import { fetchGdacs } from '../lib/gdacs.js';
import { fetchEonet } from '../lib/eonet.js';
import { fetchUsgs } from '../lib/usgs.js';
import { fetchEmsc24h } from '../lib/emsc.js';
import { fetchInpres } from '../lib/inpres.js';
import { fetchCsn } from '../lib/csn.js';
import { fetchNhc } from '../lib/nhc.js';
import { fetchFirms } from '../lib/firms.js';
import { filterByTimeWindow, mergeEvents, sortByTimeDesc } from '../lib/normalize.js';
import { annotateNear } from '../lib/geocode.js';

// GDACS/EONET refresh on multi-minute cycles; 5 min keeps the endpoint
// fresh without hammering the upstreams.
const CACHE_TTL_MS = 5 * 60 * 1000;
// Ignore anything older than 30 days — matches the EONET query window.
const MAX_AGE_HOURS = 30 * 24;

// Module-level cache: persists across invocations while the serverless
// instance stays warm; combined with s-maxage for CDN-level caching.
let cache = { payload: null, at: 0 };

// Cross-catalog earthquake dedupe: 90 s / 100 km, per the sismos project's
// measured duplicate pairs. GDACS EQ centroids are coarser, hence 150 km.
const EQ_MERGE = { maxDtMs: 90 * 1000, maxKm: 100 };
const GDACS_EQ_MERGE = { maxDtMs: 90 * 1000, maxKm: 150 };
// Cyclones move ~500 km/day, so cross-agency copies of the same storm can sit
// far apart between advisories; the wide window still only merges same-family
// events (storm/cyclone).
const CYCLONE_MERGE = { maxDtMs: 72 * 3600 * 1000, maxKm: 500 };

const SOURCE_ORDER = ['gdacs', 'inpres', 'csn', 'usgs', 'emsc', 'nhc', 'eonet', 'firms'];

async function loadEvents() {
  const results = await Promise.allSettled([
    fetchGdacs(),
    fetchInpres(),
    fetchCsn(),
    fetchUsgs(),
    fetchEmsc24h(),
    fetchNhc(),
    fetchEonet(),
    fetchFirms()
  ]);
  const [gdacs, inpres, csn, usgs, emsc, nhc, eonet, firms] = results.map((r) =>
    r.status === 'fulfilled' ? filterByTimeWindow(r.value, MAX_AGE_HOURS) : null
  );

  if (results.every((r) => r.status === 'rejected')) {
    const reasons = results.map((r) => r.reason?.message).join('; ');
    throw new Error(`all sources failed: ${reasons}`);
  }

  // Quake pipeline, mirroring the sismos reference: local networks rarely
  // overlap but dedupe the AR/CL border anyway; locals win over globals.
  const local = mergeEvents(inpres || [], csn || [], EQ_MERGE);
  const global = usgs && emsc ? mergeEvents(usgs, emsc, EQ_MERGE) : usgs || emsc || [];
  const quakes = mergeEvents(local, global, EQ_MERGE);

  // GDACS wins over the catalog copy of the same quake (alert info survives),
  // then NHC fills cyclones GDACS has not listed, then EONET, then FIRMS
  // clusters fill the wildfire gaps (mostly outside the US).
  let merged = gdacs || [];
  merged = mergeEvents(merged, quakes, GDACS_EQ_MERGE);
  if (nhc) merged = mergeEvents(merged, nhc, CYCLONE_MERGE);
  if (eonet) merged = mergeEvents(merged, eonet);
  if (firms) merged = mergeEvents(merged, firms);
  merged = sortByTimeDesc(merged);

  const counts = {};
  for (const e of merged) counts[e.source] = (counts[e.source] || 0) + 1;
  const source = SOURCE_ORDER.filter((s) => counts[s] > 0).join('+') || 'none';
  const errors = results
    .map((r, i) => (r.status === 'rejected' ? `${SOURCE_ORDER[i]}: ${r.reason?.message}` : null))
    .filter(Boolean);

  return { source, sourceCounts: counts, events: merged, ...(errors.length ? { errors } : {}) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(cache.payload);
  }

  try {
    const { source, sourceCounts, events, errors } = await loadEvents();
    // Offline nearest-city labels so tooltips can render "Cerca de:"
    // synchronously; runs once per cache rebuild (spatially indexed).
    annotateNear(events);
    const payload = {
      updatedAt: new Date(now).toISOString(),
      source,
      sourceCounts,
      ...(errors ? { errors } : {}),
      count: events.length,
      events
    };
    cache = { payload, at: now };
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(payload);
  } catch (err) {
    // Serve stale data if every source fails but a previous payload exists.
    if (cache.payload) {
      res.setHeader('Cache-Control', 's-maxage=300');
      return res.status(200).json({ ...cache.payload, stale: true });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
