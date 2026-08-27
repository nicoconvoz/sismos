// Border-line helpers for the vector (THREE.LineSegments) border layer.
// Dual-use module: loaded as <script type="module"> in the browser (exposes
// window.BorderUtils for the classic app.js script, which only needs it
// asynchronously — after data fetches — so load order is not a concern) and
// imported directly by node --test for the pure-logic tests.

/**
 * Expand a polyline (array of vertices, any shape) into LineSegments pairs:
 * [v0, v1, v1, v2, ..., v(n-1), vn] — every consecutive pair becomes an
 * independent GL segment, so one BufferGeometry can hold many polylines.
 * Returns [] for degenerate polylines (fewer than 2 vertices).
 */
export function polylineToSegmentPairs(vertices) {
  if (!vertices || vertices.length < 2) return [];
  const pairs = [];
  for (let i = 1; i < vertices.length; i++) {
    pairs.push(vertices[i - 1], vertices[i]);
  }
  return pairs;
}

if (typeof window !== 'undefined') {
  window.BorderUtils = { polylineToSegmentPairs };
}
