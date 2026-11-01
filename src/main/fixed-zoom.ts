import type { WebContents } from 'electron';

const fixedZoomContents = new WeakSet<WebContents>();

/**
 * Keep a screen-anchored surface (dock, annotation overlay) at 100% zoom.
 * Chromium shares zoom per origin, so app zoom would otherwise resize it too.
 * Call before the first load: isolated mode persists across navigations.
 */
export function fixWebContentsZoom(contents: WebContents): void {
  contents.setZoomMode('isolated');
  contents.setZoomLevel(0);
  fixedZoomContents.add(contents);
}

export function hasFixedZoom(contents: WebContents): boolean {
  return fixedZoomContents.has(contents);
}
