/**
 * TabWindowRegistry — main process (design §3).
 *
 * Any panel tab can move to a window of its own. Main keeps one record per
 * tab window: its tab (kept current by the tab window's renderer), the
 * workspace and panel layout it came from, and the window it came from.
 *
 * - Move out: the source renderer keeps the tab as a hidden copy marked with
 *   the tab window id, then asks main to open the window. A browser tab's
 *   main-owned page moves to the new window with the same webContents, so
 *   the page does not reload.
 * - Move back, or close the window: the page moves back first (while the
 *   window is still open; a closed window destroys its pages), then the
 *   source window shows the tab again. With no source window left, another
 *   frame of the same machine takes it, or a new frame opens.
 * - Close tab: the tab closes for real, then the window.
 * - Quit: the record is saved with the frame and comes back at start.
 *
 * Electron and the rest of main reach this module only through
 * {@link TabWindowRegistryDeps}, so every flow can be tested directly.
 */

import type { BrowserWindow, WebContents } from 'electron';
import { Logger } from '../shared/logger';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import {
  isTabWindowId,
  tabWindowRoute,
  type TabWindowClosedTabEvent,
  type TabWindowDisplayMode,
  type TabWindowOpenParams,
  type TabWindowRecord,
  type TabWindowReturnEvent,
  type TabWindowTab,
  type TabWindowTabUpdatedEvent,
} from '../shared/types/tab-window';

const logger = new Logger('TabWindows');
const CHANNELS = IPC_CHANNELS.TAB_WINDOW;

/** How long the source window may take to enter macOS full screen before the tab window opens anyway. */
const SOURCE_FULL_SCREEN_TIMEOUT_MS = 1_500;

/** Most tab windows closed for real this run that `isOpen` still reports as closed. */
const MAX_CLOSED_REMEMBERED = 200;

export interface TabWindowRegistryDeps {
  /** Open a frame on `backendId` at `route`, marked as a tab window. */
  openFrame(backendId: string, route: string, mode: TabWindowDisplayMode): Promise<BrowserWindow>;
  /** The renderer serving `backendId` in `window`, or null. */
  rendererFor(window: BrowserWindow, backendId: string): WebContents | null;
  /**
   * A live frame (never a tab window) of `backendId` to take a tab back:
   * `preferred` when it still holds the machine, else the most recent one.
   */
  returnTarget(backendId: string, preferred: BrowserWindow | null): BrowserWindow | null;
  /** Open a frame on `backendId` when none is left to take a tab back. */
  openReturnFrame(backendId: string): Promise<BrowserWindow | null>;
  /** Move a browser tab's main-owned page to `window` (no-op without one). */
  moveBrowserPage(tabId: string, window: BrowserWindow): void;
  /** Close a browser tab's main-owned page (no-op without one). */
  destroyBrowserPage(tabId: string): void;
  /** Who owns a browser tab's main-owned page, or null when it has none. */
  browserPageOwner(
    tabId: string,
  ): { backendId: string; workspaceId: string; window: BrowserWindow | null } | null;
  /** The app is quitting: a closing tab window is saved, not moved back. */
  isQuitting(): boolean;
  /** How a tab window fills the screen on this platform. */
  displayMode: TabWindowDisplayMode;
  /** macOS: the source window goes full screen too, so every window is a Space. */
  isMac: boolean;
  newId(): string;
  send(target: WebContents, channel: string, payload: unknown): void;
}

interface Entry {
  record: TabWindowRecord;
  backendId: string;
  /** Null while a saved tab window is reopening. */
  window: BrowserWindow | null;
  /** The window the tab came from; null after a restart. */
  source: BrowserWindow | null;
  /** Why the window is closing: back (move the tab back) or close (the tab closed). */
  closing: 'back' | 'close' | null;
}

function copyTab(tab: TabWindowTab): TabWindowTab {
  return { ...tab };
}

