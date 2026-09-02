// GET /api/news?q=...&gl=CL&hl=es — zone press coverage for one event,
// proxied from Google News RSS (no CORS there, and the browser must never
// call upstream feeds directly). Parameters are strictly validated so this
// cannot be used as an open proxy: the upstream host is fixed and q/gl/hl
// are shape-checked.

import {
  fetchZoneNews,
  buildNewsQuery,
  editionFor,
  zoneLang,
  countryNameFor,
  filterBySince,
  filterByKeyword,
  properNameKeyword
} from '../lib/news.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_ITEMS = 30;

// Module-level LRU-ish cache: one entry per distinct query.
const cache = new Map();

function getCached(key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.payload;
}

function setCached(key, payload) {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { payload, at: Date.now() });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url, 'http://localhost');
  const kind = (url.searchParams.get('kind') || '').trim().toLowerCase();
  const place = (url.searchParams.get('place') || '').trim();
  const cc = (url.searchParams.get('cc') || '').toUpperCase();
  const lang = (url.searchParams.get('lang') || 'en').toLowerCase();
  // Event start time: only coverage published from then on is relevant —
  // otherwise a past disaster in the same place pollutes the list.
  const sinceRaw = (url.searchParams.get('since') || '').slice(0, 40);
  const since = Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  // Proper name of a named phenomenon (cyclones): "KARINA-26" -> "Karina".
  const nameRaw = (url.searchParams.get('name') || '').slice(0, 40);
  const properName = /^[\p{L}\d\s-]*$/u.test(nameRaw) ? properNameKeyword(nameRaw) : null;

  if (!/^[a-z]{2,24}$/.test(kind)) {
    return res.status(400).json({ error: 'invalid_kind' });
  }
  if (place.length > 80 || /[<>]/.test(place)) {
    return res.status(400).json({ error: 'invalid_place' });
  }
  if (cc && !/^[A-Z]{2}$/.test(cc)) {
    return res.status(400).json({ error: 'invalid_country' });
  }
  if (!/^[a-z]{2}$/.test(lang)) {
    return res.status(400).json({ error: 'invalid_language' });
  }

  // The viewer's language drives the search wording and the market; the
  // event country only wins when its press speaks that same language.
  const { mkt } = editionFor(lang, cc || null);
  // Named phenomena search by their proper name ("ciclón Karina") — the
  // country would mix in every other storm of the season. Unnamed events:
  // local press knows the town; foreign-language press covers the COUNTRY —
  // "inundación Panautī" finds nothing in Spanish, "inundación Nepal" does.
  const localPress = Boolean(cc) && zoneLang(cc) === lang;
  const placeTerm = localPress ? place : countryNameFor(cc, lang) || place;
  const q = buildNewsQuery({ kind, place: properName || placeTerm, hl: lang });
  // Relevance gate: the keyword must appear in each article's TITLE —
  // the storm's name, or the place/country for unnamed events.
  const keywords = properName ? [properName] : [place, countryNameFor(cc, lang)];
  if (q.length < 2 || q.length > 120) {
    return res.status(400).json({ error: 'invalid_query' });
  }

  // Cached payloads are post-filter, so every filter input keys the cache.
  const key = `${q}|${mkt}|${since || ''}|${place}|${properName || ''}`;
  const cached = getCached(key);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(cached);
  }

  try {
    const items = filterByKeyword(filterBySince(await fetchZoneNews({ q, mkt }), since), keywords)
      .slice(0, MAX_ITEMS);
    const payload = { updatedAt: new Date().toISOString(), q, mkt, since, count: items.length, items };
    setCached(key, payload);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(payload);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
