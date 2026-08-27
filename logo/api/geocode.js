// GET /api/geocode?lat=..&lon=.. — offline reverse geocoding.
// Returns { place: string | null } with a seismology-style nearest-city label
// ("23 km al NE de Jáchal, San Juan, Argentina") computed locally against the
// bundled GeoNames dataset — no external service involved (the previous
// Nominatim proxy produced province-only labels for rural epicenters).
// Locations do not move, so responses cache hard: in-memory Map keyed by
// coordinates rounded to 2 decimals (~1 km) with FIFO eviction, plus a long
// s-maxage for the CDN.

import { validCoord, reverseGeocode } from '../lib/geocode.js';

const CACHE_MAX = 500;
const cache = new Map(); // "lat,lon" (2-decimal) -> place label | null

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const lat = validCoord(query.lat, 90);
  const lon = validCoord(query.lon, 180);
  if (lat == null || lon == null) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'invalid_coordinates' });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cache.has(key)) {
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
    return res.status(200).json({ place: cache.get(key), cached: true });
  }

  try {
    const place = reverseGeocode(lat, lon);

    cache.set(key, place);
    if (cache.size > CACHE_MAX) {
      // Simple FIFO eviction: Map preserves insertion order.
      cache.delete(cache.keys().next().value);
    }
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
    return res.status(200).json({ place });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'geocode_failed', detail: err.message });
  }
}
