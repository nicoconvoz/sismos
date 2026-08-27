// One-off generator for public/admin1-lines.json — first-level administrative
// boundary lines (states/provinces) baked into the globe texture by the
// frontend (see the border bake block in public/app.js).
//
// Source: Natural Earth 10m "admin_1_states_provinces_lines" (boundary LINES,
// worldwide: ~10.2k features / ~416k points, public domain).
// - The 50m lines product is a PARTIAL-COVERAGE subset (only selected large
//   countries — it showed Brazil but had essentially no Argentina: 42 points
//   in the AR bbox), which caused the "no Argentine provinces" bug. The 10m
//   file covers every country, at the cost of a ~21 MB download and far more
//   vertices — hence the Douglas-Peucker simplification below.
// - https://naciscdn.org/naturalearth/... returned 403 to server-side fetch
//   when probed (2026-08-27), so the GitHub mirror of the official repo is
//   used instead.
//
// Output: a compact quantized TopoJSON with geometry only (all properties
// dropped). Every simplified line becomes one delta-encoded arc and a single
// MultiLineString geometry references them all — topojson-client's feature()
// (already loaded client-side for the bake) decodes it. Target <= 600 KB;
// the ~0.03 deg tolerance is invisible at the 4096x2048 texture scale
// (1 px ~ 0.088 deg of longitude).
//
// Usage: node tools/build-admin1.js [path/to/ne_10m_admin_1_states_provinces_lines.geojson]

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson';
const TOLERANCE_DEG = 0.03; // Douglas-Peucker tolerance (~0.34 px at 4096)
const QUANTIZATION = 2e4; // ~0.018 deg grid (~0.2 px at 4096)
const SIZE_BUDGET = 600 * 1024;
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin1-lines.json');

async function loadSource() {
  const localPath = process.argv[2];
  if (localPath) return JSON.parse(readFileSync(localPath, 'utf-8'));
  console.log(`downloading ${SOURCE_URL} (~21 MB)`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return res.json();
}

/**
 * Douglas-Peucker line simplification (iterative, perpendicular distance in
 * plain degree space — adequate for visual tolerance at globe scale).
 */
function simplify(line, tolerance) {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [x1, y1] = line[first];
    const [x2, y2] = line[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norm = Math.hypot(dx, dy);
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = line[i];
      // Perpendicular distance to the segment's infinite line (or to the
      // endpoint when the segment degenerates to a point).
      const dist = norm === 0
        ? Math.hypot(px - x1, py - y1)
        : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx], [maxIdx, last]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Chain lines that share exact endpoints into long polylines. The 10m data
 * splits borders into ~43k short pieces; stroked output does not need those
 * splits, and every merged joint removes one whole arc of JSON overhead plus
 * a duplicated endpoint — and gives Douglas-Peucker longer runs to thin.
 */
function chainLines(lines) {
  const key = ([x, y]) => `${x},${y}`;
  const ends = new Map(); // endpoint key -> [{ idx, atStart }]
  lines.forEach((line, idx) => {
    for (const entry of [
      { k: key(line[0]), idx, atStart: true },
      { k: key(line[line.length - 1]), idx, atStart: false }
    ]) {
      let list = ends.get(entry.k);
      if (!list) ends.set(entry.k, (list = []));
      list.push(entry);
    }
  });

  const used = new Uint8Array(lines.length);
  const takeAt = (k, chainIdx) => {
    const list = ends.get(k) || [];
    for (const e of list) {
      if (!used[e.idx] && e.idx !== chainIdx) return e;
    }
    return null;
  };

  const chains = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = [...lines[i]];
    // Grow at the tail, then at the head, until no free line connects.
    for (;;) {
      const e = takeAt(key(chain[chain.length - 1]), -1);
      if (!e) break;
      used[e.idx] = 1;
      const next = e.atStart ? lines[e.idx] : [...lines[e.idx]].reverse();
      chain = chain.concat(next.slice(1));
    }
    for (;;) {
      const e = takeAt(key(chain[0]), -1);
      if (!e) break;
      used[e.idx] = 1;
      const prev = e.atStart ? [...lines[e.idx]].reverse() : lines[e.idx];
      chain = prev.concat(chain.slice(1));
    }
    chains.push(chain);
  }
  return chains;
}

const geojson = await loadSource();

// Collect every line, chain shared endpoints, then simplify the long chains.
const rawLines = [];
let rawPoints = 0;
for (const f of geojson.features || []) {
  const g = f.geometry;
  if (!g) continue;
  const source = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const line of source) {
    if (line.length < 2) continue;
    rawPoints += line.length;
    rawLines.push(line);
  }
}
const chained = chainLines(rawLines);
const lines = [];
for (const chain of chained) {
  const simplified = simplify(chain, TOLERANCE_DEG);
  if (simplified.length >= 2) lines.push(simplified);
}

// Bounding box -> TopoJSON transform (quantized grid over the actual extent).
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const line of lines) {
  for (const [x, y] of line) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const scale = [(maxX - minX) / (QUANTIZATION - 1), (maxY - minY) / (QUANTIZATION - 1)];
const translate = [minX, minY];

// Quantize + delta-encode each line into an arc, dropping consecutive
// duplicate grid points (quantization collapses near-identical vertices).
const arcs = [];
let points = 0;
for (const line of lines) {
  const arc = [];
  let px = null, py = null;
  for (const [x, y] of line) {
    const qx = Math.round((x - translate[0]) / scale[0]);
    const qy = Math.round((y - translate[1]) / scale[1]);
    if (px === null) arc.push([qx, qy]);
    else if (qx !== px || qy !== py) arc.push([qx - px, qy - py]);
    else continue;
    px = qx;
    py = qy;
  }
  if (arc.length >= 2) {
    arcs.push(arc);
    points += arc.length;
  }
}

const topology = {
  type: 'Topology',
  transform: { scale, translate },
  arcs,
  objects: {
    admin1: {
      type: 'GeometryCollection',
      geometries: [{ type: 'MultiLineString', arcs: arcs.map((_, i) => [i]) }]
    }
  }
};

writeFileSync(outPath, JSON.stringify(topology));
const bytes = readFileSync(outPath).length;
console.log(
  `wrote ${arcs.length} arcs (${rawPoints} raw -> ${points} simplified points) -> ${outPath} (${(bytes / 1024).toFixed(0)} KB)`
);
if (bytes > SIZE_BUDGET) {
  console.warn(`WARNING: output exceeds the ${SIZE_BUDGET / 1024} KB budget — raise TOLERANCE_DEG.`);
  process.exitCode = 1;
}
