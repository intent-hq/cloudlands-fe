import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import { updateTabViewport } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('BrowserViewport');

export const BROWSER_VIEWPORT_CHANGE_EVENT = 'browser-viewport-change';

export interface BrowserViewportActionParams {
  layoutId: string;
  tabId: string;
}

export function applyBrowserTabViewport(
  layoutId: string,
  tabId: string,
  viewport: BrowserTabViewport,
): void {
  appStore.dispatch(updateTabViewport(layoutId, tabId, viewport));
  void invoke(IPC_CHANNELS.BROWSER.SET_TAB_VIEWPORT, { tabId, viewport }).catch((error) => {
    logger.warn('Failed to apply browser viewport in the main process', { tabId, error });
  });
}

export function browserViewportAction(node: HTMLElement, params: BrowserViewportActionParams) {
  let current = params;
  const handleViewportChange = (event: Event) => {
    applyBrowserTabViewport(
      current.layoutId,
      current.tabId,
      (event as CustomEvent<BrowserTabViewport>).detail,
    );
  };
  node.addEventListener(BROWSER_VIEWPORT_CHANGE_EVENT, handleViewportChange);
  return {
    update(next: BrowserViewportActionParams) {
      current = next;
    },
    destroy() {
      node.removeEventListener(BROWSER_VIEWPORT_CHANGE_EVENT, handleViewportChange);
    },
  };
}
