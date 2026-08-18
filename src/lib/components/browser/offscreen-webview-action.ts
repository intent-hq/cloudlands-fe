/**
 * Svelte action wiring an offscreen keep-alive <webview> (monorepo#2789
 * slice 2): mutes the guest, registers it for CDP on dom-ready, and keeps
 * the persisted tab URL in sync with agent-driven navigation so a later
 * remount in the visible panel restores the page the agent is on.
 *
 * Lives outside the component per the no-component-async-data-fetch
 * boundary — IPC and store dispatch stay in this module.
 */
import { createLogger } from '$lib/utils/client-logger';
import { updateTabBrowserUrl } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('OffscreenWebview');

export type OffscreenWebviewEntry = {
  tabId: string;
  workspaceId: string;
  url: string;
};

type OffscreenWebviewElement = HTMLElement & {
  getWebContentsId: () => number;
  setAudioMuted?: (muted: boolean) => void;
};

export function offscreenWebview(node: HTMLElement, entry: OffscreenWebviewEntry) {
  const webview = node as OffscreenWebviewElement;

  const handleDomReady = () => {
    try {
      webview.setAudioMuted?.(true);
    } catch {
      // WebView may have been detached between dom-ready and this call.
    }
    try {
      const webContentsId = webview.getWebContentsId();
      logger.info('Registering offscreen browser tab for CDP', {
        tabId: entry.tabId,
        workspaceId: entry.workspaceId,
        webContentsId,
      });
      window.electronAPI
        ?.invoke('browser:register-tab', { tabId: entry.tabId, webContentsId })
        .catch((err) => {
          logger.error('Failed to register offscreen browser tab for CDP', {
            tabId: entry.tabId,
            error: err,
          });
        });
    } catch {
      logger.debug('Failed to get webContentsId for offscreen CDP registration', {
        tabId: entry.tabId,
      });
    }
  };

  const handleDidNavigate = (event: Event) => {
    const url = (event as Event & { url?: string }).url;
    if (url) appStore.dispatch(updateTabBrowserUrl(entry.workspaceId, entry.tabId, url));
  };

  // dom-ready fires on every top-level navigation; register once per guest
  // (EmbeddedBrowser precedent) so repeated navigations don't stack
  // redundant registerTab calls and destroyed-hooks in the main process.
  // The muted state set on first dom-ready persists on the webContents.
  webview.addEventListener('dom-ready', handleDomReady, { once: true });
  webview.addEventListener('did-navigate', handleDidNavigate);
  // Hash/history navigation does not fire did-navigate; the visible
  // EmbeddedBrowser syncs it too, so mirror it here.
  webview.addEventListener('did-navigate-in-page', handleDidNavigate);

  return {
    destroy() {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
    },
  };
}
