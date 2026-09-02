// Zone news via Bing News RSS — keyless, per-market editions, and (unlike
// Google News, whose links are opaque JS redirects behind X-Frame-Options)
// each item carries the DIRECT publisher URL inside its apiclick link, so
// articles can open inside the app's own reader modal. The browser never
// calls Bing directly; api/news.js proxies and caches.

import { kindName } from '../public/i18n.js';

export const BING_BASE = 'https://www.bing.com/news/search';

/** Bing News RSS search URL for a query in a market edition. */
export function buildNewsRssUrl({ q, mkt }) {
  return `${BING_BASE}?q=${encodeURIComponent(q)}&format=RSS&setmkt=${encodeURIComponent(mkt)}`;
}

// Primary press language per country (ISO2). Coarse on purpose: unknown
// countries read best in English.
const ZONE_LANG = {
  AR: 'es', BO: 'es', CL: 'es', CO: 'es', CR: 'es', CU: 'es', DO: 'es',
  EC: 'es', ES: 'es', GT: 'es', HN: 'es', MX: 'es', NI: 'es', PA: 'es',
  PE: 'es', PY: 'es', SV: 'es', UY: 'es', VE: 'es',
  BR: 'pt', PT: 'pt',
  FR: 'fr', BE: 'fr', SN: 'fr', CI: 'fr', CD: 'fr', HT: 'fr', MG: 'fr',
  DE: 'de', AT: 'de', CH: 'de',
  IT: 'it', JP: 'ja', KR: 'ko', CN: 'zh-CN', TW: 'zh-TW', RU: 'ru',
  TR: 'tr', GR: 'el', ID: 'id', TH: 'th', VN: 'vi', PL: 'pl', NL: 'nl',
  SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', UA: 'uk', RO: 'ro', HU: 'hu',
  CZ: 'cs', IL: 'he', SA: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar',
  IQ: 'ar', SY: 'ar', YE: 'ar', LY: 'ar', JO: 'ar', LB: 'ar',
  IR: 'fa', AF: 'fa', PK: 'ur', BD: 'bn', IN: 'en', NP: 'ne', LK: 'si',
  MM: 'my', KH: 'km', ET: 'am'
};

/** Local press language for a country code; English when unknown. */
export function zoneLang(cc) {
  return ZONE_LANG[String(cc || '').toUpperCase()] || 'en';
}

/**
 * Search phrase in the target language: the localized kind word (from the
 * shared i18n dictionaries, English for unsupported languages) plus the
 * place name. Chilean papers write "sismo", not "earthquake".
 */
export function buildNewsQuery({ kind, place, hl }) {
  const base = String(hl || 'en').split('-')[0];
  const word = kindName(kind, base).toLowerCase();
  return [word, String(place || '').trim()].filter(Boolean).join(' ');
}

/** Country name localized to the query language; null without a code. */
export function countryNameFor(cc, lang) {
  if (!cc) return null;
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(String(cc).toUpperCase()) || null;
  } catch {
    return null;
  }
}

// Default Bing market per viewer language.
const VIEWER_MKT = { es: 'es-AR', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE' };

/**
 * Which Bing News market to read for a viewer language + event country:
 * when the zone's press language matches the viewer's, use the ZONE market
 * (local papers of the place it happened); otherwise the viewer-language
 * market — a Spanish reader never gets English results for a Nepal flood.
 */
export function editionFor(viewerLang, eventCc) {
  const supported = Boolean(VIEWER_MKT[viewerLang]);
  if (eventCc && supported && zoneLang(eventCc) === viewerLang) {
    return { mkt: `${viewerLang}-${String(eventCc).toUpperCase()}` };
  }
  return { mkt: VIEWER_MKT[viewerLang] || VIEWER_MKT.en };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);
}

/**
 * Bing wraps every result in an apiclick.aspx tracker whose `url` query
 * param holds the real publisher URL. Unwrap it; pass direct links through.
 */
