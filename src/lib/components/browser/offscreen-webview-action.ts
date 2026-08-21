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
  /**
   * Live persisted browserUrl for the tab. The mount `url` is frozen so our
   * own did-navigate sync never reloads the guest, but an external update
   * (e.g. an agent openTab replacing a hidden tab, monorepo#2857) must still
   * navigate the live guest — the action loadURLs when this diverges from
   * the guest's actual URL.
   */
  desiredUrl?: string;
};

type OffscreenWebviewElement = HTMLElement & {
  getWebContentsId: () => number;
  setAudioMuted?: (muted: boolean) => void;
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void>;
};

export function offscreenWebview(node: HTMLElement, entry: OffscreenWebviewEntry) {
  const webview = node as OffscreenWebviewElement;
  let current = entry;
  let domReady = false;

  const syncDesiredUrl = () => {
    const desired = current.desiredUrl;
    if (!domReady || !desired) return;
    try {
      // Equal URLs mean the change came from our own did-navigate sync (or
      // the guest is already there) — never reload in that case.
      if (webview.getURL?.() === desired) return;
      webview.loadURL?.(desired)?.catch((err) => {
        logger.warn('Failed to navigate offscreen tab to updated browserUrl', {
          tabId: current.tabId,
          error: err,
        });
      });
    } catch {
      // WebView may have been detached; the next update retries.
    }
  };

  const handleDomReady = () => {
    domReady = true;
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
    // A desiredUrl update may have arrived before the guest was ready.
    syncDesiredUrl();
  };

  const handleDidNavigate = (event: Event) => {
    const url = (event as Event & { url?: string }).url;
    if (url) appStore.dispatch(updateTabBrowserUrl(current.workspaceId, current.tabId, url));
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
    update(next: OffscreenWebviewEntry) {
      current = next;
      syncDesiredUrl();
    },
    destroy() {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
    },
  };
}
