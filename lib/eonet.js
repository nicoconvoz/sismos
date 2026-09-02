// NASA EONET (Earth Observatory Natural Event Tracker) adapter.
//
// Free GeoJSON of ongoing natural events, no key. EONET has no alert grading,
// but many events carry a raw magnitudeValue/magnitudeUnit (acres burned,
// wind knots); the adapter maps each unit onto the engine scale. Events
// without a measurable signal get a small default — being listed at all means
// NASA considers them notable, but they should not compete with graded ones.

import { makeEvent, sortByTimeDesc } from './normalize.js';
import { logScale, windMagnitude } from './magnitude.js';

export const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30';

const KIND_BY_CATEGORY = {
  wildfires: 'wildfire',
  severeStorms: 'storm',
  volcanoes: 'volcano',
  seaLakeIce: 'ice',
  earthquakes: 'earthquake',
  floods: 'flood',
  drought: 'drought',
  landslides: 'landslide',
  dustHaze: 'dust',
  snow: 'snow',
  manmade: 'manmade',
  waterColor: 'water'
};

const DEFAULT_MAGNITUDE = 2.5;

/** Map an EONET raw measurement onto the engine's 0–10 scale. */
function eonetMagnitude(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_MAGNITUDE;
  switch (unit) {
    case 'acres': // burned area is heavy-tailed -> log anchors
      return logScale(v, { v0: 100, m0: 2.5, v1: 1e6, m1: 6.5 });
    case 'kts': // sustained winds: 65 kts (cat 1) ≈ 4.25, 140 kts (cat 5) = 8
      return windMagnitude(v);
    default:
      return DEFAULT_MAGNITUDE;
  }
}

/**
 * Normalize an EONET v3 GeoJSON FeatureCollection into the shared event
 * shape. Storm tracks arrive as LineStrings; the last point is the current
 * position. Pure function — safe for fixture-based tests.
 */
export function normalizeEonet(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const events = [];
  for (const f of geojson.features) {
    const props = f.properties || {};
    const geom = f.geometry || {};
    let coords = null;
    if (geom.type === 'Point') coords = geom.coordinates;
    else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      coords = geom.coordinates[geom.coordinates.length - 1];
    }
    if (!Array.isArray(coords)) continue;
    const [lon, lat] = coords;

    const category = (props.categories && props.categories[0]) || {};
    const kind = KIND_BY_CATEGORY[category.id] || String(category.id || 'event');
    const magValue = Number(props.magnitudeValue);
    const hasMeasure = Number.isFinite(magValue) && magValue > 0;
    const sourceUrl = (props.sources && props.sources[0] && props.sources[0].url) || null;

    const event = makeEvent({
      id: `eonet-${props.id}`,
      time: props.date,
      title: props.title || '',
      kind,
      lat,
      lon,
      source: 'eonet',
      url: sourceUrl || props.link || null,
      severity: hasMeasure
        ? {
            value: magValue,
            unit: props.magnitudeUnit || '',
            text: `${magValue} ${props.magnitudeUnit || ''}`.trim()
          }
        : null,
      magnitude: eonetMagnitude(props.magnitudeValue, props.magnitudeUnit)
    });
    if (event) events.push(event);
  }
  return sortByTimeDesc(events);
}

/** Fetch + normalize the open EONET events of the last 30 days. */
export async function fetchEonet() {
  const res = await fetch(EONET_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`EONET fetch failed: ${res.status}`);
  return normalizeEonet(await res.json());
}
