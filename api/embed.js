// GET /api/embed?url=... — reports whether a news article allows being
// embedded in an iframe (X-Frame-Options / CSP frame-ancestors), so the
// reader modal can show a clean fallback instead of the browser's raw
// "refused to connect" error. Only http(s) URLs are probed, via HEAD when
// possible, and results are cached; the response never includes page content,
// so this cannot serve as a content proxy.

import { checkEmbeddable } from '../lib/news.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // frame policies rarely change
const CACHE_MAX = 500;

const cache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url, 'http://localhost');
  const target = (url.searchParams.get('url') || '').trim();

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || target.length > 600) {
    return res.status(400).json({ error: 'invalid_url' });
  }
  // Never probe private/loopback hosts (SSRF guard).
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(parsed.hostname)) {
    return res.status(400).json({ error: 'invalid_url' });
  }

  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json(hit.payload);
  }

  try {
    const result = await checkEmbeddable(target);
    const payload = { url: target, ...result };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(target, { payload, at: Date.now() });
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json(payload);
  } catch (err) {
    // Unreachable upstream: let the client try the iframe anyway.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ url: target, embeddable: true, probeFailed: true, detail: err.message });
  }
}
