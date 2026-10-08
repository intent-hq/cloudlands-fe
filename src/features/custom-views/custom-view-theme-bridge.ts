import {
  isCustomViewThemeReady,
  type CustomViewThemeSnapshot,
} from '$shared/custom-view-sdk/protocol.js';
import {
  CUSTOM_VIEW_THEME_TOKENS,
  type CustomViewTokenName,
} from '$shared/custom-view-sdk/tokens.js';
import { onReducedMotionChange, prefersReducedMotion } from '$lib/utils/reduced-motion';

function readTheme(documentRef: Document, windowRef: Window): CustomViewThemeSnapshot {
  const root = documentRef.documentElement;
  const computed = windowRef.getComputedStyle(root);
  const cssVariables: Partial<Record<CustomViewTokenName, string>> = {};
  for (const name of CUSTOM_VIEW_THEME_TOKENS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) cssVariables[name] = value;
  }
  return {
    version: 1,
    mode: root.classList.contains('dark') ? 'dark' : 'light',
    reducedMotion: prefersReducedMotion(documentRef),
    cssVariables,
  };
}

export function attachCustomViewThemeBridge(iframe: HTMLIFrameElement, url: string): () => void {
  const documentRef = iframe.ownerDocument;
  const windowRef = documentRef.defaultView;
  if (!windowRef) return () => {};
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return () => {};
  }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') return () => {};

  let disposed = false;
  let scheduled = false;
  let previous = '';
  const sendTheme = (force = false) => {
    if (disposed || !iframe.contentWindow) return;
    const theme = readTheme(documentRef, windowRef);
    const serialized = JSON.stringify(theme);
    if (!force && serialized === previous) return;
    previous = serialized;
    iframe.contentWindow.postMessage(
      { type: 'intent:theme:update', version: 1, theme },
      target.origin,
    );
  };
  const scheduleTheme = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    windowRef.queueMicrotask(() => {
      scheduled = false;
      sendTheme();
    });
  };
  const onReady = (event: MessageEvent) => {
    if (
      event.source !== iframe.contentWindow ||
      event.origin !== target.origin ||
      !isCustomViewThemeReady(event.data)
    )
      return;
    sendTheme(true);
  };
  const onLoad = () => {
    if (disposed) return;
    iframe.contentWindow?.postMessage({ type: 'intent:theme:init', version: 1 }, target.origin);
    sendTheme(true);
  };

  windowRef.addEventListener('message', onReady);
  windowRef.addEventListener('theme-changed', scheduleTheme);
  iframe.addEventListener('load', onLoad);
  const observer = new windowRef.MutationObserver(scheduleTheme);
  observer.observe(documentRef.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  const unsubscribeMotion = onReducedMotionChange(scheduleTheme, documentRef);
  if (!iframe.contentDocument) onLoad();

  return () => {
    disposed = true;
    observer.disconnect();
    unsubscribeMotion();
    windowRef.removeEventListener('message', onReady);
    windowRef.removeEventListener('theme-changed', scheduleTheme);
    iframe.removeEventListener('load', onLoad);
  };
}
