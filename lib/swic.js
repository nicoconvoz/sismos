// WMO SWIC adapter (Severe Weather Information Centre) — the WMO's global
// aggregator of official national weather warnings, queried through its
// GeoServer WFS for the Latin America bounding box. Any South or Central
// American met service that publishes CAP to the WMO appears here the day it
// does (México and Chile already do); Argentina is skipped by default
// because the native SMN adapter carries richer detail. Keyless.

import { makeEvent } from './normalize.js';
import { alertMagnitude } from './magnitude.js';

export const SWIC_URL =
  'https://severeweather.wmo.int/f/wfs?request=GetFeature&version=1.1.0' +
  '&typeName=local_postgis:postgis_geojsons' +
  "&cql_filter=BBOX(wkb_geometry,-120,-60,-25,33) AND row_type NOT IN ('POINT','BOUNDARY') AND marine IN ('0')" +
  '&outputFormat=json&sortBy=s,sent';

// Countries whose native adapter is richer than the WMO relay.
const DEFAULT_SKIP = ['ar'];

/** Kind from the official event wording (mixed languages). */
export function swicKindOf(eventText) {
  const s = String(eventText || '').toLowerCase();
  if (/typhoon|cyclone|hurac|hurricane/.test(s)) return 'cyclone';
  if (/flood|inunda/.test(s)) return 'flood';
  if (/gale|wind|viento|zonda/.test(s)) return 'wind';
  if (/snow|nieve|nevada|blizzard/.test(s)) return 'snow';
  if (/heat|calor/.test(s)) return 'heat';
  if (/cold|fr[ií]o|frost|helada/.test(s)) return 'cold';
  if (/fire|incendio/.test(s)) return 'wildfire';
  if (/hail|granizo/.test(s)) return 'hail';
  if (/fog|niebla/.test(s)) return 'fog';
  if (/avalanche|avalancha/.test(s)) return 'avalanche';
  return 'storm'; // rain, thunder, convection, unknown
}

// SWIC severity index (s): 1 minor … 4 extreme.
const S_ALERT = { 2: 'yellow', 3: 'orange', 4: 'red' };

/** Average of every coordinate pair in a Polygon/MultiPolygon. */
function centroidOf(geometry) {
  let lat = 0;
  let lon = 0;
  let n = 0;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      lon += coords[0];
      lat += coords[1];
      n++;
    } else {
      for (const c of coords) walk(c);
    }
  };
  if (geometry && geometry.coordinates) walk(geometry.coordinates);
  return n ? [lat / n, lon / n] : null;
}

/**
 * Parse the SWIC WFS FeatureCollection into events. Pure function — safe
 * for fixture-based tests. `skip` lists lowercase country prefixes to drop.
 */
export function parseSwic(geojson, now = Date.now(), { skip = DEFAULT_SKIP } = {}) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const events = [];
  const seen = new Set();
  for (const f of geojson.features) {
    const p = f.properties || {};
    const capurl = String(p.capurl || '');
    const cc2 = capurl.slice(0, 2).toLowerCase();
    if (!/^[a-z]{2}$/.test(cc2) || skip.includes(cc2)) continue;

    const expires = p.expires || p.chk_expires;
    if (expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) < now) continue;

    const alert = S_ALERT[p.s];
    if (!alert) continue; // minor/unknown severities carry no signal

    const centroid = centroidOf(f.geometry);
    if (!centroid) continue;

    const onset = p.onset || p.effective || p.chk_effective;
    const id = `swic-${capurl.replace(/[^\w]/g, '').slice(-40)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const event = makeEvent({
      id,
      time: p.sent,
      title: p.event || p.headline || 'Alerta oficial',
      kind: swicKindOf(p.event),
      lat: centroid[0],
      lon: centroid[1],
      cc: cc2.toUpperCase(),
      source: 'swic',
      url: 'https://severeweather.wmo.int/',
      alert,
      severity: { value: null, unit: '', text: p.event || '' },
      magnitude: alertMagnitude(alert)
    });
    if (!event) continue;
    const details = String(p.description || '').trim().slice(0, 600);
    if (details) event.details = details;
    if (p.areadesc) event.area = String(p.areadesc);
    if (onset && Number.isFinite(Date.parse(onset))) event.starts = new Date(onset).toISOString();
    if (expires && Number.isFinite(Date.parse(expires))) event.ends = new Date(expires).toISOString();
    events.push(event);
  }
  return events;
}

/** Fetch + parse the Latin America warning set. */
export async function fetchSwic() {
  const res = await fetch(SWIC_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`SWIC fetch failed: ${res.status}`);
  return parseSwic(await res.json());
}
