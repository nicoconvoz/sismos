import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polylineToSegmentPairs } from '../public/borders.js';

test('polylineToSegmentPairs expands n vertices into 2*(n-1) pair entries', () => {
  const line = [[0, 0, 1], [1, 0, 1], [2, 1, 1], [3, 2, 1]];
  const pairs = polylineToSegmentPairs(line);
  assert.equal(pairs.length, 2 * (line.length - 1));
});

test('polylineToSegmentPairs keeps segment adjacency (pair k ends where pair k+1 starts)', () => {
  const line = ['a', 'b', 'c', 'd'];
  const pairs = polylineToSegmentPairs(line);
  assert.deepEqual(pairs, ['a', 'b', 'b', 'c', 'c', 'd']);
  for (let k = 0; k + 3 < pairs.length; k += 2) {
    assert.equal(pairs[k + 1], pairs[k + 2], `segment ${k / 2} must chain into the next`);
  }
});

test('polylineToSegmentPairs returns [] for degenerate input', () => {
  assert.deepEqual(polylineToSegmentPairs([]), []);
  assert.deepEqual(polylineToSegmentPairs([[1, 2, 3]]), []);
  assert.deepEqual(polylineToSegmentPairs(null), []);
});
