// GET /api/news?q=...&gl=CL&hl=es — zone press coverage for one event,
// proxied from Google News RSS (no CORS there, and the browser must never
// call upstream feeds directly). Parameters are strictly validated so this
// cannot be used as an open proxy: the upstream host is fixed and q/gl/hl
// are shape-checked.

import { fetchZoneNews, buildNewsQuery, editionFor, zoneLang, countryNameFor } from '../lib/news.js';

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

  // The viewer's language drives the search wording and the edition; the
  // event country only wins when its press speaks that same language.
  const { gl, hl } = editionFor(lang, cc || null);
  // Local press knows the town; foreign-language press covers the COUNTRY —
  // "inundación Panautī" finds nothing in Spanish, "inundación Nepal" does.
  const localPress = Boolean(cc) && zoneLang(cc) === lang;
  const placeTerm = localPress ? place : countryNameFor(cc, lang) || place;
  const q = buildNewsQuery({ kind, place: placeTerm, hl: lang });
  if (q.length < 2 || q.length > 120) {
    return res.status(400).json({ error: 'invalid_query' });
  }

  const key = `${q}|${gl}|${hl}`;
  const cached = getCached(key);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(cached);
  }

  try {
    const items = (await fetchZoneNews({ q, gl, hl })).slice(0, MAX_ITEMS);
    const payload = { updatedAt: new Date().toISOString(), q, gl, hl, count: items.length, items };
    setCached(key, payload);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(payload);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
