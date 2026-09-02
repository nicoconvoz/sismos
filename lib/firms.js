// NASA FIRMS (Fire Information for Resource Management System) adapter.
//
// The keyless global 24h MODIS CSV carries ~40k raw satellite fire pixels —
// far too granular for the map, and heavily biased toward agricultural
// burns. The adapter clusters pixels on a 0.5° grid (8-neighbor union) into
// fire EVENTS, weights the centroid by FRP (fire radiative power, MW), and
// keeps only significant clusters. This is what fills the wildfire gap that
// EONET leaves outside the US (its incident feed is IRWIN, a US system):
// the Amazon, the Chaco, Australia, Siberia.

import { makeEvent, sortByTimeDesc } from './normalize.js';
import { logScale } from './magnitude.js';

export const FIRMS_MODIS_URL =
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv';

const CELL_DEG = 0.5;
const MIN_CONFIDENCE = 50; // MODIS numeric scale; VIIRS text handled below
const MIN_PIXELS = 3; // keep clusters with >= 3 detections…
const MIN_FRP_MW = 100; // …or a single strong source (gas flare, crown fire)
const FRP_ANCHORS = { v0: 50, m0: 2.2, v1: 50000, m1: 6.8 };

/** Accept MODIS numeric confidence (>= 50) and VIIRS nominal/high. */
function confidentEnough(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n >= MIN_CONFIDENCE;
  const s = String(value || '').toLowerCase();
  return s === 'nominal' || s === 'high' || s === 'n' || s === 'h';
}

function acqIso(date, time) {
  const t = String(time || '0').padStart(4, '0');
  const d = new Date(`${date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Union-find over occupied grid cells ----------------------------------

function findRoot(parent, key) {
  let k = key;
  while (parent.get(k) !== k) {
    parent.set(k, parent.get(parent.get(k))); // path halving
    k = parent.get(k);
  }
  return k;
}

function union(parent, a, b) {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) parent.set(rb, ra);
}

/**
 * Parse + cluster a FIRMS active-fire CSV into wildfire events.
 * Pure function — safe for fixture-based tests.
 */
export function parseFirmsCsv(csv) {
  if (!csv || typeof csv !== 'string') return [];
  const lines = csv.split('\n');
  const header = (lines[0] || '').trim().split(',');
  const col = (name) => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iConf = col('confidence');
  const iFrp = col('frp');
  if (iLat < 0 || iLon < 0 || iDate < 0 || iFrp < 0) return [];

  // Bucket confident pixels into grid cells.
  const cells = new Map(); // key -> { pixels: [{lat,lon,frp,date}], latC, lonC }
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < header.length) continue;
    if (!confidentEnough(parts[iConf])) continue;
    const lat = Number(parts[iLat]);
    const lon = Number(parts[iLon]);
    const frp = Number(parts[iFrp]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(frp) || frp <= 0) continue;
    const date = acqIso(parts[iDate], parts[iTime]);
    if (!date) continue;
    const latC = Math.floor(lat / CELL_DEG);
    const lonC = Math.floor(lon / CELL_DEG);
    const key = `${latC}_${lonC}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { pixels: [], latC, lonC }));
    cell.pixels.push({ lat, lon, frp, date });
  }

  // Union each occupied cell with its occupied 8-neighbors.
  const parent = new Map();
  for (const key of cells.keys()) parent.set(key, key);
  for (const { latC, lonC } of cells.values()) {
    const key = `${latC}_${lonC}`;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const nk = `${latC + dy}_${lonC + dx}`;
        if (cells.has(nk)) union(parent, key, nk);
      }
    }
  }

  // Aggregate pixels per cluster root.
  const clusters = new Map();
  for (const [key, cell] of cells) {
    const root = findRoot(parent, key);
    let c = clusters.get(root);
    if (!c) clusters.set(root, (c = { pixels: [], anchor: root }));
    c.pixels.push(...cell.pixels);
    // Stable id anchor: lexicographically smallest member cell.
    if (key < c.anchor) c.anchor = key;
  }

  const events = [];
  for (const { pixels, anchor } of clusters.values()) {
    const sumFrp = pixels.reduce((s, p) => s + p.frp, 0);
    if (pixels.length < MIN_PIXELS && sumFrp < MIN_FRP_MW) continue;
    let lat = 0;
    let lon = 0;
    let latest = pixels[0].date;
    for (const p of pixels) {
      lat += p.lat * p.frp;
      lon += p.lon * p.frp;
      if (p.date > latest) latest = p.date;
    }
    const frpRounded = Math.round(sumFrp);
    const event = makeEvent({
      id: `firms-${anchor}`,
      time: latest.toISOString(),
      title: 'Active fire (FIRMS)',
      kind: 'wildfire',
      lat: lat / sumFrp,
      lon: lon / sumFrp,
      source: 'firms',
      url: 'https://firms.modaps.eosdis.nasa.gov/map/',
      severity: {
        value: frpRounded,
        unit: 'MW',
        text: `${pixels.length} px, ${frpRounded} MW`
      },
      magnitude: logScale(sumFrp, FRP_ANCHORS)
    });
    if (event) events.push(event);
  }
  return sortByTimeDesc(events);
}

/** Fetch + cluster the keyless global 24h MODIS active-fire CSV. */
export async function fetchFirms() {
  const res = await fetch(FIRMS_MODIS_URL, { headers: { Accept: 'text/csv' } });
  if (!res.ok) throw new Error(`FIRMS fetch failed: ${res.status}`);
  return parseFirmsCsv(await res.text());
}
