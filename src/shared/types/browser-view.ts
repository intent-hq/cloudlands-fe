/**
 * Wire types for main-owned browser views (BrowserViewService, Labs).
 *
 * Main owns each browser tab's page as a `WebContentsView`. The renderer that
 * shows the tab sends where its box is and the commands of its controls; main
 * sends the page's events back on one channel, keyed by tabId.
 */

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
  | { type: 'focus' };

/** A page event, sent to the renderer that shows the tab. */
export type BrowserViewPageEvent =
  | { type: 'loading'; loading: boolean }
  | { type: 'navigated'; url: string; canGoBack: boolean; canGoForward: boolean }
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
  | { type: 'focused' };

/** Payload of the main → renderer page-event channel. */
export interface BrowserViewEventMessage {
  tabId: string;
  workspaceId: string;
  event: BrowserViewPageEvent;
}
