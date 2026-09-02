// Zone news via Google News RSS — keyless, with per-country editions, so an
// event's coverage comes from the digital press of the place where it
// happened. The browser never calls Google directly (no CORS there anyway);
// api/news.js proxies and caches. X (Twitter) killed public RSS years ago
// and scrape mirrors are unstable, so comments link out to X's own live
// search instead of pretending an RSS exists.

export const GNEWS_BASE = 'https://news.google.com/rss/search';

/** Google News RSS search URL for a query in a country edition + language. */
export function buildNewsRssUrl({ q, gl, hl }) {
  const p = new URLSearchParams();
  p.set('q', q);
  p.set('hl', hl);
  p.set('gl', gl);
  p.set('ceid', `${gl}:${hl}`);
  // URLSearchParams uses '+' for spaces; normalize to %20 for stable URLs.
  return `${GNEWS_BASE}?${p.toString().replace(/\+/g, '%20')}`;
}

// Primary press language per country (ISO2). Coarse on purpose: Google News
// falls back gracefully, and unknown countries read best in English.
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

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };

function decodeEntities(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]);
}

function tagValue(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim()) : null;
}

/**
 * Parse a Google News RSS document into { title, link, source, pubDate }
 * items, newest first. Pure function — safe for fixture-based tests.
 */
export function parseNewsRss(xml) {
  if (!xml || typeof xml !== 'string' || !xml.includes('<item>')) return [];
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const title = tagValue(item, 'title');
    const link = tagValue(item, 'link');
    const pubDate = tagValue(item, 'pubDate');
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    if (!pubDate || Number.isNaN(Date.parse(pubDate))) continue;
    items.push({
      title,
      link,
      pubDate: new Date(pubDate).toISOString(),
      source: tagValue(item, 'source') || null
    });
  }
  return items.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

import { kindName } from '../public/i18n.js';

/**
 * Search phrase in the zone's press language: the localized kind word (from
 * the shared i18n dictionaries, English for unsupported languages) plus the
 * place name. Chilean papers write "sismo", not "earthquake".
 */
export function buildNewsQuery({ kind, place, hl }) {
  const base = String(hl || 'en').split('-')[0];
  const word = kindName(kind, base).toLowerCase();
  return [word, String(place || '').trim()].filter(Boolean).join(' ');
}

// Google News edition per viewer language (region + full hl code).
const VIEWER_EDITION = {
  es: { gl: 'AR', hl: 'es-419' },
  en: { gl: 'US', hl: 'en-US' },
  pt: { gl: 'BR', hl: 'pt-BR' },
  fr: { gl: 'FR', hl: 'fr' },
  de: { gl: 'DE', hl: 'de' }
};

/**
 * Which Google News edition to read for a viewer language + event country:
 * when the zone's press language matches the viewer's, use the ZONE edition
 * (local papers of the place it happened); otherwise the viewer-language
 * edition — a Spanish reader never gets English results for a Nepal flood.
 */
/** Country name localized to the query language; null without a code. */
export function countryNameFor(cc, lang) {
  if (!cc) return null;
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(String(cc).toUpperCase()) || null;
  } catch {
    return null;
  }
}

export function editionFor(viewerLang, eventCc) {
  const viewer = VIEWER_EDITION[viewerLang] || VIEWER_EDITION.en;
  if (eventCc && zoneLang(eventCc) === (VIEWER_EDITION[viewerLang] ? viewerLang : 'en')) {
    return { gl: String(eventCc).toUpperCase(), hl: viewer.hl };
  }
  return { ...viewer };
}

/** Fetch + parse zone news for a query. */
export async function fetchZoneNews({ q, gl, hl }) {
  const res = await fetch(buildNewsRssUrl({ q, gl, hl }), {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' }
  });
  if (!res.ok) throw new Error(`Google News fetch failed: ${res.status}`);
  return parseNewsRss(await res.text());
}
