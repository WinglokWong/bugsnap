import { pageDiagnostics } from '../diagnostics.js';
import { installInteractionRecorder } from '../interaction-recorder.js';
const pending = new Map(), listeners = [];
const documentId = crypto.randomUUID();
const send = message => new Promise(resolve => { const id = crypto.randomUUID(); pending.set(id, resolve); parent.postMessage({ fixture: 'runtime', id, message, documentId, url: location.href }, '*'); });
window.chrome = { runtime: { sendMessage: send, onMessage: { addListener: fn => listeners.push(fn) } } };
window.addEventListener('message', async event => {
  if (event.source !== parent) return;
  const message = event.data;
  if (message.fixture === 'response') { pending.get(message.id)?.(message.result); pending.delete(message.id); }
  if (message.fixture !== 'call') return;
  let result;
  if (message.action === 'diagnostics') result = pageDiagnostics(...message.args);
  if (message.action === 'interactions') result = installInteractionRecorder({ recordSynthetic: true });
  if (message.action === 'extension-message') result = await new Promise(resolve => { for (const fn of listeners) fn(message.args, {}, resolve); });
  if (message.action === 'emit') { for (let i = 0; i < message.args; i++) console.error(`fixture-error-${i}`); result = true; }
  if (message.action === 'navigate') {
    console.error('last-error-before-navigation');
    const next = new URL(location.href); next.hostname = next.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'; next.searchParams.set('phase', 'b'); location.href = next.href; return;
  }
  parent.postMessage({ fixture: 'called', id: message.id, result, documentId }, '*');
});
document.getElementById('phase').textContent = `${location.origin} · ${new URL(location.href).searchParams.get('phase') || 'a'}`;
parent.postMessage({ fixture: 'ready', documentId, url: location.href }, '*');
const script = document.createElement('script'); script.src = '../diagnostic-bridge.js'; document.head.append(script);
