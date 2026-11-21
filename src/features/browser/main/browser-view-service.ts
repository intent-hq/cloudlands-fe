/**
 * BrowserViewService — main-owned browser tab pages (Labs).
 *
 * Main owns each browser tab's page as a `WebContentsView`, keyed by
 * `{ backendId, workspaceId, tabId }`. The renderer that shows the tab only
 * reports where its box is; a renderer that unmounts does not end the page.
 * A page ends when its tab closes, its workspace goes away, or its window
 * closes (a window close never destroys child views on its own, so main
 * does it).
 *
 * A view is in one of three places in its window (design §2.3, §2.4):
 * - shown: above the machine view at the reported box;
 * - parked: below the machine view at its last real size, painting with
 *   background throttling off, inside a 1×1 clipping holder view. The
 *   machine view is transparent where the app is (the frame page paints
 *   the backdrop under it), so a page parked unclipped would show through
 *   translucent areas; clipped, at most one page pixel is under it, and the
 *   page still paints and captures at full size (a 0×0 holder stops CDP
 *   screenshots), while a drawing hold (agent screenshot or
 *   agent activity) needs frames from a page that is not on screen. A view
 *   in no window does not paint, and Electron 44 has no capturer count;
 * - detached: in no window. It still runs JS and answers CDP evaluate.
 *
 * Moving a view to another window keeps its webContents, so the page does
 * not reload and the CDP tabId → webContentsId mapping does not change.
 */

import type { BrowserWindow, View, WebContents, WebContentsView } from 'electron';
import { Logger } from '../../../shared/logger';
import { classifyBrowserViewShortcut } from '../../../shared/browser-view-shortcuts';
import type {
  BrowserViewCommand,
  BrowserViewCommandResult,
  BrowserViewEventMessage,
  BrowserViewPageEvent,
  BrowserViewRect,
  BrowserViewState,
} from '../../../shared/types/browser-view';
import type {
  BrowserPanelPageOwner,
  MainOwnedBrowserPageOwners,
} from '../../../main/browser-panel-pages';
import type { MainOwnedBrowserViews } from './embedded-browser-cdp-service';

const logger = new Logger('BrowserViewService');

/** Size a view is parked at before any renderer has reported its box. */
const DEFAULT_PARKED_SIZE = { width: 1280, height: 800 } as const;

/** Zoom factors a page accepts (Chromium's own range). */
const MIN_PAGE_ZOOM = 0.25;
const MAX_PAGE_ZOOM = 5;

/**
 * Pages kept alive off screen before the oldest is closed (the `<webview>`
 * path's MAX_OFFSCREEN_WEBVIEWS). Pinned (agent-owned) pages and pages in a
 * drawing hold do not count and are never closed by the cap.
 */
const DEFAULT_MAX_DETACHED_VIEWS = 8;

/** Console messages from the app's own page scripts (element picker). */
const APP_CONSOLE_PREFIX = '__INTENT_';

export interface BrowserViewKey {
  backendId: string;
  workspaceId: string;
  tabId: string;
}

export type BrowserViewPlacement = 'shown' | 'parked' | 'detached';

