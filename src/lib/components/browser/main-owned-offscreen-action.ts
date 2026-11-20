/**
 * Svelte action for an off-screen browser tab whose page main owns (Labs).
 *
 * OffscreenWebviewHost keeps pages of tabs no panel shows alive, so agents
 * can evaluate, screenshot and drive them. With main-owned pages it renders
 * a hidden box instead of a `<webview>`: this action gives the box the
 * `<webview>` methods (attachMainOwnedPage) so the host's `offscreenWebview`
 * action keeps the tab's URL in sync exactly as before. The page stays
 * detached in main (it runs JS and answers CDP); main parks it to paint while
 * an agent screenshot or drawing hold needs frames.
 *
 * When the host lets the tab go (cap eviction, workspace closed), the page
 * closes, unless a panel shows the tab now: the panel's slot owns it then.
 */
import { createLogger } from '$lib/utils/client-logger';
import { selectMountedBrowserTabLeases } from '$store/renderer/slices/tab-state/tab-state-selectors';
import { store as appStore } from '$store/renderer/store';
import { attachMainOwnedPage, destroyMainOwnedPage } from './main-owned-browser-page';

const logger = createLogger('MainOwnedOffscreenPage');

export interface MainOwnedOffscreenEntry {
  tabId: string;
  workspaceId: string;
  url: string;
  pinned?: boolean;
}

function isShownInAPanel(tabId: string): boolean {
  const leases = selectMountedBrowserTabLeases.select(appStore.state);
  return Boolean(leases[tabId]);
}

export function mainOwnedOffscreenPage(node: HTMLElement, entry: MainOwnedOffscreenEntry) {
  const handle = attachMainOwnedPage(node, {
    tabId: entry.tabId,
    workspaceId: entry.workspaceId,
    url: entry.url,
    ...(entry.pinned === undefined ? {} : { pinned: entry.pinned }),
    keepAlive: true,
  });
  return {
    destroy() {
      const elsewhere = handle.elsewhere;
      handle.dispose();
      // Another window's page, or a panel here shows the tab now: not ours to
      // close. (Main also refuses to close a page from a window that does not own it.)
      if (elsewhere || isShownInAPanel(entry.tabId)) return;
      destroyMainOwnedPage(entry.tabId).catch((error: unknown) =>
        logger.debug('Could not close an off-screen browser page', { tabId: entry.tabId, error }),
      );
    },
  };
}
