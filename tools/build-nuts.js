// Build lib/data/nuts-centroids.json: NUTS region id -> [lat, lon].
//
// MeteoAlarm warnings geolocate by NUTS3 codes, but different national
// services emit codes from different NUTS editions (France still uses
// 2010-era FR813 while others moved on), so the table merges the label
// points of every GISCO edition — first edition to define a code wins,
// later duplicates are near-identical centroids anyway.
//
// Usage: node tools/build-nuts.js   (rewrites lib/data/nuts-centroids.json)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const EDITIONS = ['2010', '2013', '2016', '2021', '2024'];
const urlFor = (y) =>
  `https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_LB_${y}_4326.geojson`;

const out = {};
for (const year of EDITIONS) {
  const res = await fetch(urlFor(year));
  if (!res.ok) {
    console.error(`skip ${year}: HTTP ${res.status}`);
    continue;
  }
  const geo = await res.json();
  let added = 0;
  for (const f of geo.features) {
    const id = f.properties.NUTS_ID;
    if (!id || out[id]) continue;
    const [lon, lat] = f.geometry.coordinates;
    out[id] = [Number(lat.toFixed(3)), Number(lon.toFixed(3))];
    added++;
  }
  console.log(`${year}: +${added} (total ${Object.keys(out).length})`);
}

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'data', 'nuts-centroids.json');
writeFileSync(target, JSON.stringify(out));
console.log(`wrote ${target}`);
