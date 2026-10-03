/**
 * Backend stamping for BrowserWindows (main process).
 *
 * Every window is stamped with the backend id its renderer talks to
 * (multi-backend connect); per-window IPC routing and the per-backend HUD
 * registry read the stamp back. Kept in its own dependency-light module so
 * hud-window.ts / webview-security.ts can import it without dragging in
 * main/window.ts's full module graph. main/window.ts re-exports these
 * helpers, so either import path resolves to the same implementation.
 */

import { BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

type BackendBoundWindow = BrowserWindowType & { backendId?: string };

type StrictBinding = Readonly<{
  window: BrowserWindowType;
  stamp: object;
  backendId: string;
  frame: Electron.WebFrameMain;
}>;

const strictBindings = new WeakMap<Electron.WebContents, StrictBinding>();
const observedWindows = new WeakSet<BrowserWindowType>();
const retirementListeners = new WeakMap<Electron.WebContents, Set<() => void>>();

/** Observe replacement of the actual document binding, including equal-ID restamps. */
export function onStrictBackendBindingRetired(
  sender: Electron.WebContents,
  listener: () => void,
): () => void {
  let listeners = retirementListeners.get(sender);
  if (!listeners) {
    listeners = new Set();
    retirementListeners.set(sender, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function retireStrictBinding(sender: Electron.WebContents): void {
  if (!strictBindings.delete(sender)) return;
  for (const listener of [...(retirementListeners.get(sender) ?? [])]) {
    try {
      listener();
    } catch {
      /* All original consumers must be retired. */
    }
  }
}

function bindCurrentDocument(window: BrowserWindowType, backendId: string): void {
  const sender = window.webContents;
  if (window.isDestroyed() || sender.isDestroyed() || !sender.mainFrame) return;
  retireStrictBinding(sender);
  strictBindings.set(
    sender,
    Object.freeze({
      window,
      backendId,
      frame: sender.mainFrame,
      stamp: Object.freeze({}),
    }),
  );
}

/** Stamp a BrowserWindow with the backend used by its renderer. */
export function stampWindowWithBackend(
  window: BrowserWindowType,
  backendId: string = LOCAL_CONNECTION_ID,
): void {
  (window as BackendBoundWindow).backendId = backendId;
  const sender = window.webContents;
  if (!sender?.mainFrame) return;
  retireStrictBinding(sender);
  bindCurrentDocument(window, backendId);
  if (observedWindows.has(window)) return;
  observedWindows.add(window);
  // A navigation is unavailable until the new main document is ready. Neither
  // a frame object nor a backend ID is a non-reused document lifetime (A/B/A).
  sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) retireStrictBinding(sender);
  });
  sender.on('dom-ready', () => {
    if (window.webContents === sender) bindCurrentDocument(window, getBackendIdForWindow(window));
  });
  sender.on('render-process-gone', () => retireStrictBinding(sender));
  sender.once('destroyed', () => retireStrictBinding(sender));
  window.once('closed', () => retireStrictBinding(sender));
}

/** Explicit live document binding only. Never consult focused or local fallback routing. */
export function getStrictBackendBindingForWebContents(
  sender: Electron.WebContents,
): StrictBinding | null {
  const binding = strictBindings.get(sender);
  if (
    !binding ||
    sender.isDestroyed() ||
    binding.window.isDestroyed() ||
    binding.window.webContents !== sender ||
    sender.mainFrame !== binding.frame ||
    (binding.window as BackendBoundWindow).backendId !== binding.backendId ||
    BrowserWindow.fromWebContents(sender) !== binding.window
  ) {
    retireStrictBinding(sender);
    return null;
  }
  return binding;
}

/** Resolve a BrowserWindow's backend, defaulting legacy/unbound windows to local. */
export function getBackendIdForWindow(window: BrowserWindowType): string {
  return (window as BackendBoundWindow).backendId ?? LOCAL_CONNECTION_ID;
}

/** Resolve an IPC sender's backend, defaulting unbound windows to local. */
export function getBackendIdForWebContents(webContents: Electron.WebContents): string {
  const window = BrowserWindow.fromWebContents(webContents) as BackendBoundWindow | null;
  return window ? getBackendIdForWindow(window) : LOCAL_CONNECTION_ID;
}
