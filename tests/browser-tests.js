(async () => {
  const test = async (name, fn) => { const row = document.createElement('li'); try { await fn(); row.textContent = `PASS · ${name}`; row.style.color = '#29866b'; } catch (error) { row.textContent = `FAIL · ${name}: ${error.message}`; row.style.color = '#cf405d'; } document.getElementById('results').append(row); };
  const assert = (condition, reason = 'assertion failed') => { if (!condition) throw new Error(reason); };
  await test('特殊字符 ID、重复 ID、重复类名的选择器唯一定位', () => {
    for (const el of document.querySelectorAll('.fixture *')) {
      const selector = __bugsnap.selector(el), matches = document.querySelectorAll(selector);
      assert(matches.length === 1 && matches[0] === el, selector);
    }
  });
  await test('不提取密码值及非白名单属性', () => {
    const data = __bugsnap.metadata(document.getElementById('secret'));
    assert(!JSON.stringify(data).includes('should-not-collect')); assert(data.element.text === ''); assert(data.element.tag === 'input');
  });
  await test('收集 URL、时间、窗口、视口和元素位置', () => {
    const data = __bugsnap.metadata(document.getElementById('target'));
    assert(data.page.url === location.href && data.page.viewport.width === innerWidth);
    assert(data.element.rect.width > 0 && data.page.capturedAt);
  });
  await test('Esc 取消选择并移除监听器及遮罩', () => {
    collectorListener({ type: 'START_PICK', requestId: 'escape' }, {}, () => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(testMessages.at(-1).type === 'PICK_CANCELLED');
    let propagated = false; const cb = () => propagated = true;
    document.addEventListener('pointerdown', cb); document.getElementById('target').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); document.removeEventListener('pointerdown', cb);
    assert(propagated);
  });
  await test('选中时拦截原点击，传递元素信息且移除遮罩', async () => {
    let clicked = false; const target = document.getElementById('target'); target.addEventListener('click', () => clicked = true);
    collectorListener({ type: 'START_PICK', requestId: 'select' }, {}, () => {});
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!clicked); assert(testMessages.at(-1).type === 'PICK_RESULT'); assert(testMessages.at(-1).data.element.selector === '#target');
  });
  document.title = document.getElementById('results').textContent.includes('FAIL') ? 'FAIL · BugSnap DOM tests' : 'PASS · 5 BugSnap DOM tests';
})();
