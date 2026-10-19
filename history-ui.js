import { HISTORY_PAGE_SIZE, formatHistoryDate, getHistoryPage, parseHistoryDateQuery, parseHistoryPage } from './history-model.js';

export function setupHistoryUI({ list, read, remove, download, confirmDelete, onError, onDeleted }) {
  const $ = id => document.getElementById(id);
  let records = [], query = '', page = 1, enabled = false, loading = false, busy = false, requestId = 0;
  let current = getHistoryPage(records);

  function feedback(text = '', error = false) {
    $('history-feedback').textContent = text;
    $('history-feedback').hidden = !text;
    $('history-feedback').classList.toggle('error', error);
  }

  function failed(error, fallback) {
    feedback(error?.message || fallback, true);
    onError?.(error);
  }

  function blocked() { return !enabled || loading || busy; }

  function controls() {
    const disabled = blocked();
    for (const id of ['history-date', 'history-search', 'history-reset', 'history-page', 'history-go']) {
      const node = $(id);
      if (node) node.disabled = disabled;
    }
    $('history-prev').disabled = disabled || page <= 1;
    $('history-next').disabled = disabled || page >= current.pageCount;
    $('easy-history-list').setAttribute('aria-busy', String(loading || busy));
    for (const button of $('easy-history-list').querySelectorAll('button')) {
      button.disabled = disabled || button.dataset.active === 'true';
    }
  }

  function render() {
    current = getHistoryPage(records, { query, page });
    page = current.page;
    $('easy-history-list').replaceChildren();
    for (const item of current.items) {
      const date = formatHistoryDate(item.startedAt);
      const row = document.createElement('div'), info = document.createElement('div'), label = document.createElement('span'), status = document.createElement('span'), actions = document.createElement('div');
      row.className = 'history-row'; info.className = 'history-record-info'; label.className = 'history-record-date'; status.className = 'history-record-state'; actions.className = 'history-row-actions';
      label.textContent = date;
      status.textContent = item.active ? '录制中' : '已结束';
      const downloadButton = document.createElement('button'), deleteButton = document.createElement('button');
      downloadButton.type = 'button'; downloadButton.className = 'history-download'; downloadButton.textContent = '下载记录';
      downloadButton.setAttribute('aria-label', `下载 ${date} 的记录`);
      downloadButton.addEventListener('click', () => downloadItem(item));
      deleteButton.type = 'button'; deleteButton.className = 'history-delete'; deleteButton.textContent = '删除'; deleteButton.dataset.active = String(Boolean(item.active));
      deleteButton.title = item.active ? '请先结束这份记录，再删除。' : '删除这份本地记录';
      deleteButton.setAttribute('aria-label', item.active ? `删除 ${date} 的记录，请先结束录制` : `删除 ${date} 的记录`);
      deleteButton.addEventListener('click', () => deleteItem(item));
      info.append(label, status); actions.append(downloadButton, deleteButton); row.append(info, actions); $('easy-history-list').append(row);
    }
    if (!current.total) {
      const empty = document.createElement('p'); empty.className = 'history-empty';
      empty.textContent = query ? '这个日期没有记录。试试其他日期，或点击“显示全部”。' : '还没有历史记录。开始记录后，就能在这里找到。';
      $('easy-history-list').append(empty);
    }
    $('history-summary').textContent = `${query ? `“${query}” · ` : ''}共 ${current.total} 条记录 · 每页 ${HISTORY_PAGE_SIZE} 条${current.total ? ` · 显示第 ${current.first}–${current.last} 条` : ''}`;
    $('history-pagination').hidden = current.pageCount <= 1;
    $('history-page').value = String(page);
    $('history-page').max = String(current.pageCount);
    $('history-page').setAttribute('aria-invalid', 'false');
    $('history-pages').textContent = `第 ${page} / ${current.pageCount} 页`;
    controls();
  }

  async function refresh() {
    const requested = ++requestId;
    loading = true; controls();
    try {
      const result = await list();
      if (requested !== requestId) return false;
      if (!Array.isArray(result)) throw new Error('暂时无法读取历史记录，请重试。');
      records = result.slice(); render();
      return true;
    } catch (error) {
      if (requested === requestId) failed(error, '历史记录暂时没有刷新，请重试。');
      return false;
    } finally {
      if (requested === requestId) { loading = false; controls(); }
    }
  }

  async function downloadItem(item) {
    if (blocked()) return;
    busy = true; controls();
    try {
      const data = await read(item.id);
      if (!data) throw new Error('这份记录已不存在，请刷新后重试。');
      await download(data);
      feedback('下载已发起。将下载的文件发给维护人员即可。');
    } catch (error) { failed(error, '下载暂时没有完成，请重试。'); }
    finally { busy = false; controls(); }
  }

  async function deleteItem(item) {
    if (blocked() || item.active) return;
    busy = true; controls();
    try {
      if (!await confirmDelete(item)) return;
      if (!enabled) return;
      await remove(item.id);
      records = records.filter(record => record.id !== item.id);
      render();
      await onDeleted?.(item.id);
      feedback('已删除这份本地记录。已经下载的文件不会被删除。');
      await refresh();
    } catch (error) { failed(error, '这份记录暂时没有删除，请重试。'); }
    finally { busy = false; controls(); }
  }

  $('history-search-form').addEventListener('submit', event => {
    event.preventDefault();
    if (blocked()) return;
    try {
      query = parseHistoryDateQuery($('history-date').value);
      $('history-date').value = query; $('history-date').setAttribute('aria-invalid', 'false');
      page = 1; feedback(); render();
    } catch (error) { $('history-date').setAttribute('aria-invalid', 'true'); feedback(error.message, true); }
  });
  $('history-reset').addEventListener('click', () => {
    if (blocked()) return;
    query = ''; page = 1; $('history-date').value = ''; $('history-date').setAttribute('aria-invalid', 'false'); feedback(); render();
  });
  $('history-prev').addEventListener('click', () => { if (!blocked() && page > 1) { page--; feedback(); render(); } });
  $('history-next').addEventListener('click', () => { if (!blocked() && page < current.pageCount) { page++; feedback(); render(); } });
  $('history-page-form').addEventListener('submit', event => {
    event.preventDefault();
    if (blocked()) return;
    try { page = parseHistoryPage($('history-page').value, current.pageCount); $('history-page').setAttribute('aria-invalid', 'false'); feedback(); render(); }
    catch (error) { $('history-page').setAttribute('aria-invalid', 'true'); feedback(error.message, true); }
  });
  function setEnabled(value) { enabled = Boolean(value); controls(); }
  render();
  return { refresh, setEnabled };
}
