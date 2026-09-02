// SMN Argentina (Servicio Meteorológico Nacional) adapter — official
// weather warnings as WMO-standard CAP XML: zonda winds, snowfalls, heat
// and cold waves, storms. The JSON API (ws.smn.gob.ar) sits behind a
// Cloudflare challenge, but the public CAP index on ssl.smn.gob.ar serves
// plain XML with REAL polygons per alert — the centroid geolocates each
// warning. Keyless.

import { makeEvent } from './normalize.js';
import { alertMagnitude } from './magnitude.js';

export const SMN_INDEX_URL = 'https://ssl.smn.gob.ar/CAP/AR.php';

const MAX_CAP_FILES = 40;

/**
 * CAP file URLs out of the index, deduped, order preserved. The endpoint
 * content-negotiates unpredictably — browsers get HTML (href="..."), other
 * agents an RSS whose <link> tags carry the same URLs — so match the URL
 * shape itself rather than either wrapper.
 */
export function parseSmnIndex(html) {
  if (!html || typeof html !== 'string') return [];
  const urls = [];
  const seen = new Set();
  const re = /https:\/\/ssl\.smn\.gob\.ar\/[^\s"'<>]+\.xml/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // The index references XSL stylesheets too; only CAP files count.
    if (!m[0].includes('/CAP/') && !m[0].includes('xml_generados')) continue;
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      urls.push(m[0]);
    }
  }
  return urls;
}

/** Kind from the SMN event wording; generic weather alerts read as storms. */
export function smnKindOf(eventText) {
  const s = String(eventText || '').toLowerCase();
  if (/zonda|viento/.test(s)) return 'wind';
  if (/niev|nevada/.test(s)) return 'snow';
  if (/calor/.test(s)) return 'heat';
  if (/fr[ií]o/.test(s)) return 'cold';
  if (/granizo/.test(s)) return 'hail';
  return 'storm';
}

// CAP severity -> our alert bands (SMN uses Minor/Moderate/Severe/Extreme).
const CAP_ALERT = { minor: 'green', moderate: 'yellow', severe: 'orange', extreme: 'red' };

function tagValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/** Numeric-entity decode (CAP escapes accents as &#xE1; etc.). */
function decodeXml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

/**
 * Parse one CAP alert XML into the shared event shape, or null when the
 * alert is malformed or already expired at `now`. The polygon centroid is
 * the event location; the SENT time is the event time (onset may be in the
 * future — warnings are forecasts). The CAP's <areaDesc> ships empty, but
 * the FILE NAME carries the official SMN zone (CAP_..._Nevada_Cordillera_…),
 * exposed as `area`.
 */
export function parseSmnCap(xml, now = Date.now(), url = null) {
  if (!xml || typeof xml !== 'string' || !xml.includes('<alert')) return null;

  const expires = tagValue(xml, 'expires');
  if (expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) < now) return null;

  const polygon = tagValue(xml, 'polygon');
  if (!polygon) return null;
  let latSum = 0;
  let lonSum = 0;
  let count = 0;
  for (const pair of polygon.split(/\s+/)) {
    const [lat, lon] = pair.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      latSum += lat;
      lonSum += lon;
      count++;
    }
  }
  if (!count) return null;

  const eventText = decodeXml(tagValue(xml, 'event') || '');
  const severity = String(tagValue(xml, 'severity') || '').toLowerCase();
  const alert = CAP_ALERT[severity] || 'yellow';
  const headline = decodeXml(tagValue(xml, 'headline') || eventText);
  const onset = tagValue(xml, 'onset');
  const identifier = tagValue(xml, 'identifier');
  const sent = tagValue(xml, 'sent');
  const time = sent && Number.isFinite(Date.parse(sent)) ? new Date(sent).toISOString() : null;
  // The forecaster's prose carries the event-specific numbers — wind
  // direction and gust speeds, expected snowfall, temperatures.
  const details = decodeXml(tagValue(xml, 'description') || '').trim().slice(0, 600);

  const event = makeEvent({
    id: identifier ? `smn-${identifier.replace(/[^\w.]/g, '')}` : null,
    time,
    title: headline || 'Alerta SMN',
    kind: smnKindOf(eventText),
    lat: latSum / count,
    lon: lonSum / count,
    country: 'Argentina',
    cc: 'AR',
    source: 'smn',
    url: 'https://www.smn.gob.ar/alertas',
    alert,
    severity: {
      value: null,
      unit: '',
      text: onset ? `${eventText} · desde ${onset.slice(0, 16).replace('T', ' ')}` : eventText
    },
    magnitude: alertMagnitude(alert)
  });
  if (event && details) event.details = details;
  if (event) {
    // Validity window: the map renders warnings at full strength while the
    // phenomenon has not started yet (onset is a forecast, not the past).
    if (onset && Number.isFinite(Date.parse(onset))) event.starts = new Date(onset).toISOString();
    if (expires && Number.isFinite(Date.parse(expires))) event.ends = new Date(expires).toISOString();
  }
  if (event && url) {
    const zone = /CAP_\d+_[A-Za-z]+_([A-Za-z]+)_/.exec(url);
    if (zone) event.area = zone[1];
  }
  return event;
}

/** Fetch the index + every current CAP alert, skipping broken files. */
export async function fetchSmn() {
  const res = await fetch(SMN_INDEX_URL, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`SMN index fetch failed: ${res.status}`);
  const urls = parseSmnIndex(await res.text()).slice(0, MAX_CAP_FILES);
  const results = await Promise.allSettled(
    urls.map((u) => fetch(u).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))))
  );
  const now = Date.now();
  const events = [];
  const seen = new Set();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled') continue;
    const e = parseSmnCap(r.value, now, urls[i]);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      events.push(e);
    }
  }
  return events;
}
