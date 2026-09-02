// MeteoAlarm adapter — official weather warnings of ~35 European national
// meteorological services, aggregated as CAP JSON, keyless (attribution:
// meteoalarm.org). Warnings geolocate by NUTS region codes; the bundled
// centroid table (lib/data/nuts-centroids.json, built by tools/build-nuts.js
// from every GISCO edition — services emit codes from different NUTS years)
// turns each affected region into one map point. Green/Minor routine
// notices are skipped: only yellow and up carry signal.

import { readFileSync } from 'node:fs';
import { makeEvent } from './normalize.js';
import { alertMagnitude } from './magnitude.js';

export const MA_COUNTRIES = [
  'austria', 'belgium', 'bosnia-herzegovina', 'bulgaria', 'croatia', 'cyprus',
  'czechia', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece',
  'hungary', 'iceland', 'ireland', 'israel', 'italy', 'latvia', 'lithuania',
  'luxembourg', 'malta', 'moldova', 'montenegro', 'netherlands',
  'north-macedonia', 'norway', 'poland', 'portugal', 'romania', 'serbia',
  'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland', 'ukraine',
  'united-kingdom'
];

export function meteoalarmFeedUrl(country) {
  return `https://feeds.meteoalarm.org/api/v1/warnings/feeds-${country}`;
}

let nutsCache = null;

function loadNuts() {
  if (!nutsCache) {
    nutsCache = JSON.parse(
      readFileSync(new URL('./data/nuts-centroids.json', import.meta.url), 'utf-8')
    );
  }
  return nutsCache;
}

/** Kind from the awareness_type parameter ("5; high-temperature"). */
export function maKindOf(awarenessType) {
  const s = String(awarenessType || '').toLowerCase();
  if (s.includes('wind')) return 'wind';
  if (s.includes('snow')) return 'snow';
  if (s.includes('thunder')) return 'storm';
  if (s.includes('fog')) return 'fog';
  if (s.includes('high-temp')) return 'heat';
  if (s.includes('low-temp')) return 'cold';
  if (s.includes('fire')) return 'wildfire';
  if (s.includes('avalanche')) return 'avalanche';
  if (s.includes('flood')) return 'flood';
  return 'storm'; // rain, coastal events, unknown
}

// NUTS country prefixes that differ from ISO2.
const NUTS_CC = { EL: 'GR', UK: 'GB' };

function param(info, name) {
  const p = (info.parameter || []).find((x) => x.valueName === name);
  return p ? p.value : null;
}

/**
 * Parse a MeteoAlarm country feed into events — one per affected NUTS
 * region with a known centroid. Pure function — safe for fixture tests.
 */
export function parseMeteoalarm(feed, now = Date.now()) {
  const warnings = feed && Array.isArray(feed.warnings) ? feed.warnings : [];
  const nuts = loadNuts();
  const events = [];
  for (const w of warnings) {
    const alert = w && w.alert;
    if (!alert || !Array.isArray(alert.info) || !alert.info.length) continue;
    // English info block when present (neutral for kind/level parsing);
    // the local-language description usually matches anyway.
    const info = alert.info.find((i) => String(i.language || '').startsWith('en')) || alert.info[0];

    const expires = info.expires;
    if (expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) < now) continue;

    // awareness_level: "3; orange; Severe" — the color IS the level.
    const levelRaw = String(param(info, 'awareness_level') || '');
    const level = (levelRaw.split(';')[1] || '').trim().toLowerCase();
    if (!['yellow', 'orange', 'red'].includes(level)) continue;

    const kind = maKindOf(param(info, 'awareness_type'));
    const onset = info.onset || info.effective;
    const details = String(info.description || '').trim().slice(0, 600);

    for (const area of info.area || []) {
      const geocode = (area.geocode || []).find((g) => nuts[g.value]);
      if (!geocode) continue;
      const [lat, lon] = nuts[geocode.value];
      const prefix = geocode.value.slice(0, 2).toUpperCase();
      const event = makeEvent({
        id: `ma-${alert.identifier}-${geocode.value}`,
        time: alert.sent || onset || info.expires,
        title: info.event || 'MeteoAlarm',
        kind,
        lat,
        lon,
        cc: NUTS_CC[prefix] || prefix,
        source: 'meteoalarm',
        url: 'https://meteoalarm.org',
        alert: level,
        severity: { value: null, unit: '', text: info.event || '' },
        magnitude: alertMagnitude(level)
      });
      if (!event) continue;
      if (details) event.details = details;
      if (area.areaDesc) event.area = area.areaDesc;
      if (onset && Number.isFinite(Date.parse(onset))) event.starts = new Date(onset).toISOString();
      if (expires && Number.isFinite(Date.parse(expires))) event.ends = new Date(expires).toISOString();
      events.push(event);
    }
  }
  return events;
}

/** Fetch every country feed; any country may fail without breaking the set. */
export async function fetchMeteoalarm() {
  const results = await Promise.allSettled(
    MA_COUNTRIES.map((c) =>
      fetch(meteoalarmFeedUrl(c), { headers: { Accept: 'application/json' } }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      )
    )
  );
  const now = Date.now();
  const events = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const e of parseMeteoalarm(r.value, now)) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        events.push(e);
      }
    }
  }
  return events;
}
