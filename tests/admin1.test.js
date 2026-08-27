import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Structural validation of the generated quantized TopoJSON (built by
// tools/build-admin1.js, decoded client-side with topojson-client).
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin1-lines.json');
const topo = JSON.parse(readFileSync(path, 'utf-8'));

test('admin1-lines.json stays within the size budget', () => {
  const bytes = statSync(path).size;
  assert.ok(bytes <= 600 * 1024, `expected <= 600 KB, got ${(bytes / 1024).toFixed(0)} KB`);
});

test('admin1-lines.json is a valid quantized TopoJSON topology', () => {
  assert.equal(topo.type, 'Topology');
  assert.ok(Array.isArray(topo.transform.scale) && topo.transform.scale.length === 2);
  assert.ok(Array.isArray(topo.transform.translate) && topo.transform.translate.length === 2);
  assert.ok(Array.isArray(topo.arcs) && topo.arcs.length > 400, `arcs: ${topo.arcs.length}`);

  const admin1 = topo.objects.admin1;
  assert.equal(admin1.type, 'GeometryCollection');
  assert.equal(admin1.geometries.length, 1);
  const geom = admin1.geometries[0];
  assert.equal(geom.type, 'MultiLineString');
  assert.equal(geom.arcs.length, topo.arcs.length, 'every arc is referenced');
  for (const ref of geom.arcs) {
    assert.equal(ref.length, 1);
    assert.ok(ref[0] >= 0 && ref[0] < topo.arcs.length, `arc index in range: ${ref[0]}`);
  }
});

// Decode every arc once (manual delta decode per the TopoJSON spec) for the
// coverage assertions below.
function decodeAllPoints() {
  const { scale, translate } = topo.transform;
  const points = [];
  for (const arc of topo.arcs) {
    let qx = 0;
    let qy = 0;
    arc.forEach(([dx, dy], i) => {
      if (i === 0) {
        qx = dx;
        qy = dy;
      } else {
        qx += dx;
        qy += dy;
      }
      points.push([qx * scale[0] + translate[0], qy * scale[1] + translate[1]]);
    });
  }
  return points;
}

// Regression net for the partial-coverage bug: the Natural Earth 50m LINES
// product only covers selected large countries (Brazil yes, Argentina no).
// The 10m source must yield admin-1 points inside each of these countries.
const COVERAGE_BBOXES = {
  Argentina: { latMin: -55, latMax: -21, lonMin: -74, lonMax: -53 },
  Chile: { latMin: -56, latMax: -17, lonMin: -76, lonMax: -66 },
  Japan: { latMin: 30, latMax: 46, lonMin: 129, lonMax: 146 },
  Spain: { latMin: 36, latMax: 44, lonMin: -10, lonMax: 4 },
  USA: { latMin: 24, latMax: 49, lonMin: -125, lonMax: -66 }
};

for (const [country, b] of Object.entries(COVERAGE_BBOXES)) {
  test(`admin1-lines.json covers ${country}`, () => {
    const inside = decodeAllPoints().filter(
      ([lon, lat]) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax
    ).length;
    assert.ok(inside >= 100, `expected >= 100 admin-1 points inside ${country}, got ${inside}`);
  });
}

test('admin1-lines.json arcs delta-decode to world coordinates', () => {
  // Manual decode per the TopoJSON spec: cumulative sum, then
  // transform.scale * value + transform.translate.
  const { scale, translate } = topo.transform;
  for (const arc of [topo.arcs[0], topo.arcs[topo.arcs.length - 1]]) {
    assert.ok(arc.length >= 2, 'arcs have at least two points');
    let qx = 0;
    let qy = 0;
    arc.forEach(([dx, dy], i) => {
      if (i === 0) {
        qx = dx;
        qy = dy;
      } else {
        qx += dx;
        qy += dy;
      }
      const lon = qx * scale[0] + translate[0];
      const lat = qy * scale[1] + translate[1];
      assert.ok(lon >= -180 && lon <= 180, `lon in range: ${lon}`);
      assert.ok(lat >= -90 && lat <= 90, `lat in range: ${lat}`);
    });
  }
});
