// GET /api/damaging — normalized damaging/destructive quakes of the current
// year (UTC).
//
// VolcanoDiscovery's "daninos" page server-renders the full list (verified
// 2026-08-26: ~39 rows with exact 5-decimal coordinates and detail links), so
// it works as the primary source. If the scrape ever fails, we fall back to
// the USGS FDSN event API (M6+ since Jan 1 of the current year) — the
// significant_month feed only covers ~30 days, hence the FDSN query.

import { fetchDamagingQuakes } from '../lib/volcanodiscovery.js';
import { fetchDamagingYear } from '../lib/usgs.js';
import { annotateNear } from '../lib/geocode.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { payload: null, at: 0 };

function currentYearOnly(quakes, year) {
  return quakes.filter((q) => new Date(q.time).getUTCFullYear() === year);
}

async function loadDamaging(year) {
  let vdError = null;
  try {
    const vd = currentYearOnly(await fetchDamagingQuakes(), year);
    if (vd.length > 0) return { source: 'volcanodiscovery', quakes: vd };
    vdError = 'volcanodiscovery returned no damaging quakes for the current year';
  } catch (err) {
    vdError = err.message;
  }
  const usgs = currentYearOnly(await fetchDamagingYear(year), year);
  return { source: 'usgs', quakes: usgs, fallbackReason: vdError };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(cache.payload);
  }

  try {
    const year = new Date(now).getUTCFullYear();
    const { source, quakes, fallbackReason } = await loadDamaging(year);
    // Offline nearest-city labels for synchronous "Cerca de:" rendering.
    annotateNear(quakes);
    const payload = {
      updatedAt: new Date(now).toISOString(),
      source,
      year,
      ...(fallbackReason ? { fallbackReason } : {}),
      count: quakes.length,
      quakes
    };
    cache = { payload, at: now };
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(payload);
  } catch (err) {
    if (cache.payload) {
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(200).json({ ...cache.payload, stale: true });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable', detail: err.message });
  }
}