export class TabWindowRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly closedForReal: string[] = [];

  constructor(private readonly deps: TabWindowRegistryDeps) {}

  /**
   * Move a tab of `source` to a new tab window. A tab that already has one
   * brings that window to the front instead. Resolves with the id.
   */
  async open(
    source: BrowserWindow,
    backendId: string,
    params: TabWindowOpenParams,
  ): Promise<string> {
    const existing = this.entryForTab(params.tab.id);
    if (existing) {
      // Another machine's or workspace's tab with this id is not the caller's to show.
      if (existing.backendId !== backendId || existing.record.workspaceId !== params.workspaceId) {
        throw new Error('This tab belongs to another workspace');
      }
      this.focus(existing.record.tabWindowId);
      return existing.record.tabWindowId;
    }
    this.requirePageOwner(params.tab.id, source, backendId, params.workspaceId);
    const tabWindowId =
      isTabWindowId(params.tabWindowId) && !this.entries.has(params.tabWindowId)
        ? params.tabWindowId
        : this.deps.newId();
    const { tabWindowId: _staleId, ...tab } = params.tab;
    const entry: Entry = {
      record: {
        tabWindowId,
        workspaceId: params.workspaceId,
        sourceLayoutId: params.sourceLayoutId,
        tab: copyTab(tab),
      },
      backendId,
      window: null,
      source,
      closing: null,
    };
    this.entries.set(tabWindowId, entry);
    try {
      if (this.deps.isMac && this.deps.displayMode === 'full-screen') {
        await this.enterFullScreen(source);
      }
      const window = await this.deps.openFrame(
        backendId,
        tabWindowRoute(tabWindowId),
        this.deps.displayMode,
      );
      this.attach(entry, window);
    } catch (error) {
      this.entries.delete(tabWindowId);
      throw error;
    }
    logger.info('Opened a tab window', { tabWindowId, type: params.tab.type });
    return tabWindowId;
  }

  /** The record of the tab window `window`, or null. */
  recordFor(window: BrowserWindow): TabWindowRecord | null {
    const entry = this.entryForWindow(window);
    return entry ? { ...entry.record, tab: copyTab(entry.record.tab) } : null;
  }

  /** Whether a tab window is open (or reopening), or was closed for real this run. */
  status(tabWindowId: string): { open: boolean; closed: boolean } {
    return {
      open: this.entries.has(tabWindowId),
      closed: this.closedForReal.includes(tabWindowId),
    };
  }

  /** The tab window's renderer reports its tab changed. The source keeps its hidden copy current. */
  update(window: BrowserWindow, tab: TabWindowTab): void {
    const entry = this.entryForWindow(window);
    if (!entry || tab.id !== entry.record.tab.id) return;
    const { tabWindowId: _ignored, ...next } = tab;
    entry.record.tab = { ...entry.record.tab, ...next, id: entry.record.tab.id };
    const target = this.deps.returnTarget(entry.backendId, this.liveSource(entry));
    const event: TabWindowTabUpdatedEvent = {
      tabWindowId: entry.record.tabWindowId,
      workspaceId: entry.record.workspaceId,
      sourceLayoutId: entry.record.sourceLayoutId,
      tab: copyTab(entry.record.tab),
    };
    this.sendTo(target, entry.backendId, CHANNELS.TAB_UPDATED, event);
  }

  /** Move the tab of `window` back to the window it came from, then close `window`. */
  moveBack(window: BrowserWindow): void {
    const entry = this.entryForWindow(window);
    if (!entry || window.isDestroyed()) return;
    entry.closing = 'back';
    window.close();
  }

  /** Close the tab of `window` for real, then `window`. */
  closeTab(window: BrowserWindow): void {
    const entry = this.entryForWindow(window);
    if (!entry || window.isDestroyed()) return;
    entry.closing = 'close';
    const { record } = entry;
    if (this.ownsPage(entry, window)) this.deps.destroyBrowserPage(record.tab.id);
    const target = this.deps.returnTarget(entry.backendId, this.liveSource(entry));
    const event: TabWindowClosedTabEvent = {
      tabWindowId: record.tabWindowId,
      workspaceId: record.workspaceId,
      sourceLayoutId: record.sourceLayoutId,
      tabId: record.tab.id,
    };
    this.sendTo(target, entry.backendId, CHANNELS.CLOSED_TAB, event);
    this.rememberClosed(record.tabWindowId);
    window.close();
  }

  /** Bring a tab window to the front. False when it is not open. */
  focus(tabWindowId: string): boolean {
    const window = this.entries.get(tabWindowId)?.window;
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  }

  // Saved frames (window.ts, through tab-window-identity)

  /** The record `window` saves with its frame, or null for a window that is not a tab window. */
  sessionFor(window: BrowserWindow): TabWindowRecord | null {
    return this.recordFor(window);
  }

  /** A saved tab window is reopening on `backendId`. */
  willRestore(record: TabWindowRecord, backendId: string): boolean {
    const pending = this.entries.get(record.tabWindowId);
    if (pending) return !pending.window && pending.backendId === backendId;
    if (this.entryForTab(record.tab.id)) return false;
    this.entries.set(record.tabWindowId, {
      record: { ...record, tab: copyTab(record.tab) },
      backendId,
      window: null,
      source: null,
      closing: null,
    });
    return true;
  }

  /** The saved tab window reopened as `window`. */
  restored(window: BrowserWindow, tabWindowId: string): void {
    const entry = this.entries.get(tabWindowId);
    if (entry && !entry.window) this.attach(entry, window);
  }

  /**
   * A saved tab window could not reopen: its tab goes back to a frame of
   * its machine, if one is open (its renderer also checks on restore).
   */
  restoreFailed(tabWindowId: string): void {
    const entry = this.entries.get(tabWindowId);
    if (!entry || entry.window) return;
    this.entries.delete(tabWindowId);
    const target = this.deps.returnTarget(entry.backendId, null);
    this.sendTo(target, entry.backendId, CHANNELS.RETURN_TAB, this.returnEvent(entry, false));
  }

  // Internals

  /**
   * Browser pages are keyed by tab id across every machine and window. A
   * tab window moves and can close the page of its tab, so the caller must
   * own that page: the same machine and workspace, in the caller's window.
   * A tab with no page yet passes here, but grants nothing: every later move
   * or close checks the live page again (`ownsPage`).
   */
  private requirePageOwner(
    tabId: string,
    source: BrowserWindow,
    backendId: string,
    workspaceId: string,
  ): void {
    const owner = this.deps.browserPageOwner(tabId);
    if (!owner) return;
    if (owner.backendId !== backendId || owner.workspaceId !== workspaceId) {
      throw new Error('This browser tab belongs to another workspace');
    }
    if (owner.window !== source) throw new Error('This browser tab belongs to another window');
  }

  /**
   * Whether the tab's live page belongs to this tab window: a browser tab
   * whose page has the machine and workspace the record was opened (or
   * restored) for, in `from` when that is given. Checked at every move and
   * close, never once for good: a page that is absent is not this tab
   * window's, and one created later for another machine is never touched.
   */
  private ownsPage(entry: Entry, from: BrowserWindow | null): boolean {
    if (entry.record.tab.type !== 'browser') return false;
    const owner = this.deps.browserPageOwner(entry.record.tab.id);
    if (!owner) return false;
    if (owner.backendId !== entry.backendId || owner.workspaceId !== entry.record.workspaceId) {
      return false;
    }
    return from === null || owner.window === from;
  }

  private attach(entry: Entry, window: BrowserWindow): void {
    entry.window = window;
    window.on('close', (event: Electron.Event) => this.handleClose(entry, window, event));
    window.once('closed', () => {
      if (this.entries.get(entry.record.tabWindowId) === entry) {
        this.entries.delete(entry.record.tabWindowId);
      }
    });
    // Checked now, after the frame opened: the page may have changed meanwhile.
    if (this.ownsPage(entry, entry.source)) this.deps.moveBrowserPage(entry.record.tab.id, window);
  }

  /**
   * The tab window is closing. Unless the app quits (the frame is saved) or
   * the tab closed for real, the tab goes back now, while the window still
   * holds the page. With no frame left to take it, the close waits for a
   * new frame.
   */
  private handleClose(entry: Entry, window: BrowserWindow, event: Electron.Event): void {
    if (this.entries.get(entry.record.tabWindowId) !== entry) return;
    if (this.deps.isQuitting() || entry.closing === 'close') {
      this.entries.delete(entry.record.tabWindowId);
      return;
    }
    const target = this.deps.returnTarget(entry.backendId, this.liveSource(entry));
    if (!target) {
      event.preventDefault();
      void this.deps
        .openReturnFrame(entry.backendId)
        .catch((error: unknown) => {
          logger.warn('Could not open a window to take a tab back', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
        .then((opened) => {
          if (window.isDestroyed()) return;
          if (!opened) {
            // Nothing can take the tab: the window closes and its saved
            // hidden copy comes back when a window of the machine opens.
            this.entries.delete(entry.record.tabWindowId);
          }
          window.close();
        });
      return;
    }
    this.entries.delete(entry.record.tabWindowId);
    if (this.ownsPage(entry, window)) this.deps.moveBrowserPage(entry.record.tab.id, target);
    const reveal = entry.closing === 'back';
    this.sendTo(target, entry.backendId, CHANNELS.RETURN_TAB, this.returnEvent(entry, reveal));
    if (reveal && !target.isDestroyed()) {
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
    }
    logger.info('Moved a tab back from its window', { tabWindowId: entry.record.tabWindowId });
  }

  private returnEvent(entry: Entry, reveal: boolean): TabWindowReturnEvent {
    return {
      reveal,
      tabWindowId: entry.record.tabWindowId,
      workspaceId: entry.record.workspaceId,
      sourceLayoutId: entry.record.sourceLayoutId,
      tab: copyTab(entry.record.tab),
    };
  }

  /** macOS: put the source window in full screen first, and wait for it (bounded). */
  private async enterFullScreen(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || window.isFullScreen()) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (!window.isDestroyed()) window.removeListener('enter-full-screen', done);
        resolve();
      };
      const timer = setTimeout(done, SOURCE_FULL_SCREEN_TIMEOUT_MS);
      window.once('enter-full-screen', done);
      window.setFullScreen(true);
    });
  }

  private liveSource(entry: Entry): BrowserWindow | null {
    return entry.source && !entry.source.isDestroyed() ? entry.source : null;
  }

  private sendTo(
    window: BrowserWindow | null,
    backendId: string,
    channel: string,
    payload: unknown,
  ): void {
    if (!window || window.isDestroyed()) return;
    const renderer = this.deps.rendererFor(window, backendId);
    if (!renderer || renderer.isDestroyed()) return;
    this.deps.send(renderer, channel, payload);
  }

  private rememberClosed(tabWindowId: string): void {
    this.closedForReal.push(tabWindowId);
    if (this.closedForReal.length > MAX_CLOSED_REMEMBERED) this.closedForReal.shift();
  }

  private entryForWindow(window: BrowserWindow): Entry | undefined {
    for (const entry of this.entries.values()) if (entry.window === window) return entry;
    return undefined;
  }

  private entryForTab(tabId: string): Entry | undefined {
    for (const entry of this.entries.values()) if (entry.record.tab.id === tabId) return entry;
    return undefined;
  }
}
