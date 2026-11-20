/**
 * Svelte action for BrowserViewSlot (Labs: main-owned browser pages).
 *
 * The slot's element is the page's box. The action:
 * - gives the element the `<webview>` methods (attachMainOwnedPage);
 * - measures the box every animation frame and sends main the box and
 *   whether the page is on screen, only when either changes (design §2.3.1);
 * - while an overlay covers the box, shows a snapshot of the page and hides
 *   the view (design §2.3.5). The snapshot paints before the view hides, and
 *   the view shows again before the snapshot goes, so no frame is blank.
 *
 * On destroy the page leaves the screen; it stays alive in main.
 */
import { createLogger } from '$lib/utils/client-logger';
import type { BrowserViewRect } from '$shared/types/browser-view';
import { browserViewSlotMoved, trackBrowserViewSlot } from './browser-view-overlays';
import type { EmbeddedBrowserWebview } from './embedded-browser-webview';
import {
  attachMainOwnedPage,
  detachMainOwnedPage,
  setMainOwnedPagePlacement,
  type MainOwnedPageHandle,
} from './main-owned-browser-page';

const logger = createLogger('BrowserViewSlot');

export interface BrowserViewSlotParams {
  tabId: string;
  workspaceId: string;
  /** The URL a new page loads; a live page keeps its own. */
  url: string;
  pinned?: boolean;
  /** Whether the tab wants its page on screen (active tab, no error page over it). */
  visible: boolean;
  /** The element with `<webview>` methods, or null when the slot goes. */
  onWebview?: (webview: EmbeddedBrowserWebview | null) => void;
}

type Placement = { rect: BrowserViewRect | null; visible: boolean };

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));
const twoFrames = async (): Promise<void> => {
  await nextFrame();
  await nextFrame();
};

function sameRect(a: BrowserViewRect | null, b: BrowserViewRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The element's box in CSS pixels, or null when it has no area. */
function measure(node: HTMLElement): BrowserViewRect | null {
  const box = node.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function isShowable(node: HTMLElement): boolean {
  if (!node.isConnected) return false;
  if (typeof node.checkVisibility === 'function') {
    return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  return true;
}

export function mainOwnedBrowserSlot(node: HTMLElement, initial: BrowserViewSlotParams) {
  let current = bindSlot(node, initial);
  let key = `${initial.workspaceId}\u0000${initial.tabId}`;
  return {
    update(next: BrowserViewSlotParams) {
      const nextKey = `${next.workspaceId}\u0000${next.tabId}`;
      if (nextKey === key) {
        current.update(next);
        return;
      }
      // Another tab: let go of the old page and bind the new one.
      current.destroy();
      key = nextKey;
      current = bindSlot(node, next);
    },
    destroy() {
      current.destroy();
    },
  };
}

function bindSlot(node: HTMLElement, initial: BrowserViewSlotParams) {
  let params = initial;
  const handle: MainOwnedPageHandle = attachMainOwnedPage(node, {
    tabId: params.tabId,
    workspaceId: params.workspaceId,
    url: params.url,
    ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
  });
  params.onWebview?.(handle.webview);

  let sent: Placement | null = null;
  let sending: Promise<unknown> = Promise.resolve();
  /** Overlay state: the view is hidden behind a snapshot while not 'live'. */
  let cover: 'live' | 'freezing' | 'frozen' | 'thawing' = 'live';
  let coverGeneration = 0;
  let snapshot: HTMLImageElement | null = null;
  let frame: number | null = null;
  let destroyed = false;

  const removeSnapshot = (): void => {
    snapshot?.remove();
    snapshot = null;
  };

  const send = (placement: Placement): Promise<unknown> => {
    sent = placement;
    const tabId = params.tabId;
    sending = setMainOwnedPagePlacement(tabId, placement.rect, placement.visible).catch(
      (error: unknown) => logger.debug('Could not place the browser page', { tabId, error }),
    );
    return sending;
  };

  const tick = (): void => {
    frame = null;
    if (destroyed) return;
    const rect = measure(node);
    const visible =
      params.visible && rect !== null && isShowable(node) && cover !== 'frozen' && handle.ready;
    // Before the page is ready main has nothing to place.
    if (handle.ready) {
      if (!sent || sent.visible !== visible || (rect && !sameRect(sent.rect, rect))) {
        if (!sameRect(sent?.rect ?? null, rect)) browserViewSlotMoved();
        void send({ rect: rect ?? sent?.rect ?? null, visible });
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  const freeze = async (generation: number): Promise<void> => {
    cover = 'freezing';
    if (handle.ready && sent?.visible) {
      try {
        const image = await handle.webview.capturePage?.();
        if (generation !== coverGeneration || destroyed) return;
        const dataUrl = image?.toDataURL() ?? '';
        if (dataUrl) {
          const img = document.createElement('img');
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
          img.dataset.browserViewSnapshot = '';
          img.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
          img.src = dataUrl;
          await img.decode().catch(() => {});
          if (generation !== coverGeneration || destroyed) return;
          removeSnapshot();
          node.append(img);
          snapshot = img;
          await twoFrames();
          if (generation !== coverGeneration || destroyed) return;
        }
      } catch (error) {
        logger.debug('Could not snapshot the browser page', { tabId: params.tabId, error });
      }
    }
    if (generation !== coverGeneration || destroyed) return;
    // The next frame sends visible: false.
    cover = 'frozen';
  };

  const thaw = async (generation: number): Promise<void> => {
    cover = 'thawing';
    // Show the live view first, then take the snapshot away.
    if (handle.ready && params.visible) {
      const rect = measure(node);
      if (rect) await send({ rect, visible: true });
      await twoFrames();
    }
    if (generation !== coverGeneration || destroyed) return;
    removeSnapshot();
    cover = 'live';
  };

  const untrack = trackBrowserViewSlot({
    element: node,
    onCoveredChange(covered) {
      const generation = ++coverGeneration;
      void (covered ? freeze(generation) : thaw(generation));
    },
  });

  const teardown = (): void => {
    const tabId = params.tabId;
    destroyed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    untrack();
    removeSnapshot();
    handle.dispose();
    params.onWebview?.(null);
    // After any placement in flight, so the page does not come back on screen.
    void sending.then(() =>
      detachMainOwnedPage(tabId).catch((error: unknown) =>
        logger.debug('Could not take the browser page off screen', { tabId, error }),
      ),
    );
  };

  return {
    update(next: BrowserViewSlotParams) {
      params = next;
    },
    destroy: teardown,
  };
}