/** What the service needs from Electron and the rest of main. */
export interface BrowserViewServiceDeps {
  /** Construct the page's view (production: `new WebContentsView`). */
  createView(webPreferences: Electron.WebPreferences): WebContentsView;
  /** Construct the clipping holder a parked page sits in (production: `new View`). */
  createParkingHolder(): View;
  /** Constructor preferences shared with `<webview>` guests (webview-security). */
  webPreferences(): Electron.WebPreferences;
  /** Apply the guest navigation, popup and permission rules (webview-security). */
  secureContents(contents: WebContents): void;
  /** Whether a URL may load in a browser page (the guest navigation rule). */
  isNavigationAllowed(url: string): boolean;
  /** The machine view serving `backendId` in `window`, or null. */
  machineViewFor(window: BrowserWindow, backendId: string): WebContents | null;
  /** The machine `window` shows. */
  shownMachine(window: BrowserWindow): string;
  /** The CDP registry. */
  cdp: {
    registerTab(tabId: string, webContentsId: number, workspaceId?: string): void;
    unregisterTab(tabId: string): void;
  };
  /** Send a page event to a renderer. */
  send(target: WebContents, message: BrowserViewEventMessage): void;
  /**
   * A window with browser views is closing. A tab window moves its views
   * back here (design §3.4.3); views still in the window when it is closed
   * are destroyed.
   */
  onWindowClosing?(window: BrowserWindow, tabIds: string[]): void;
  /** A page moved to another window (a passkey ceremony in it ends). */
  onPageMoved?(webContentsId: number): void;
  /** macOS key rules for app shortcuts typed in a page (default: this platform). */
  isMac?: boolean;
  /** Off-screen pages kept before the oldest closes (default DEFAULT_MAX_DETACHED_VIEWS). */
  maxDetached?: number;
  /** Clock for the off-screen cap (tests). */
  now?: () => number;
}

export interface BrowserViewCreateOptions {
  /** An agent owns the tab: the off-screen cap never closes its page. */
  pinned?: boolean;
  /**
   * Only keep the page alive (an off-screen host). A page that lives in
   * another window stays there: only a window that shows the tab claims it.
   */
  keepAlive?: boolean;
}

export interface BrowserViewCreateResult {
  webContentsId: number;
  /** The page was already alive (the renderer reads its state). */
  existing: boolean;
  /** keepAlive only: the page lives in another window, which drives it. */
  elsewhere?: boolean;
}

interface Entry {
  key: BrowserViewKey;
  view: WebContentsView;
  contents: WebContents;
  window: BrowserWindow;
  /** Last box the renderer reported, in its CSS pixels. */
  rect: BrowserViewRect | null;
  /** Whether the renderer wants the page on screen. */
  visible: boolean;
  /** A renderer has the tab mounted (shown or not): the off-screen cap skips it. */
  slotMounted: boolean;
  /** Last real size on screen, in window pixels (the parked size). */
  size: { width: number; height: number };
  /** Drawing holds in progress. */
  holds: number;
  /** The 1×1 clipping view a parked page sits in (made on first park). */
  holder: View | null;
  /** Agent-owned: exempt from the off-screen cap. */
  pinned: boolean;
  /** When the page last left the screen (for the off-screen cap). */
  hiddenSince: number;
  title: string;
  placement: BrowserViewPlacement;
  dispose: () => void;
}

/**
 * Convert a renderer CSS-pixel box to window pixels (machine views sit at 0,0).
 * @internal Exported for unit tests.
 */
export function toWindowRect(rect: BrowserViewRect, zoomFactor: number): Electron.Rectangle {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const x = Math.round(rect.x * zoom);
  const y = Math.round(rect.y * zoom);
  return {
    x,
    y,
    width: Math.max(0, Math.round((rect.x + rect.width) * zoom) - x),
    height: Math.max(0, Math.round((rect.y + rect.height) * zoom) - y),
  };
}

export class BrowserViewService implements MainOwnedBrowserViews, MainOwnedBrowserPageOwners {
  private readonly byTab = new Map<string, Entry>();
  private readonly byContents = new Map<number, Entry>();
  private readonly observedWindows = new WeakSet<BrowserWindow>();

  constructor(private readonly deps: BrowserViewServiceDeps) {}