function unwrapBingLink(link) {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/.test(u.hostname)) {
      const target = u.searchParams.get('url');
      if (target && /^https?:\/\//.test(target)) return target;
    }
    return link;
  } catch {
    return null;
  }
}

function tagValue(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim()) : null;
}

/**
 * Parse a Bing News RSS document into { title, link, source, pubDate }
 * items with direct publisher links, newest first. Pure function — safe for
 * fixture-based tests.
 */
export function parseNewsRss(xml) {
  if (!xml || typeof xml !== 'string' || !xml.includes('<item>')) return [];
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const title = tagValue(item, 'title');
    const rawLink = tagValue(item, 'link');
    const pubDate = tagValue(item, 'pubDate');
    if (!title || !rawLink) continue;
    const link = unwrapBingLink(rawLink);
    if (!link || !/^https?:\/\//.test(link)) continue;
    if (!pubDate || Number.isNaN(Date.parse(pubDate))) continue;
    items.push({
      title,
      link,
      pubDate: new Date(pubDate).toISOString(),
      source: tagValue(item, 'News:Source') || tagValue(item, 'source') || null
    });
  }
  return items.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

/**
 * Clean proper name of a named phenomenon for searching: agencies write
 * "KARINA-26"; the press writes "Karina". Null when unnamed.
 */
export function properNameKeyword(eventName) {
  const m = /\p{L}+/u.exec(String(eventName || ''));
  if (!m) return null;
  const w = m[0].toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Accent-insensitive lowercase fold for keyword matching. */
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Keep only items whose TITLE mentions at least one keyword (accent- and
 * case-insensitive). This is what separates cyclone Karina's coverage from
 * cyclone Edouard's — and from a football team nicknamed "Ciclón". An empty
 * keyword list filters nothing.
 */
export function filterByKeyword(items, keywords) {
  const keys = (keywords || []).filter(Boolean).map(fold);
  if (!keys.length) return items;
  return items.filter((it) => {
    const title = fold(it.title);
    return keys.some((k) => title.includes(k));
  });
}

const SINCE_MARGIN_MS = 6 * 3600 * 1000;

/**
 * Keep only items published after the event started (minus a small margin
 * for publisher timezone slop), so coverage of an EARLIER similar event in
 * the same place never mixes in. Invalid/missing `since` filters nothing —
 * better too much news than a silently empty list.
 */
export function filterBySince(items, sinceIso, marginMs = SINCE_MARGIN_MS) {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return items;
  return items.filter((it) => Date.parse(it.pubDate) >= since - marginMs);
}

/**
 * Whether response headers forbid embedding the page in an iframe:
 * X-Frame-Options DENY/SAMEORIGIN, or a CSP frame-ancestors directive that
 * does not allow everyone. `headers` is any Map-like with get().
 */
export function frameBlocked(headers) {
  const xfo = String(headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;
  const csp = String(headers.get('content-security-policy') || '').toLowerCase();
  const m = /frame-ancestors([^;]*)/.exec(csp);
  if (m && !m[1].includes('*')) return true;
  return false;
}

/**
 * Probe whether an article URL can load inside our iframe. HEAD first
 * (cheap), falling back to GET for servers that reject HEAD. Network
 * failures report as embeddable — the iframe attempt is then the real test.
 */
export async function checkEmbeddable(url) {
  const opts = { redirect: 'follow', headers: { Accept: 'text/html' } };
  let res;
  try {
    res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status === 405 || res.status === 501) throw new Error('HEAD unsupported');
  } catch {
    res = await fetch(url, opts);
  }
  return { embeddable: !frameBlocked(res.headers), finalUrl: res.url || url };
}

/** Fetch + parse zone news for a query in a market. */
export async function fetchZoneNews({ q, mkt }) {
  const res = await fetch(buildNewsRssUrl({ q, mkt }), {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' }
  });
  if (!res.ok) throw new Error(`Bing News fetch failed: ${res.status}`);
  return parseNewsRss(await res.text());
}
