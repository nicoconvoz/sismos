// VolcanoDiscovery HTML scraping + parsing.
//
// Observations from probing the real pages (2026-08-26):
// - https://www.volcanodiscovery.com/es/terremotos/hoy.html returns 200 to a
//   plain curl with a browser User-Agent (it sits behind Cloudflare but did
//   not challenge server-side fetches at probe time).
// - The page server-renders only ~9 recent rows (magnitude >= 3.5) inside
//   <table id="qTable">, as `<tr id="quake-<id>" data-time=<unix> data-mag=..
//   data-dep=..>` rows. Exact coordinates ARE present, embedded in the map
//   cell as `openPopup(lat,lon,id)`. The rest of the advertised list
//   (~144 of ~1100 quakes) is loaded client-side by the QuakeTable JS class,
//   with no stable public JSON endpoint we could find (getQuakeMeter.php is a
//   gauge widget, getLatest.php only returns deltas since a timestamp).
// - A second table on the page, <table id="qTableLargest">, lists the LARGEST
//   QUAKES EVER RECORDED (e.g. Valdivia 1960 M9.5) — it must be excluded from
//   the "last 24 hours" result, which parseHoyQuakes does by slicing the HTML
//   and by letting callers time-filter.
// - https://www.volcanodiscovery.com/es/sismos/daninos.html server-renders
//   the FULL damaging-quakes list (~39 rows spanning the current and previous
//   year) as `<tr data-id=<id> data-mag=..>` rows with exact 5-decimal
//   coordinates in `openPopup(...)`, a country flag (title attr), a region
//   cell and a detail link `sismos/<id>/<date>/<time>/<slug>.html`.
//
// Because the hoy page only exposes a handful of quakes server-side, the
// /api/quakes endpoint treats VolcanoDiscovery as primary but falls back to
// USGS when the parsed count is too small to be useful (see api/quakes.js).

import { makeQuake, sortByTimeDesc, dedupeById } from './normalize.js';

export const VD_HOY_URL = 'https://www.volcanodiscovery.com/es/terremotos/hoy.html';
export const VD_DAMAGING_URL = 'https://www.volcanodiscovery.com/es/sismos/daninos.html';
const VD_BASE = 'https://www.volcanodiscovery.com/es/';
const VD_DETAIL_FALLBACK = 'https://www.volcanoesandearthquakes.com/app/earthquake-report.php?quakeId=';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9',
  Accept: 'text/html,application/xhtml+xml'
};

/** Decode the handful of HTML entities that appear in VD markup. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;|&emsp;|&ensp;|&thinsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Strip HTML tags and collapse whitespace. */
function textContent(htmlFragment) {
  return decodeEntities(htmlFragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the last-24h quake rows from the "hoy" page HTML.
 * Only rows from the main <table id="qTable"> section are considered; the
 * "largest quakes ever" table further down the page is excluded.
 * Pure function — safe for fixture-based tests.
 */
export function parseHoyQuakes(html) {
  const start = html.indexOf('id="qTable"');
  if (start === -1) return [];
  let section = html.slice(start);
  // Cut before the all-time-largest table / archive selector.
  for (const marker of ['id="archiveSelect"', 'id="qTableLargest"']) {
    const cut = section.indexOf(marker);
    if (cut !== -1) section = section.slice(0, cut);
  }

  const quakes = [];
  const rowRe = /<tr id="quake-(\d+)"([^>]*)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const [, id, attrs, body] = m;
    const time = attrs.match(/data-time=(-?\d+)/);
    const mag = attrs.match(/data-mag=([\d.]+)/);
    const dep = attrs.match(/data-dep=([\d.]+)/);
    const coords = body.match(/openPopup\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (!time || !mag || !coords) continue;

    const regionCell = body.match(/<td class="list_region"[^>]*>([\s\S]*?)<\/td>/);
    let place = '';
    if (regionCell) {
      // Drop the "Lo sentí" felt-report link before extracting text.
      place = textContent(regionCell[1].replace(/<a[^>]*mkRep\([\s\S]*?<\/a>/g, ''))
        .replace(/[,\s]+$/, '');
    }

    const quake = makeQuake({
      id,
      time: new Date(Number(time[1]) * 1000).toISOString(),
      magnitude: mag[1],
      depthKm: dep ? dep[1] : null,
      place,
      lat: coords[1],
      lon: coords[2],
      exactCoords: true, // coordinates come embedded in the page markup
      source: 'volcanodiscovery',
      url: VD_DETAIL_FALLBACK + id
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(dedupeById(quakes));
}

/**
 * Parse the damaging-quakes table from the "daninos" page HTML.
 * Returns quakes for ALL listed years; callers filter to the current year.
 * Pure function — safe for fixture-based tests.
 */
export function parseDamagingQuakes(html) {
  const quakes = [];
  const rowRe = /<tr data-id=(\d+) data-mag=([\d.]+)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const [, id, mag, body] = m;
    const time = body.match(/data-sort="(-?\d+)"/);
    const coords = body.match(/openPopup\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (!time || !coords) continue;

    const country = body.match(/<img[^>]*title="([^"]+)"[^>]*\/>\s*(?:&nbsp;)?\s*<a/);
    const regionCell = body.match(/<td class="wrap"[^>]*>([\s\S]*?)<\/td>/);
    const region = regionCell ? textContent(regionCell[1]) : '';
    const detail = body.match(/href="(sismos\/\d+\/[^"]+)"/);

    const placeParts = [region, country ? country[1] : null].filter(Boolean);

    const quake = makeQuake({
      id,
      time: new Date(Number(time[1]) * 1000).toISOString(),
      magnitude: mag,
      depthKm: null, // the damaging table has no depth column
      place: placeParts.join(', '),
      lat: coords[1],
      lon: coords[2],
      exactCoords: true,
      source: 'volcanodiscovery',
      url: detail ? VD_BASE + detail[1] : VD_DETAIL_FALLBACK + id,
      damaging: true
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(dedupeById(quakes));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`VolcanoDiscovery fetch failed: ${res.status} ${url}`);
  return res.text();
}

/** Fetch + parse the last-24h quakes from VolcanoDiscovery. */
export async function fetchHoyQuakes() {
  return parseHoyQuakes(await fetchHtml(VD_HOY_URL));
}

/** Fetch + parse the damaging quakes list from VolcanoDiscovery. */
export async function fetchDamagingQuakes() {
  return parseDamagingQuakes(await fetchHtml(VD_DAMAGING_URL));
}