  /**
   * Create the page for a tab in `window` (detached until the renderer
   * reports a box). Creating a tab that exists returns its page; from
   * another window, the page moves there.
   */
  create(
    key: BrowserViewKey,
    window: BrowserWindow,
    url: string,
    options: BrowserViewCreateOptions = {},
  ): BrowserViewCreateResult {
    const existing = this.byTab.get(key.tabId);
    if (existing) {
      if (
        existing.key.backendId !== key.backendId ||
        existing.key.workspaceId !== key.workspaceId
      ) {
        throw new Error('This browser tab belongs to another workspace');
      }
      if (options.pinned !== undefined) existing.pinned = options.pinned;
      if (existing.window !== window) {
        if (options.keepAlive && !existing.window.isDestroyed()) {
          return { webContentsId: existing.contents.id, existing: true, elsewhere: true };
        }
        this.moveToWindow(key.tabId, window);
      }
      return { webContentsId: existing.contents.id, existing: true };
    }
    if (!this.deps.isNavigationAllowed(url)) throw new Error('This address cannot be opened');
    if (window.isDestroyed()) throw new Error('The window is closed');

    const view = this.deps.createView(this.deps.webPreferences());
    const contents = view.webContents;
    this.deps.secureContents(contents);
    const entry: Entry = {
      key: { ...key },
      view,
      contents,
      window,
      rect: null,
      visible: false,
      slotMounted: false,
      size: { ...DEFAULT_PARKED_SIZE },
      holds: 0,
      holder: null,
      pinned: options.pinned === true,
      hiddenSince: this.now(),
      title: '',
      placement: 'detached',
      dispose: () => {},
    };
    entry.dispose = this.forwardPageEvents(entry);
    this.byTab.set(key.tabId, entry);
    this.byContents.set(contents.id, entry);
    this.observeWindow(window);
    // Registered now, not on dom-ready: an agent can reach the tab at once.
    this.deps.cdp.registerTab(key.tabId, contents.id, key.workspaceId);
    contents.loadURL(url).catch((error: unknown) => {
      logger.debug('Browser view load did not finish', {
        tabId: key.tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.enforceDetachedCap(entry);
    return { webContentsId: contents.id, existing: false };
  }

  /** Close a tab's page (tab closed). Idempotent. */
  destroy(tabId: string): void {
    const entry = this.byTab.get(tabId);
    if (!entry) return;
    this.forget(entry);
    this.removeFromWindow(entry);
    this.deps.cdp.unregisterTab(tabId);
    if (!entry.contents.isDestroyed()) entry.contents.close({ waitForBeforeUnload: false });
  }

  /** Close every page of a workspace (archived or deleted). */
  destroyWorkspace(backendId: string, workspaceId: string): void {
    for (const entry of [...this.byTab.values()]) {
      if (entry.key.backendId === backendId && entry.key.workspaceId === workspaceId) {
        this.destroy(entry.key.tabId);
      }
    }
  }

  /**
   * The renderer's box for a tab and whether it is on screen. A box is in
   * the renderer's CSS pixels.
   */
  setPlacement(tabId: string, rect: BrowserViewRect | null, visible: boolean): void {
    const entry = this.byTab.get(tabId);
    if (!entry) return;
    if (rect) entry.rect = { ...rect };
    entry.visible = visible;
    entry.slotMounted = true;
    this.place(entry, true);
  }

  /** Take a tab's page off screen (the renderer unmounted it). The page stays alive. */
  detach(tabId: string): void {
    const entry = this.byTab.get(tabId);
    if (!entry) return;
    entry.visible = false;
    entry.slotMounted = false;
    this.place(entry, false);
    this.enforceDetachedCap(entry);
  }

  /**
   * Move a tab's page to another window with the same webContents: no
   * reload, and the CDP mapping stays. The page is off screen there until
   * that window's renderer reports a box.
   */
  moveToWindow(tabId: string, window: BrowserWindow): void {
    const entry = this.byTab.get(tabId);
    if (!entry || entry.window === window || window.isDestroyed()) return;
    this.removeFromWindow(entry);
    entry.window = window;
    entry.visible = false;
    entry.slotMounted = false;
    entry.rect = null;
    this.observeWindow(window);
    this.place(entry, false);
    // The workspace binding follows the new host renderer.
    this.deps.cdp.registerTab(tabId, entry.contents.id, entry.key.workspaceId);
    this.deps.onPageMoved?.(entry.contents.id);
  }

  /**
   * The window shows another machine: show or hide its pages to match, on top.
   * The rail announces the switch before it raises the selected machine view
   * in the same task, so placement waits one microtask: raising the pages
   * now would leave the machine view above them.
   */
  handleShownMachineChanged(window: BrowserWindow): void {
    queueMicrotask(() => {
      if (window.isDestroyed()) return;
      for (const entry of this.byTab.values()) {
        if (entry.window === window) this.place(entry, true);
      }
    });
  }

  /**
   * Run a command from the tab's controls. `find` returns its request id;
   * `execute-javascript` and `capture` return a promise of their result.
   */
  command(
    tabId: string,
    command: BrowserViewCommand,
  ): BrowserViewCommandResult | Promise<BrowserViewCommandResult> {
    const entry = this.byTab.get(tabId);
    if (!entry || entry.contents.isDestroyed()) throw new Error('This browser tab is closed');
    const contents = entry.contents;
    const history = contents.navigationHistory;
    switch (command.type) {
      case 'navigate':
        if (!this.deps.isNavigationAllowed(command.url)) {
          throw new Error('This address cannot be opened');
        }
        contents.loadURL(command.url).catch(() => {
          // Load failures reach the renderer as a load-failed event.
        });
        return {};
      case 'back':
        if (history.canGoBack()) history.goBack();
        return {};
      case 'forward':
        if (history.canGoForward()) history.goForward();
        return {};
      case 'reload':
        if (command.ignoreCache) contents.reloadIgnoringCache();
        else contents.reload();
        return {};
      case 'stop':
        contents.stop();
        return {};
      case 'set-zoom':
        contents.setZoomFactor(Math.min(MAX_PAGE_ZOOM, Math.max(MIN_PAGE_ZOOM, command.factor)));
        return {};
      case 'find':
        if (!command.text) return {};
        return {
          requestId: contents.findInPage(command.text, {
            forward: command.forward ?? true,
            findNext: command.findNext ?? false,
            matchCase: command.matchCase ?? false,
          }),
        };
      case 'stop-find':
        contents.stopFindInPage(command.action);
        return {};
      case 'open-devtools':
        contents.openDevTools({ mode: 'detach' });
        return {};
      case 'toggle-devtools':
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else contents.openDevTools({ mode: 'detach' });
        return {};
      case 'focus':
        contents.focus();
        return {};
      case 'set-audio-muted':
        contents.setAudioMuted(command.muted);
        return {};
      case 'execute-javascript':
        return contents.executeJavaScript(command.code).then((value: unknown) => ({ value }));
      case 'capture':
        return this.capture(entry, command.rect);
    }
  }

  /** A page's current state, for a renderer that starts showing a live page. */
  stateOf(tabId: string): BrowserViewState | undefined {
    const entry = this.byTab.get(tabId);
    if (!entry || entry.contents.isDestroyed()) return undefined;
    const contents = entry.contents;
    const history = contents.navigationHistory;
    return {
      webContentsId: contents.id,
      url: contents.getURL(),
      title: entry.title,
      loading: contents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      zoomFactor: contents.getZoomFactor(),
    };
  }

  /**
   * Capture the page. A page that is not on screen is parked for the
   * capture, because a detached page does not paint.
   */
  private async capture(
    entry: Entry,
    rect: BrowserViewRect | undefined,
  ): Promise<BrowserViewCommandResult> {
    const release = entry.placement === 'shown' ? undefined : this.holdDrawing(entry.contents.id);
    try {
      const image = rect
        ? await entry.contents.capturePage({
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          })
        : await entry.contents.capturePage();
      return { dataUrl: image.isEmpty() ? '' : image.toDataURL() };
    } finally {
      release?.();
    }
  }

  /** The key of a tab's page, or undefined. */
  keyOf(tabId: string): BrowserViewKey | undefined {
    const entry = this.byTab.get(tabId);
    return entry ? { ...entry.key } : undefined;
  }

  /** The window a tab's page belongs to, or undefined. */
  windowOf(tabId: string): BrowserWindow | undefined {
    return this.byTab.get(tabId)?.window;
  }

  /** Where a tab's page is now (diagnostics and tests). */
  placementOf(tabId: string): BrowserViewPlacement | undefined {
    return this.byTab.get(tabId)?.placement;
  }

  // MainOwnedBrowserViews (the CDP seam)

  owns(webContentsId: number): boolean {
    const entry = this.byContents.get(webContentsId);
    return !!entry && !entry.contents.isDestroyed();
  }

  hostFor(webContentsId: number): WebContents | undefined {
    const entry = this.byContents.get(webContentsId);
    if (!entry || entry.window.isDestroyed()) return undefined;
    return this.deps.machineViewFor(entry.window, entry.key.backendId) ?? undefined;
  }

  // MainOwnedBrowserPageOwners (the passkey seam)

  /**
   * The machine view of the window that has the page now, and whether the
   * page is on screen. Null for a page this service did not make, a closed
   * page, a closed window, or a window with no renderer for the machine.
   */
  pageOwner(webContentsId: number): BrowserPanelPageOwner | null {
    const entry = this.byContents.get(webContentsId);
    if (!entry || entry.contents.isDestroyed() || entry.window.isDestroyed()) return null;
    const host = this.deps.machineViewFor(entry.window, entry.key.backendId);
    if (!host || host.isDestroyed()) return null;
    return { host, shown: entry.placement === 'shown' };
  }

  holdDrawing(webContentsId: number): (() => void) | undefined {
    const entry = this.byContents.get(webContentsId);
    if (!entry) return undefined;
    entry.holds++;
    this.place(entry, false);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.holds = Math.max(0, entry.holds - 1);
      if (this.byContents.get(webContentsId) === entry) this.place(entry, false);
    };
  }

  // Placement

  /**
   * Put the page where its state says. `raise` puts a shown page on top
   * again (a machine switch adds the machine view above it).
   */
  private place(entry: Entry, raise: boolean): void {
    const { window, view, contents } = entry;
    if (window.isDestroyed() || contents.isDestroyed()) return;
    const machine = this.deps.machineViewFor(window, entry.key.backendId);
    const onScreen =
      entry.visible &&
      entry.rect !== null &&
      machine !== null &&
      this.deps.shownMachine(window) === entry.key.backendId;
    const next: BrowserViewPlacement = onScreen
      ? 'shown'
      : entry.holds > 0 && machine !== null
        ? 'parked'
        : 'detached';
    const previous = entry.placement;
    const children = window.contentView;
    try {
      if (previous === 'parked' && next !== 'parked') this.unpark(entry);
      if (next === 'shown' && entry.rect && machine) {
        const bounds = toWindowRect(entry.rect, machine.getZoomFactor());
        view.setBounds(bounds);
        if (bounds.width > 0 && bounds.height > 0) {
          entry.size = { width: bounds.width, height: bounds.height };
        }
        // Adding a child again moves it to the top, above the machine view.
        if (previous !== 'shown' || raise) children.addChildView(view);
        view.setVisible(true);
      } else if (next === 'parked') {
        if (previous === 'shown') children.removeChildView(view);
        const holder = (entry.holder ??= this.deps.createParkingHolder());
        holder.setBounds({ x: 0, y: 0, width: 1, height: 1 });
        // Index 0: under the machine view.
        if (previous !== 'parked') children.addChildView(holder, 0);
        view.setBounds({ x: 0, y: 0, ...entry.size });
        if (previous !== 'parked') holder.addChildView(view);
        view.setVisible(true);
      } else if (previous === 'shown') {
        children.removeChildView(view);
      }
      // Parking turns throttling off. Leaving it turns throttling back on only
      // when no hold is left: a hold's owner (the CDP capture hold) restores
      // its own setting when it ends.
      if (next === 'parked' && previous !== 'parked') contents.backgroundThrottling = false;
      if (next !== 'parked' && previous === 'parked' && entry.holds === 0) {
        contents.backgroundThrottling = true;
      }
      entry.placement = next;
      if (previous !== 'detached' && next === 'detached') {
        entry.hiddenSince = this.now();
        this.enforceDetachedCap(entry);
      }
    } catch (error) {
      logger.warn('Could not place a browser view', {
        tabId: entry.key.tabId,
        placement: next,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Close the oldest off-screen pages over the cap. Pinned pages, held
   * pages and `keep` (the page that just changed) are never closed.
   */
  private enforceDetachedCap(keep: Entry): void {
    const max = this.deps.maxDetached ?? DEFAULT_MAX_DETACHED_VIEWS;
    const hidden = [...this.byTab.values()].filter(
      (entry) =>
        entry.placement === 'detached' && !entry.pinned && !entry.slotMounted && entry.holds === 0,
    );
    let excess = hidden.length - max;
    if (excess <= 0) return;
    const oldestFirst = hidden
      .filter((entry) => entry !== keep)
      .sort((a, b) => a.hiddenSince - b.hiddenSince);
    for (const entry of oldestFirst) {
      if (excess <= 0) break;
      excess--;
      logger.info('Closing an off-screen browser page over the cap', { tabId: entry.key.tabId });
      this.destroy(entry.key.tabId);
      this.emit(entry, { type: 'closed-offscreen' });
    }
  }

  /** Take a parked page out of its holder and the holder out of the window. */
  private unpark(entry: Entry): void {
    const holder = entry.holder;
    if (!holder) return;
    holder.removeChildView(entry.view);
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(holder);
  }

  private removeFromWindow(entry: Entry): void {
    if (entry.placement === 'detached') return;
    const wasParked = entry.placement === 'parked';
    entry.placement = 'detached';
    try {
      if (wasParked) this.unpark(entry);
      else if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view);
      if (wasParked && entry.holds === 0 && !entry.contents.isDestroyed()) {
        entry.contents.backgroundThrottling = true;
      }
    } catch {
      // The window is already tearing its views down.
    }
  }

  private forget(entry: Entry): void {
    if (this.byTab.get(entry.key.tabId) === entry) this.byTab.delete(entry.key.tabId);
    if (this.byContents.get(entry.contents.id) === entry) this.byContents.delete(entry.contents.id);
    entry.dispose();
  }

  private observeWindow(window: BrowserWindow): void {
    if (this.observedWindows.has(window)) return;
    this.observedWindows.add(window);
    window.on('close', () => {
      const tabIds = this.tabIdsIn(window);
      if (tabIds.length > 0) this.deps.onWindowClosing?.(window, tabIds);
    });
    // A closed window leaves its child views alive; close what is still here.
    window.once('closed', () => {
      for (const tabId of this.tabIdsIn(window)) this.destroy(tabId);
    });
  }

  private tabIdsIn(window: BrowserWindow): string[] {
    return [...this.byTab.values()]
      .filter((entry) => entry.window === window)
      .map((entry) => entry.key.tabId);
  }

  // Page events

  private emit(entry: Entry, event: BrowserViewPageEvent): void {
    if (entry.window.isDestroyed()) return;
    const target = this.deps.machineViewFor(entry.window, entry.key.backendId);
    if (!target || target.isDestroyed()) return;
    try {
      this.deps.send(target, {
        tabId: entry.key.tabId,
        workspaceId: entry.key.workspaceId,
        event,
      });
    } catch {
      // A renderer torn down mid-send has nobody left to tell.
    }
  }

  /** Forward the page's events to its renderer; returns the disposer. */
  private forwardPageEvents(entry: Entry): () => void {
    const contents = entry.contents;
    const navigated = (url: string, inPage: boolean): void => {
      const history = contents.navigationHistory;
      this.emit(entry, {
        type: 'navigated',
        url,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        ...(inPage ? { inPage: true } : {}),
      });
    };
    const listeners: Array<[string, (...args: any[]) => void]> = [
      ['did-start-loading', () => this.emit(entry, { type: 'loading', loading: true })],
      ['did-stop-loading', () => this.emit(entry, { type: 'loading', loading: false })],
      ['did-navigate', (_event: unknown, url: string) => navigated(url, false)],
      [
        'did-navigate-in-page',
        (_event: unknown, url: string, isMainFrame: boolean) => {
          if (isMainFrame) navigated(url, true);
        },
      ],
      [
        'page-title-updated',
        (_event: unknown, title: string) => {
          entry.title = title;
          this.emit(entry, { type: 'title', title });
        },
      ],
      [
        'page-favicon-updated',
        (_event: unknown, favicons: string[]) => this.emit(entry, { type: 'favicon', favicons }),
      ],
      [
        'did-fail-load',
        (
          _event: unknown,
          errorCode: number,
          errorDescription: string,
          url: string,
          isMainFrame: boolean,
        ) => {
          // -3 (ERR_ABORTED) is a load replaced by another one, not a failure.
          if (!isMainFrame || errorCode === -3) return;
          this.emit(entry, { type: 'load-failed', url, errorCode, errorDescription });
        },
      ],
      [
        'render-process-gone',
        (_event: unknown, details: Electron.RenderProcessGoneDetails) =>
          this.emit(entry, {
            type: 'crashed',
            reason: details.reason,
            exitCode: details.exitCode,
          }),
      ],
      [
        'found-in-page',
        (_event: unknown, result: Electron.Result) =>
          this.emit(entry, {
            type: 'found-in-page',
            requestId: result.requestId,
            activeMatchOrdinal: result.activeMatchOrdinal,
            matches: result.matches,
            finalUpdate: result.finalUpdate,
          }),
      ],
      [
        'context-menu',
        (_event: unknown, params: Electron.ContextMenuParams) =>
          this.emit(entry, {
            type: 'context-menu',
            x: params.x,
            y: params.y,
            linkURL: params.linkURL,
            srcURL: params.srcURL,
            mediaType: params.mediaType,
            selectionText: params.selectionText,
            isEditable: params.isEditable,
            canCopy: params.editFlags.canCopy,
            canCut: params.editFlags.canCut,
            canPaste: params.editFlags.canPaste,
            canSelectAll: params.editFlags.canSelectAll,
          }),
      ],
      ['focus', () => this.emit(entry, { type: 'focused' })],
      [
        'console-message',
        (details: { level?: unknown; message?: unknown }) => {
          const message = typeof details?.message === 'string' ? details.message : '';
          // Errors feed the console badge (count only); app messages drive the picker.
          if (message.startsWith(APP_CONSOLE_PREFIX)) {
            this.emit(entry, { type: 'console-message', level: 'info', message });
          } else if (details?.level === 'error') {
            this.emit(entry, { type: 'console-message', level: 'error', message: '' });
          }
        },
      ],
      [
        'before-input-event',
        (event: Electron.Event, input: Electron.Input) => {
          const shortcut = classifyBrowserViewShortcut(
            input,
            this.deps.isMac ?? process.platform === 'darwin',
          );
          if (!shortcut) return;
          event.preventDefault();
          this.emit(entry, { type: 'shortcut', shortcut });
        },
      ],
    ];
    const emitter = contents as unknown as NodeJS.EventEmitter;
    for (const [name, listener] of listeners) emitter.on(name, listener);
    // A page that ends by itself (window.close(), crash teardown) leaves the registry.
    const onDestroyed = (): void => {
      if (this.byTab.get(entry.key.tabId) !== entry) return;
      this.forget(entry);
      this.removeFromWindow(entry);
      this.deps.cdp.unregisterTab(entry.key.tabId);
      this.emit(entry, { type: 'page-closed' });
    };
    contents.once('destroyed', onDestroyed);
    return () => {
      for (const [name, listener] of listeners) emitter.removeListener(name, listener);
      contents.removeListener('destroyed', onDestroyed);
    };
  }
}
