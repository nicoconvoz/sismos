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
  properNameKeyword,
  termLadder
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
  const admin1 = (url.searchParams.get('admin1') || '').trim();
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
  if (place.length > 80 || /[<>]/.test(place) || admin1.length > 80 || /[<>]/.test(admin1)) {
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
  // Search-term ladder: try the most specific term first, then widen until
  // some coverage appears — the press mostly writes at state level ("sismo
  // Oaxaca"), not the nearest village the geocoder names.
  const localPress = Boolean(cc) && zoneLang(cc) === lang;
  const country = countryNameFor(cc, lang);
  const terms = termLadder({ localPress, place, admin1, country, properName });
  if (!terms.length && place) terms.push(place);
  // Relevance gate: the article TITLE must mention the storm's name, or any
  // of the event's location terms (town, state, country).
  const keywords = properName ? [properName] : [place, admin1, country];
  if (!terms.length) {
    return res.status(400).json({ error: 'invalid_query' });
  }

  // Cached payloads are post-filter, so every filter input keys the cache.
  const key = [kind, place, admin1, cc, lang, since || '', properName || '', mkt].join('|');
  const cached = getCached(key);
  if (cached) {
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(cached);
  }

  try {
    // Walk the ladder until a step yields relevant coverage published
    // STRICTLY after the event's own date and time — an article from before
    // the event is necessarily about something else. A very fresh event may
    // legitimately show nothing until the press catches up.
    // Steps accumulate (deduped by link) while results are scarce: a state
    // rung with one article still gets the country rung's coverage added.
    const MIN_ITEMS = 3;
    let items = [];
    let q = null;
    const seen = new Set();
    for (const term of terms) {
      const tq = buildNewsQuery({ kind, place: term, hl: lang });
      if (tq.length < 2 || tq.length > 120) continue;
      if (!q) q = tq;
      const relevant = filterBySince(
        filterByKeyword(await fetchZoneNews({ q: tq, mkt }), keywords),
        since
      );
      for (const it of relevant) {
        if (!seen.has(it.link) && items.length < MAX_ITEMS) {
          seen.add(it.link);
          items.push(it);
        }
      }
      if (items.length) q = tq;
      if (items.length >= MIN_ITEMS) break;
    }
    items.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
    const payload = { updatedAt: new Date().toISOString(), q, mkt, since, count: items.length, items };
    setCached(key, payload);
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(payload);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
