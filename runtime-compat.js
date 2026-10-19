// The UI and service worker share this contract. A loaded unpacked extension
// keeps its old manifest until Chrome reloads it, even if its files are replaced.
export const UI_VERSION = '2.0.1';
export const RUNTIME_PROTOCOL = 1;
export const RELOAD_MESSAGE = '插件界面和后台版本不一致。点击“重新加载插件”，再从工具栏打开 BugSnap。';

export class RuntimeCompatibilityError extends Error {
  constructor() {
    super(RELOAD_MESSAGE);
    this.name = 'RuntimeCompatibilityError';
  }
}

export function assertLoadedManifest(manifest) {
  // HTTP(S) wildcards cover recording, but are not a substitute for the
  // <all_urls> permission required to capture without a fresh activeTab grant.
  if (manifest?.version !== UI_VERSION || !Array.isArray(manifest.optional_host_permissions) || !manifest.optional_host_permissions.includes('<all_urls>')) {
    throw new RuntimeCompatibilityError();
  }
  return manifest;
}

export function assertRuntimeInfo(result) {
  if (!result || result.ok !== true) {
    // A failed connection or an explicit worker failure is not evidence that
    // the installed version is old. Preserve it for the normal error handler.
    throw new Error(result?.error || '无法连接记录服务，请重试。');
  }
  if (result.runtime?.version !== UI_VERSION || result.runtime?.protocol !== RUNTIME_PROTOCOL) {
    // Legacy workers respond { ok: true } to unknown message types.
    throw new RuntimeCompatibilityError();
  }
  return result.runtime;
}

export async function checkRuntime(chromeApi) {
  assertLoadedManifest(chromeApi.runtime.getManifest());
  return assertRuntimeInfo(await chromeApi.runtime.sendMessage({ type: 'RUNTIME_INFO' }));
}

export function permissionOrigins(chromeApi, screenshots) {
  // Deliberately synchronous: callers can request permission in the original
  // button click, before any await consumes Chrome's user gesture.
  assertLoadedManifest(chromeApi.runtime.getManifest());
  return screenshots ? ['<all_urls>'] : ['http://*/*', 'https://*/*'];
}

export function runtimeProblem(error) {
  const message = error?.message || String(error);
  if (error instanceof RuntimeCompatibilityError || /Only permissions specified in the manifest|无效的(?:记录|会话)操作|Extension context invalidated|Receiving end does not exist/i.test(message)) {
    return RELOAD_MESSAGE;
  }
  return null;
}
