const feedback = document.getElementById('test-feedback');
const note = text => { feedback.textContent = text; };
document.getElementById('trigger-js').onclick = () => { note('已触发 JS 错误，请在 BugSnap 刷新日志。'); setTimeout(() => { throw new Error('BugSnap 手动测试：登录处理器异常'); }, 0); };
document.getElementById('trigger-console').onclick = () => { console.error('BugSnap 手动测试：登录校验失败'); note('已输出 console.error。'); };
document.getElementById('trigger-promise').onclick = () => { Promise.reject(new Error('BugSnap 手动测试：Promise 未处理')); note('已触发未处理的 Promise。'); };
document.getElementById('trigger-fetch').onclick = async () => { const response = await fetch('./missing-api'); note(`fetch 状态码：${response.status}`); };
document.getElementById('trigger-xhr').onclick = () => { const xhr = new XMLHttpRequest(); xhr.open('GET', './missing-xhr'); xhr.onloadend = () => note(`XHR 状态码：${xhr.status}`); xhr.send(); };
document.getElementById('trigger-resource').onclick = () => { const img = new Image(); img.alt = '故意失败的测试图片'; img.src = './missing-resource.png'; document.getElementById('test-resources').replaceChildren(img); note('已请求不存在的图片。'); };
document.getElementById('toggle-fix').onclick = () => { const button = document.querySelector('.login-submit'); const fixed = button.dataset.fixed !== 'true'; button.dataset.fixed = String(fixed); button.textContent = fixed ? '进入工作空间（修复后）' : '登录'; button.style.background = fixed ? '#389b80' : '#7660d9'; note(fixed ? '按钮外观已改变，可采集修复后截图。' : '已恢复初始外观。'); };
