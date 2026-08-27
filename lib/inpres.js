// INPRES (Instituto Nacional de Prevención Sísmica, Argentina).
//
// Probe notes (2026-08-27): the desktop site (https://www.inpres.gob.ar/desktop/)
// renders its "últimos sismos" table client-side from an XML feed the page
// loads via XHR: https://www.inpres.gob.ar/mapa/sismos.xml (fetched fine
// server-side with a browser UA; TLS needed no special handling via fetch).
// Each <item> carries idSismo, fecha (DD/MM, LOCAL date, no year!), hora
// (HH:MM local Argentina, UTC-3), latitud, longitud, prof (km), mg, prov and
// a link "../mapa/<idSismo>".
//
// Time handling: idSismo itself encodes the UTC timestamp as YYYYMMDDHHMMSS —
// verified against the local fecha/hora columns (e.g. idSismo 20260827123841
// <-> hora local 09:38 = 12:38:41 UTC, and a midnight-crossing row fecha
// 26/08 23:53 local <-> idSismo 20260827025336). We therefore take UTC from
// idSismo (it also has seconds, which fecha/hora lack) and only fall back to
// converting fecha/hora from America/Argentina/Buenos_Aires when idSismo is
// malformed.

import { makeQuake, sortByTimeDesc, dedupeById, titleCaseRegion, localTimeToUtc } from './normalize.js';

export const INPRES_XML_URL = 'https://www.inpres.gob.ar/mapa/sismos.xml';
const INPRES_BASE = 'https://www.inpres.gob.ar';
const AR_TZ = 'America/Argentina/Buenos_Aires';

function tagValue(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
  return m ? m[1].trim() : null;
}

function timeFromIdSismo(idSismo) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(idSismo || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeFromLocalFields(fecha, hora, nowMs) {
  const fm = /^(\d{1,2})\/(\d{1,2})$/.exec(fecha || '');
  const hm = /^(\d{1,2}):(\d{2})$/.exec(hora || '');
  if (!fm || !hm) return null;
  // fecha has no year: assume the current UTC year, stepping back one year if
  // that lands more than a day in the future (year boundary).
  const year = new Date(nowMs).getUTCFullYear();
  let date = localTimeToUtc(
    { year, month: Number(fm[2]), day: Number(fm[1]), hour: Number(hm[1]), minute: Number(hm[2]) },
    AR_TZ
  );
  if (date.getTime() - nowMs > 24 * 3600 * 1000) {
    date = localTimeToUtc(
      { year: year - 1, month: Number(fm[2]), day: Number(fm[1]), hour: Number(hm[1]), minute: Number(hm[2]) },
      AR_TZ
    );
  }
  return date;
}

/**
 * Parse the INPRES sismos.xml feed into the shared quake shape.
 * Pure function — safe for fixture-based tests. `now` only affects the
 * year inference of the no-idSismo fallback path.
 */
export function parseInpresXml(xml, now = Date.now()) {
  if (!xml || !xml.includes('<item>')) return [];
  const quakes = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const idSismo = tagValue(item, 'idSismo');
    const date =
      timeFromIdSismo(idSismo) ||
      timeFromLocalFields(tagValue(item, 'fecha'), tagValue(item, 'hora'), now);
    if (!date) continue;

    const prov = titleCaseRegion(tagValue(item, 'prov') || '');
    const link = (tagValue(item, 'link') || '').replace(/"/g, '');
    const id = idSismo || `${date.getTime()}-${tagValue(item, 'latitud')}`;

    const quake = makeQuake({
      id: `inpres-${id}`,
      time: date.toISOString(),
      magnitude: tagValue(item, 'mg'),
      depthKm: tagValue(item, 'prof'),
      place: prov ? `${prov}, Argentina` : 'Argentina',
      lat: tagValue(item, 'latitud'),
      lon: tagValue(item, 'longitud'),
      exactCoords: true,
      source: 'inpres',
      url: link ? INPRES_BASE + link.replace('..', '') : `${INPRES_BASE}/desktop/`
    });
    if (quake) quakes.push(quake);
  }
  return sortByTimeDesc(dedupeById(quakes));
}

/** Fetch + parse the INPRES latest-quakes XML feed. */
export async function fetchInpres() {
  const res = await fetch(INPRES_XML_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/xml,application/xml'
    }
  });
  if (!res.ok) throw new Error(`INPRES fetch failed: ${res.status}`);
  return parseInpresXml(await res.text());
}
