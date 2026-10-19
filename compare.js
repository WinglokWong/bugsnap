export function comparePixels(before, after, width, height, threshold = 24) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4000000) throw new Error('对比尺寸无效或过大。');
  if (before.length !== width * height * 4 || after.length !== before.length) throw new Error('两张图片的像素尺寸必须一致。');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw new Error('容差必须为 0–255。');
  const pixels = new Uint8ClampedArray(before.length);
  let changed = 0, left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < before.length; i += 4) {
    // Composite transparency over white so invisible RGB does not become a false difference.
    const a = before[i + 3] / 255, b = after[i + 3] / 255;
    let delta = 0;
    for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs((before[i + c] * a + 255 * (1 - a)) - (after[i + c] * b + 255 * (1 - b))));
    if (delta > threshold) {
      changed++; const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      pixels.set([239, 82, 117, 255], i);
    } else {
      const gray = Math.round((after[i] + after[i + 1] + after[i + 2]) / 3 * b + 255 * (1 - b));
      const faded = Math.round(gray * .35 + 255 * .65); pixels.set([faded, faded, faded, 255], i);
    }
  }
  return { pixels, changed, total: width * height, percentage: changed / (width * height) * 100,
    bounds: changed ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null };
}
export function comparisonSize(width, height, maxDimension = 1600) {
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效。');
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
export function pageKey(value) {
  if (!value) return '未采集页面';
  try { const url = new URL(value); url.searchParams.sort(); return url.href; } catch { return String(value); }
}
export function groupByPage(reports) {
  const groups = new Map();
  for (const report of reports) { const key = pageKey(report.capture?.page?.url); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(report); }
  return [...groups].map(([url, reports]) => ({ url, reports }));
}
