import { setupEasyUI } from './easy-ui.js';
import { checkRuntime, assertLoadedManifest, runtimeProblem, RuntimeCompatibilityError } from './runtime-compat.js';
const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
let windowId = 'preview', runtimeReady = !extension, reloadRequired = false;
function friendly(error) {
  if (runtimeProblem(error)) return runtimeProblem(error);
  const message = error?.message || String(error);
  if (/quota/i.test(message)) return '本地存储空间不足，请先下载并删除部分历史记录，再重试。';
  return message;
}
function startupFailure(error) {
  runtimeReady = false;
  reloadRequired = Boolean(runtimeProblem(error));
  easyUI.setReady(false, { title: reloadRequired ? '重新加载后就能开始' : '记录尚未准备好' });
  $('runtime-notice').hidden = false;
  $('runtime-title').textContent = reloadRequired ? '更新还差一步' : '暂时无法准备记录';
  $('runtime-message').textContent = friendly(error);
  $('runtime-help').textContent = reloadRequired ? '已保存的记录会保留。重新加载后，点击工具栏中的 BugSnap 图标打开。' : '已保存的记录不会被删除。请重试；仍无法使用时，将这条提示发给维护人员。';
  $('runtime-reload').textContent = reloadRequired ? '重新加载插件' : '重试';
}
async function command(type, extra = {}) {
  try {
    if (!runtimeReady) throw reloadRequired ? new RuntimeCompatibilityError() : new Error('记录服务尚未准备好，请重试。');
    assertLoadedManifest(chrome.runtime.getManifest());
    const result = await chrome.runtime.sendMessage({ type, windowId, ...extra });
    if (!result?.ok) throw new Error(result?.error || '无法连接记录服务，请重新打开插件。');
    return result;
  } catch (error) {
    if (runtimeProblem(error)) startupFailure(error);
    throw error;
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function confirmDelete(item) {
  const dialog = $('delete-dialog');
  $('delete-record-time').textContent = new Date(item.startedAt).toLocaleString('zh-CN', { hour12: false });
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true });
    dialog.showModal();
  });
}
$('runtime-reload').addEventListener('click', () => {
  if (extension && reloadRequired) {
    try { chrome.runtime.reload(); }
    catch { $('runtime-help').textContent = '请打开 chrome://extensions，找到 BugSnap，点击重新加载按钮，再打开侧边栏。'; }
  } else location.reload();
});
const easyUI = setupEasyUI({ extension, command, download, confirmDelete, getWindowId: () => windowId, onRuntimeError: startupFailure });
async function init() {
  if (extension) {
    await checkRuntime(chrome);
    runtimeReady = true;
    windowId = (await chrome.windows.getCurrent()).id;
  } else $('demo-banner').hidden = false;
  await easyUI.refresh();
  easyUI.setReady(true);
}
init().catch(startupFailure);
