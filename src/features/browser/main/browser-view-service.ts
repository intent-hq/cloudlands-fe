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
 *   background throttling off, while a drawing hold (agent screenshot or
 *   agent activity) needs frames from a page that is not on screen. A view
 *   in no window does not paint, and Electron 44 has no capturer count;
 * - detached: in no window. It still runs JS and answers CDP evaluate.
 *
 * Moving a view to another window keeps its webContents, so the page does
 * not reload and the CDP tabId → webContentsId mapping does not change.
 */

import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { Logger } from '../../../shared/logger';
import type {
  BrowserViewCommand,
  BrowserViewEventMessage,
  BrowserViewPageEvent,
  BrowserViewRect,
} from '../../../shared/types/browser-view';
import type { MainOwnedBrowserViews } from './embedded-browser-cdp-service';

const logger = new Logger('BrowserViewService');

/** Size a view is parked at before any renderer has reported its box. */
const DEFAULT_PARKED_SIZE = { width: 1280, height: 800 } as const;

/** Zoom factors a page accepts (Chromium's own range). */
const MIN_PAGE_ZOOM = 0.25;
const MAX_PAGE_ZOOM = 5;

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
  /** Last real size on screen, in window pixels (the parked size). */
  size: { width: number; height: number };
  /** Drawing holds in progress. */
  holds: number;
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

export class BrowserViewService implements MainOwnedBrowserViews {
  private readonly byTab = new Map<string, Entry>();
  private readonly byContents = new Map<number, Entry>();
  private readonly observedWindows = new WeakSet<BrowserWindow>();

  constructor(private readonly deps: BrowserViewServiceDeps) {}

  /**
   * Create the page for a tab in `window` (detached until the renderer
   * reports a box). Creating a tab that exists returns its page; from
   * another window, the page moves there.
   */
  create(key: BrowserViewKey, window: BrowserWindow, url: string): { webContentsId: number } {
    const existing = this.byTab.get(key.tabId);
    if (existing) {
      if (
        existing.key.backendId !== key.backendId ||
        existing.key.workspaceId !== key.workspaceId
      ) {
        throw new Error('This browser tab belongs to another workspace');
      }
      if (existing.window !== window) this.moveToWindow(key.tabId, window);
      return { webContentsId: existing.contents.id };
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
      size: { ...DEFAULT_PARKED_SIZE },
      holds: 0,
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
    return { webContentsId: contents.id };
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
    this.place(entry, true);
  }

  /** Take a tab's page off screen (the renderer unmounted it). The page stays alive. */
  detach(tabId: string): void {
    const entry = this.byTab.get(tabId);
    if (!entry) return;
    entry.visible = false;
    this.place(entry, false);
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
    entry.rect = null;
    this.observeWindow(window);
    this.place(entry, false);
    // The workspace binding follows the new host renderer.
    this.deps.cdp.registerTab(tabId, entry.contents.id, entry.key.workspaceId);
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

  /** Run a command from the tab's controls. Returns the find request id for `find`. */
  command(tabId: string, command: BrowserViewCommand): { requestId?: number } {
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
      case 'focus':
        contents.focus();
        return {};
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
        view.setBounds({ x: 0, y: 0, ...entry.size });
        // Index 0: under the machine view, which covers it fully.
        if (previous !== 'parked') children.addChildView(view, 0);
        view.setVisible(true);
      } else if (previous !== 'detached') {
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
    } catch (error) {
      logger.warn('Could not place a browser view', {
        tabId: entry.key.tabId,
        placement: next,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private removeFromWindow(entry: Entry): void {
    if (entry.placement === 'detached') return;
    const wasParked = entry.placement === 'parked';
    entry.placement = 'detached';
    try {
      if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view);
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
    const navigated = (url: string): void => {
      const history = contents.navigationHistory;
      this.emit(entry, {
        type: 'navigated',
        url,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
      });
    };
    const listeners: Array<[string, (...args: any[]) => void]> = [
      ['did-start-loading', () => this.emit(entry, { type: 'loading', loading: true })],
      ['did-stop-loading', () => this.emit(entry, { type: 'loading', loading: false })],
      ['did-navigate', (_event: unknown, url: string) => navigated(url)],
      [
        'did-navigate-in-page',
        (_event: unknown, url: string, isMainFrame: boolean) => {
          if (isMainFrame) navigated(url);
        },
      ],
      [
        'page-title-updated',
        (_event: unknown, title: string) => this.emit(entry, { type: 'title', title }),
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
    ];
    const emitter = contents as unknown as NodeJS.EventEmitter;
    for (const [name, listener] of listeners) emitter.on(name, listener);
    // A page that ends by itself (window.close(), crash teardown) leaves the registry.
    const onDestroyed = (): void => {
      if (this.byTab.get(entry.key.tabId) !== entry) return;
      this.forget(entry);
      this.removeFromWindow(entry);
      this.deps.cdp.unregisterTab(entry.key.tabId);
    };
    contents.once('destroyed', onDestroyed);
    return () => {
      for (const [name, listener] of listeners) emitter.removeListener(name, listener);
      contents.removeListener('destroyed', onDestroyed);
    };
  }
}
