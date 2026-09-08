import type { BrowserElementRect } from '$store/renderer/slices/browser/browser-types';

export interface BrowserCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

export function toWebviewCaptureRect(
  rect: BrowserElementRect,
  webviewClientSize: Size,
  effectiveEmulatedSize: Size,
): BrowserCaptureRect {
  const scaleX =
    effectiveEmulatedSize.width > 0 ? webviewClientSize.width / effectiveEmulatedSize.width : 1;
  const scaleY =
    effectiveEmulatedSize.height > 0 ? webviewClientSize.height / effectiveEmulatedSize.height : 1;
  const x = Math.max(0, Math.floor(rect.x * scaleX));
  const y = Math.max(0, Math.floor(rect.y * scaleY));
  const right = Math.min(webviewClientSize.width, Math.ceil((rect.x + rect.width) * scaleX));
  const bottom = Math.min(webviewClientSize.height, Math.ceil((rect.y + rect.height) * scaleY));

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}
