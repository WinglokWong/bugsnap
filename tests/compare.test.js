import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePixels, comparisonSize, pageKey, groupByPage } from '../compare.js';
const pixels = colors => new Uint8ClampedArray(colors.flat());
test('Pixel diff reports precise percentage and bounding box', () => {
  const a = pixels([[0,0,0,255], [0,0,0,255], [0,0,0,255], [0,0,0,255]]), b = a.slice(); b[4] = 255;
  const result = comparePixels(a, b, 2, 2, 24);
  assert.equal(result.changed, 1); assert.equal(result.percentage, 25);
  assert.deepEqual(result.bounds, { x: 1, y: 0, width: 1, height: 1 });
  assert.deepEqual([...result.pixels.slice(4, 8)], [239, 82, 117, 255]);
});
test('Tolerance, identical images and invisible alpha do not create false differences', () => {
  const a = pixels([[0,0,0,255], [0,0,0,0]]), b = pixels([[24,0,0,255], [255,255,255,0]]);
  assert.equal(comparePixels(a, b, 2, 1, 24).changed, 0);
  assert.equal(comparePixels(a, b, 2, 1, 23).changed, 1);
  assert.equal(comparePixels(a, a, 2, 1).bounds, null);
});
test('Rejects dimensions that would distort comparison or exceed memory budget', () => {
  assert.throws(() => comparePixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 1, 1), /一致/);
  assert.throws(() => comparePixels([], [], 5000, 5000), /过大/);
  assert.throws(() => comparePixels(new Uint8ClampedArray(4), new Uint8ClampedArray(4), 1, 1, NaN), /容差/);
  assert.deepEqual(comparisonSize(3200, 1800), { width: 1600, height: 900, scale: .5 });
});
test('Page grouping normalizes query order but preserves identities and SPA routes', () => {
  assert.equal(pageKey('https://e.test/?b=2&a=1'), pageKey('https://e.test/?a=1&b=2'));
  assert.notEqual(pageKey('https://e.test/#/login'), pageKey('https://e.test/#/home'));
  const groups = groupByPage([{ id: 1, capture: { page: { url: 'https://e.test/?b=2&a=1' } } }, { id: 2, capture: { page: { url: 'https://e.test/?a=1&b=2' } } }, { id: 3 }]);
  assert.equal(groups.length, 2); assert.equal(groups[0].reports.length, 2); assert.equal(groups[1].url, '未采集页面');
});
