/**
 * Wire types for main-owned browser views (BrowserViewService, Labs).
 *
 * Main owns each browser tab's page as a `WebContentsView`. The renderer that
 * shows the tab sends where its box is and the commands of its controls; main
 * sends the page's events back on one channel, keyed by tabId.
 */

import type { BrowserViewShortcut } from '../browser-view-shortcuts';

/** A box in renderer CSS pixels, relative to the renderer's viewport. */
export interface BrowserViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A command from the tab's controls to its page. */
export type BrowserViewCommand =
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload'; ignoreCache?: boolean }
  | { type: 'stop' }
  | { type: 'set-zoom'; factor: number }
  | {
      type: 'find';
      text: string;
      forward?: boolean;
      findNext?: boolean;
      matchCase?: boolean;
    }
  | { type: 'stop-find'; action: 'clearSelection' | 'keepSelection' | 'activateSelection' }
  | { type: 'open-devtools' }
  | { type: 'toggle-devtools' }
  | { type: 'focus' }
  | { type: 'set-audio-muted'; muted: boolean }
  /** Run app-owned script in the page (element picker). Returns `{ value }`. */
  | { type: 'execute-javascript'; code: string }
  /** Capture the page (or a box of it, in page CSS pixels). Returns `{ dataUrl }`. */
  | { type: 'capture'; rect?: BrowserViewRect };

/** What a command returns. */
export interface BrowserViewCommandResult {
  /** `find`: the request id of the search. */
  requestId?: number;
  /** `execute-javascript`: the script's result. */
  value?: unknown;
  /** `capture`: a PNG data URL (empty when the page drew nothing). */
  dataUrl?: string;
}

/** A page's current state: a renderer that shows a live page reads it first. */
export interface BrowserViewState {
  webContentsId: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
}

/** A page event, sent to the renderer that shows the tab. */
export type BrowserViewPageEvent =
  | { type: 'loading'; loading: boolean }
  | {
      type: 'navigated';
      url: string;
      canGoBack: boolean;
      canGoForward: boolean;
      /** Same-document navigation (history API, hash): the title and favicon stay. */
      inPage?: boolean;
    }
  | { type: 'title'; title: string }
  | { type: 'favicon'; favicons: string[] }
  | {
      type: 'load-failed';
      url: string;
      errorCode: number;
      errorDescription: string;
    }
  | { type: 'crashed'; reason: string; exitCode: number }
  | {
      type: 'found-in-page';
      requestId: number;
      activeMatchOrdinal: number;
      matches: number;
      finalUpdate: boolean;
    }
  | {
      type: 'context-menu';
      /** Point in the page's CSS pixels. */
      x: number;
      y: number;
      linkURL: string;
      srcURL: string;
      mediaType: string;
      selectionText: string;
      isEditable: boolean;
      canCopy: boolean;
      canCut: boolean;
      canPaste: boolean;
      canSelectAll: boolean;
    }
  | { type: 'focused' }
  /** An error in the page console, or an app protocol message (`__INTENT_…`). */
  | { type: 'console-message'; level: 'error' | 'info'; message: string }
  /** An app shortcut typed in the page; main kept it from the page. */
  | { type: 'shortcut'; shortcut: BrowserViewShortcut }
  /** Main closed the page to stay under the off-screen cap; showing the tab loads it again. */
  | { type: 'closed-offscreen' }
  /** The page ended by itself (it called `window.close()`). */
  | { type: 'page-closed' };

/** Payload of the main → renderer page-event channel. */
export interface BrowserViewEventMessage {
  tabId: string;
  workspaceId: string;
  event: BrowserViewPageEvent;
}
