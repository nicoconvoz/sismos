// GET /api/events?group=alerts|quakes|nature|all — normalized world events.
//
// The frontend loads the three groups IN PARALLEL and paints each one as it
// lands (progressive rendering for slow mobile connections); `all` composes
// the three with the same cross-group dedupe and stays as the compatibility
// shape. Any source may fail without breaking its group; a group fails only
// when every one of its sources does.
//
// Payload diet: events go over the wire as a slim DTO — no redundant `near`
// label (the client builds localized labels from nearData), no quake-only
// internals, coordinates rounded to ~100 m, null fields omitted.
//
// Earthquake coverage replicates the sismos reference: local agencies
// INPRES/CSN win over USGS+EMSC with the measured 90 s window. Alert-graded
// feeds (GDACS first) win over catalog copies of the same phenomenon.

import { fetchGdacs } from '../lib/gdacs.js';
import { fetchEonet } from '../lib/eonet.js';
import { fetchUsgs } from '../lib/usgs.js';
import { fetchEmsc24h } from '../lib/emsc.js';
import { fetchInpres } from '../lib/inpres.js';
import { fetchCsn } from '../lib/csn.js';
import { fetchNhc } from '../lib/nhc.js';
import { fetchFirms } from '../lib/firms.js';
import { fetchSmn } from '../lib/smn.js';
import { fetchMeteoalarm } from '../lib/meteoalarm.js';
import { fetchSwic } from '../lib/swic.js';
import { filterByTimeWindow, mergeEvents, sortByTimeDesc } from '../lib/normalize.js';
import { annotateNear } from '../lib/geocode.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_AGE_HOURS = 30 * 24;

// Cross-catalog earthquake dedupe: 90 s / 100 km per the sismos project's
// measured duplicate pairs; alert-vs-catalog copies get 150 km (coarser
// centroids). Cyclones move ~500 km/day between advisories.
const EQ_MERGE = { maxDtMs: 90 * 1000, maxKm: 100 };
const ALERT_EQ_MERGE = { maxDtMs: 90 * 1000, maxKm: 150 };
const CYCLONE_MERGE = { maxDtMs: 72 * 3600 * 1000, maxKm: 500 };

/** Slim wire format: only what the frontend actually renders. */
function slim(e) {
  const s = {
    id: e.id,
    time: e.time,
    title: e.title,
    kind: e.kind,
    lat: Number(e.lat.toFixed(3)),
    lon: Number(e.lon.toFixed(3)),
    source: e.source,
    magnitude: Number(e.magnitude.toFixed(1)),
    tier: e.tier
  };
  if (e.updated && e.updated !== e.time) s.updated = e.updated;
  if (e.continent) s.continent = e.continent;
  if (e.country) s.country = e.country;
  if (e.cc) s.cc = e.cc;
  if (e.url) s.url = e.url;
  if (e.alert) s.alert = e.alert;
  if (e.severity && e.severity.text) s.severity = { text: e.severity.text };
  if (e.nearData) {
    s.nearData = { ...e.nearData, distKm: Math.round(e.nearData.distKm) };
  }
  if (e.details) s.details = e.details;
  if (e.area) s.area = e.area;
  if (e.starts) s.starts = e.starts;
  if (e.ends) s.ends = e.ends;
  if (e.eventName) s.eventName = e.eventName;
  return s;
}

async function settle(fetchers) {
  const results = await Promise.allSettled(fetchers.map(([, fn]) => fn()));
  const out = {};
  const errors = [];
  results.forEach((r, i) => {
    const name = fetchers[i][0];
    if (r.status === 'fulfilled') out[name] = filterByTimeWindow(r.value, MAX_AGE_HOURS);
    else errors.push(`${name}: ${r.reason?.message}`);
  });
  if (!Object.keys(out).length) throw new Error(`all sources failed: ${errors.join('; ')}`);
  return { out, errors };
}

