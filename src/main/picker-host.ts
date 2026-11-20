/**
 * Which app renderer shows an in-app file picker for a given page.
 *
 * Only app renderers that run InAppFileDialogHost (they announce themselves
 * with `in-app-file-dialog:host-ready`) can show the picker. A chooser or
 * download can start in a website page instead: a `<webview>` guest, a
 * main-owned browser view, or a popup window a site opened. Sending the
 * request to such a page would reach the website, so the page is walked back
 * to an app renderer: a guest's embedder, a popup's opener, or the app
 * renderer its window shows. When none can host the picker the caller
 * cancels (never a native dialog).
 */

/** The page relations the walk follows; injected so tests can model them. */
export interface PickerHostGraph<C> {
  isHost(contents: C): boolean;
  /** A `<webview>` guest's embedder (`hostWebContents`). */
  embedderOf(contents: C): C | undefined;
  /** The page that opened a popup (`webContents.opener`'s page). */
  openerOf(contents: C): C | undefined;
  /** The app renderer that the page's window shows, if the window has one. */
  shownRendererOf(contents: C): C | undefined;
}

const MAX_HOPS = 16;

/** Resolve `start` to an app renderer that can show the picker, or `null`. */
export function resolvePickerHost<C>(start: C | undefined, graph: PickerHostGraph<C>): C | null {
  const seen = new Set<C>();
  let current = start;
  for (let hop = 0; current !== undefined && hop < MAX_HOPS; hop += 1) {
    if (seen.has(current)) return null;
    seen.add(current);
    if (graph.isHost(current)) return current;
    const next = graph.embedderOf(current) ?? graph.openerOf(current);
    if (next !== undefined) {
      current = next;
      continue;
    }
    const shown = graph.shownRendererOf(current);
    return shown !== undefined && shown !== current && graph.isHost(shown) ? shown : null;
  }
  return null;
}
