import { comparisonSize } from './compare.js';
const $ = id => document.getElementById(id);
export function setupComparison({ getReports, getDraft, notify, attach, download }) {
  let sources = new Map(), result = null, worker = null, generation = 0;
  const clearResult = () => { result = null; $('comparison-result').hidden = true; };
  async function refresh() {
    generation++; worker?.terminate(); worker = null;
    const before = $('compare-before').value, after = $('compare-after').value;
    const reports = await getReports(); sources = new Map();
    const draft = getDraft();
    if (draft.capture?.screenshot) sources.set('draft', { ...structuredClone(draft), title: `当前草稿 · ${draft.title || '未命名'}` });
    for (const report of reports) if (report.capture?.screenshot) sources.set(report.id, report);
    for (const id of ['compare-before', 'compare-after']) {
      $(id).replaceChildren();
      for (const [key, report] of sources) {
        const option = document.createElement('option'); option.value = key;
        option.textContent = `${report.title || '未命名'} · ${new Date(report.capture.page.capturedAt).toLocaleString('zh-CN')}`;
        $(id).append(option);
      }
    }
    if (sources.has(before)) $('compare-before').value = before;
    else if (sources.size > 1) $('compare-before').selectedIndex = 1;
    if (sources.has(after)) $('compare-after').value = after;
    $('run-compare').disabled = sources.size < 2;
    if (sources.size < 2) $('comparison-status').textContent = '至少需要两个截图来源；保存报告后，重新采集当前草稿即可对比。';
    clearResult();
  }
  function invalidate() {
    generation++; worker?.terminate(); worker = null; clearResult();
    $('run-compare').disabled = sources.size < 2;
    $('comparison-status').textContent = '设置已更新，点击开始对比。';
  }
  const load = async source => { const img = new Image(); img.src = source; await img.decode(); return img; };
  const raster = (img, size) => {
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, size.width, size.height);
    return { pixels: ctx.getImageData(0, 0, size.width, size.height).data, image: canvas.toDataURL('image/png') };
  };
  $('run-compare').addEventListener('click', async () => {
    const token = ++generation; worker?.terminate(); clearResult(); $('run-compare').disabled = true;
    $('comparison-status').textContent = '正在本机计算像素差异…';
    try {
      const before = sources.get($('compare-before').value), after = sources.get($('compare-after').value);
      if (!before || !after || $('compare-before').value === $('compare-after').value) throw new Error('请选择两个不同的截图来源。');
      const [a, b] = await Promise.all([load(before.capture.screenshot), load(after.capture.screenshot)]);
      if (token !== generation) return;
      if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) throw new Error(`原图尺寸不一致：${a.naturalWidth} × ${a.naturalHeight} 与 ${b.naturalWidth} × ${b.naturalHeight}。请保持相同窗口尺寸和缩放后重新截图。`);
      const size = comparisonSize(a.naturalWidth, a.naturalHeight), ra = raster(a, size), rb = raster(b, size), threshold = Number($('diff-threshold').value);
      worker = new Worker(new URL('./diff-worker.js', import.meta.url), { type: 'module' });
      const metrics = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.ok ? resolve(data) : reject(new Error(data.error));
        worker.onerror = () => reject(new Error('差异计算失败，请重试。'));
        worker.postMessage({ before: ra.pixels, after: rb.pixels, width: size.width, height: size.height, threshold }, [ra.pixels.buffer, rb.pixels.buffer]);
      });
      if (token !== generation) return;
      const canvas = $('diff-canvas'); canvas.width = size.width; canvas.height = size.height;
      canvas.getContext('2d').putImageData(new ImageData(metrics.pixels, size.width, size.height), 0, 0);
      const reference = (r, img) => ({ id: r.id, title: r.title, url: r.capture.page.url, capturedAt: r.capture.page.capturedAt, image: img });
      result = { version: 1, comparedAt: new Date().toISOString(), ...size, originalWidth: a.naturalWidth, originalHeight: a.naturalHeight, threshold, changed: metrics.changed, total: metrics.total, percentage: metrics.percentage, bounds: metrics.bounds, before: reference(before, ra.image), after: reference(after, rb.image), diffImage: canvas.toDataURL('image/png') };
      $('wipe-before').src = ra.image; $('wipe-after').src = rb.image;
      $('diff-percentage').textContent = `${metrics.percentage.toFixed(3)}%`;
      $('diff-count').textContent = `${metrics.changed.toLocaleString()} / ${metrics.total.toLocaleString()} 个分析像素`;
      $('diff-size').textContent = `${size.width} × ${size.height}`;
      const contextDiffers = before.capture.page.url !== after.capture.page.url || JSON.stringify(before.capture.page.scroll) !== JSON.stringify(after.capture.page.scroll) || before.capture.page.devicePixelRatio !== after.capture.page.devicePixelRatio;
      $('diff-context').textContent = `${size.scale < 1 ? '图片已等比例缩小后计算。' : ''}${contextDiffers ? '两次采集的地址、滚动位置或像素比不同，请结合上下文判断。' : ''}粉红色为超过容差的变化；像素差异不等于缺陷。`;
      $('comparison-result').hidden = false; $('comparison-status').textContent = '对比完成 · 使用原始截图，不包含手动标注。';
    } catch (error) { if (token === generation) { $('comparison-status').textContent = error.message; notify(error.message, true); } }
    finally { if (token === generation) { worker?.terminate(); worker = null; $('run-compare').disabled = sources.size < 2; } }
  });
  for (const id of ['compare-before', 'compare-after']) $(id).addEventListener('change', invalidate);
  $('diff-threshold').addEventListener('input', () => { $('threshold-value').textContent = `${$('diff-threshold').value} / 255`; invalidate(); });
  for (const mode of ['diff', 'wipe']) $(`view-${mode}`).addEventListener('click', () => {
    for (const m of ['diff', 'wipe']) { $(`${m}-view`).hidden = m !== mode; $(`view-${m}`).classList.toggle('active', m === mode); $(`view-${m}`).setAttribute('aria-pressed', String(m === mode)); }
  });
  $('wipe-slider').addEventListener('input', () => {
    $('wipe-after').style.clipPath = `inset(0 0 0 ${$('wipe-slider').value}%)`;
    $('wipe-after').parentElement.style.setProperty('--split', `${$('wipe-slider').value}%`);
  });
  $('attach-comparison').addEventListener('click', () => { if (result) attach(structuredClone(result)); });
  $('download-diff').addEventListener('click', () => {
    if (!result) return;
    $('diff-canvas').toBlob(blob => { if (blob) download(blob, 'BugSnap-comparison.png'); }, 'image/png');
  });
  return { refresh, invalidate };
}