// Quake pipeline: locals win over globals.
async function loadQuakes() {
  const { out, errors } = await settle([
    ['inpres', fetchInpres],
    ['csn', fetchCsn],
    ['usgs', fetchUsgs],
    ['emsc', fetchEmsc24h]
  ]);
  const local = mergeEvents(out.inpres || [], out.csn || [], EQ_MERGE);
  const global =
    out.usgs && out.emsc ? mergeEvents(out.usgs, out.emsc, EQ_MERGE) : out.usgs || out.emsc || [];
  return { events: mergeEvents(local, global, EQ_MERGE), errors };
}

// Official alert-graded feeds: GDACS first (best magnitude signal), NHC
// fills unlisted cyclones, then the national/regional warning systems.
async function loadAlerts() {
  const { out, errors } = await settle([
    ['gdacs', fetchGdacs],
    ['nhc', fetchNhc],
    ['smn', fetchSmn],
    ['meteoalarm', fetchMeteoalarm],
    ['swic', fetchSwic]
  ]);
  let merged = out.gdacs || [];
  if (out.nhc) merged = mergeEvents(merged, out.nhc, CYCLONE_MERGE);
  if (out.smn) merged = mergeEvents(merged, out.smn);
  if (out.meteoalarm) merged = mergeEvents(merged, out.meteoalarm);
  if (out.swic) merged = mergeEvents(merged, out.swic);
  return { events: merged, errors };
}

// Satellite/observatory nature feeds: EONET incidents, then FIRMS clusters
// fill the wildfire gaps outside the US.
async function loadNature() {
  const { out, errors } = await settle([
    ['eonet', fetchEonet],
    ['firms', fetchFirms]
  ]);
  const merged = mergeEvents(out.eonet || [], out.firms || []);
  return { events: merged, errors };
}

const LOADERS = { quakes: loadQuakes, alerts: loadAlerts, nature: loadNature };

// One cache entry per group; `all` composes the cached groups.
const cache = new Map();

async function groupPayload(group) {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  const { events, errors } = await LOADERS[group]();
  annotateNear(events);
  const sorted = sortByTimeDesc(events).map(slim);
  const counts = {};
  for (const e of sorted) counts[e.source] = (counts[e.source] || 0) + 1;
  const payload = {
    updatedAt: new Date().toISOString(),
    group,
    sourceCounts: counts,
    ...(errors.length ? { errors } : {}),
    count: sorted.length,
    events: sorted
  };
  cache.set(group, { payload, at: Date.now() });
  return payload;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url, 'http://localhost');
  const group = url.searchParams.get('group') || 'all';
  if (group !== 'all' && !LOADERS[group]) {
    return res.status(400).json({ error: 'invalid_group' });
  }

  try {
    if (group !== 'all') {
      const payload = await groupPayload(group);
      res.setHeader('Cache-Control', 'max-age=60, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(payload);
    }

    // Compatibility shape: the three groups with cross-group dedupe.
    const settled = await Promise.allSettled([
      groupPayload('alerts'),
      groupPayload('quakes'),
      groupPayload('nature')
    ]);
    const [alerts, quakes, nature] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (!alerts && !quakes && !nature) throw new Error('all groups failed');

    let merged = (alerts && alerts.events) || [];
    merged = mergeEvents(merged, (quakes && quakes.events) || [], ALERT_EQ_MERGE);
    merged = mergeEvents(merged, (nature && nature.events) || []);

    const counts = {};
    for (const e of merged) counts[e.source] = (counts[e.source] || 0) + 1;
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      sourceCounts: counts,
      count: merged.length,
      events: merged
    });
  } catch (err) {
    const stale = cache.get(group === 'all' ? 'alerts' : group);
    if (stale) {
      res.setHeader('Cache-Control', 'max-age=60, s-maxage=300');
      return res.status(200).json({ ...stale.payload, stale: true });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
