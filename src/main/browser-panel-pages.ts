/**
 * Which app renderer owns a browser-panel page now. A `<webview>` guest is
 * owned by its host renderer; a main-owned page (BrowserViewService, Labs)
 * is owned by the machine view of the window it is in. Main answers from
 * its own records, never from data the page sends.
 *
 * The passkey guest IPC guard (`ipc-authorization.ts`) and PasskeyService
 * read owners here, so both see the same answer.
 */
import { session, type WebContents } from 'electron';
import { BROWSER_PANEL_PARTITION } from '../shared/constants';

export interface BrowserPanelPageOwner {
  /** The app renderer that owns the page (not yet checked as trusted). */
  host: WebContents;
  /** The page is on screen. A `<webview>` guest always counts as shown. */
  shown: boolean;
}

/** What BrowserViewService tells the rest of main about its pages. */
export interface MainOwnedBrowserPageOwners {
  /** The owner of the page with this webContents, or null when the service has no live page for it. */
  pageOwner(webContentsId: number): BrowserPanelPageOwner | null;
}

let mainOwnedPages: MainOwnedBrowserPageOwners | null = null;
const movedListeners = new Set<(webContentsId: number) => void>();

/** Connect BrowserViewService (once, at startup; tests pass null to reset). */
export function setMainOwnedBrowserPageOwners(pages: MainOwnedBrowserPageOwners | null): void {
  mainOwnedPages = pages;
}

/** BrowserViewService moved a page to another window. */
export function notifyMainOwnedBrowserPageMoved(webContentsId: number): void {
  for (const listener of [...movedListeners]) {
    try {
      listener(webContentsId);
    } catch {
      // One listener's failure does not stop the others.
    }
  }
}

/** Listen for main-owned pages that move to another window; returns the disposer. */
export function onMainOwnedBrowserPageMoved(listener: (webContentsId: number) => void): () => void {
  movedListeners.add(listener);
  return () => movedListeners.delete(listener);
}

/**
 * The owner of a browser-panel page, or null when `contents` is not a live
 * browser-panel page: a `<webview>` guest or a page BrowserViewService made.
 */
export function browserPanelPageOwner(contents: WebContents): BrowserPanelPageOwner | null {
  if (!contents || contents.isDestroyed()) return null;
  if (contents.session !== session.fromPartition(BROWSER_PANEL_PARTITION)) return null;
  switch (contents.getType()) {
    case 'webview': {
      const host = contents.hostWebContents;
      return host ? { host, shown: true } : null;
    }
    // A WebContentsView reports 'window'. In this session only pages that
    // BrowserViewService made count; popups and other views get no owner.
    case 'window':
      return mainOwnedPages?.pageOwner(contents.id) ?? null;
    default:
      return null;
  }
}
