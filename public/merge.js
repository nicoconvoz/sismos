// Event merge/dedupe helpers. Dual-use module: the server composes source
// groups with it (via lib/normalize.js re-exports) and the browser composes
// the progressively-loaded groups with the exact same rules (window.EventMerge).

// Kinds that describe the same physical phenomenon across feeds dedupe
// against each other (GDACS "cyclone" vs EONET "storm").
const KIND_FAMILY = { cyclone: 'storm', storm: 'storm' };

export function familyOf(kind) {
  return KIND_FAMILY[kind] || kind;
}

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Proper-name key for named phenomena (cyclones): agencies write the same
 * storm as "Karina" (NHC) or "KARINA-26" (GDACS). Null when unnamed.
 */
function stormNameOf(event) {
  if (!event.eventName) return null;
  const m = /^[\p{L}]+/u.exec(String(event.eventName).toUpperCase());
  return m ? m[0] : null;
}

// Ongoing events (fires, storms) have fuzzy start times across agencies, so
// the default window is wide; earthquake merges pass a tight 90 s window.
const DUP_TIME_MS = 48 * 3600 * 1000;
const DUP_DIST_KM = 150;

/**
 * Merge two event lists: returns all primary events plus the secondary events
 * that do not duplicate any primary one. A duplicate is the same phenomenon
 * reported by both feeds: same kind family AND either the same proper name
 * (named storms — agencies date the same cyclone days apart, so time windows
 * cannot catch those) or |Δtime| <= maxDtMs AND distance <= maxKm. The
 * primary feed's solution wins (e.g. GDACS with its alert level beats the
 * EONET copy of the same storm).
 */
export function mergeEvents(primary, secondary, { maxDtMs = DUP_TIME_MS, maxKm = DUP_DIST_KM } = {}) {
  const extras = secondary.filter((s) => {
    const st = Date.parse(s.time);
    const sf = familyOf(s.kind);
    const sName = stormNameOf(s);
    return !primary.some((p) => {
      if (familyOf(p.kind) !== sf) return false;
      if (sName && stormNameOf(p) === sName) return true;
      return (
        Math.abs(Date.parse(p.time) - st) <= maxDtMs &&
        haversineKm(p.lat, p.lon, s.lat, s.lon) <= maxKm
      );
    });
  });
  return [...primary, ...extras];
}

if (typeof window !== 'undefined') {
  window.EventMerge = { mergeEvents, haversineKm, familyOf };
}
