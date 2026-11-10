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

/**
 * Stamp of the Unified window itself. Its renderer (the shell) spans machines and
 * talks to none: no pooled client has this id, so a backend request from the shell
 * fails instead of defaulting to local. Only its per-machine views are bound.
 */
export const UNIFIED_SHELL_BACKEND_ID = '\u0000unified-shell';

type StrictBinding = Readonly<{
  window: BrowserWindowType;
  stamp: object;
  backendId: string;
  frame: Electron.WebFrameMain;
  /** Set for a Unified window machine view, whose contents are not `window.webContents`. */
  view?: true;
}>;

type ViewBinding = Readonly<{ host: BrowserWindowType; backendId: string }>;

const strictBindings = new WeakMap<Electron.WebContents, StrictBinding>();
const observedWindows = new WeakSet<BrowserWindowType>();
const viewBindings = new WeakMap<Electron.WebContents, ViewBinding>();
const boundViews = new Set<Electron.WebContents>();
const observedViews = new WeakSet<Electron.WebContents>();
/** Contents ever owned by the Unified window; they never fall back to local. */
const unifiedContents = new WeakSet<Electron.WebContents>();
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

function bindCurrentViewDocument(sender: Electron.WebContents): void {
  const binding = viewBindings.get(sender);
  if (!binding || binding.host.isDestroyed() || sender.isDestroyed() || !sender.mainFrame) return;
  retireStrictBinding(sender);
  strictBindings.set(
    sender,
    Object.freeze({
      window: binding.host,
      backendId: binding.backendId,
      frame: sender.mainFrame,
      stamp: Object.freeze({}),
      view: true as const,
    }),
  );
}

/**
 * Bind a Unified window machine view's contents to its own backend. The binding
 * belongs to the contents, never to the host window, so the view's IPC resolves
 * to its machine and not to the shell or local.
 */
export function bindViewToBackend(
  sender: Electron.WebContents,
  host: BrowserWindowType,
  backendId: string,
): void {
  unifiedContents.add(sender);
  viewBindings.set(sender, Object.freeze({ host, backendId }));
  boundViews.add(sender);
  bindCurrentViewDocument(sender);
  if (observedViews.has(sender)) return;
  observedViews.add(sender);
  sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) retireStrictBinding(sender);
  });
  sender.on('dom-ready', () => bindCurrentViewDocument(sender));
  sender.on('render-process-gone', () => retireStrictBinding(sender));
  sender.once('destroyed', () => unbindView(sender));
}

/** Drop a view's binding (view closed or destroyed); its IPC is refused afterwards. */
export function unbindView(sender: Electron.WebContents): void {
  viewBindings.delete(sender);
  boundViews.delete(sender);
  retireStrictBinding(sender);
}

/** The Unified window machine view binding of `sender`, if it is one. */
export function getViewBinding(sender: Electron.WebContents): ViewBinding | null {
  return viewBindings.get(sender) ?? null;
}

/** Live machine views, for pushes that must reach every renderer of a backend. */
export function getBoundViews(): Electron.WebContents[] {
  return [...boundViews].filter((contents) => !contents.isDestroyed());
}

/** Whether `window` is the Unified window (its own renderer is the shell). */
export function isUnifiedShellWindow(window: BrowserWindowType): boolean {
  return (window as BackendBoundWindow).backendId === UNIFIED_SHELL_BACKEND_ID;
}

/**
 * Every app renderer that can receive backend pushes: each window's own contents
 * plus every Unified window machine view, with the backend each one talks to.
 */
export function getRendererTargets(): Array<{
  contents: Electron.WebContents;
  backendId: string;
}> {
  const targets: Array<{ contents: Electron.WebContents; backendId: string }> = [];
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    targets.push({ contents: window.webContents, backendId: getBackendIdForWindow(window) });
  }
  for (const contents of getBoundViews()) {
    const binding = viewBindings.get(contents);
    if (binding && !binding.host.isDestroyed())
      targets.push({ contents, backendId: binding.backendId });
  }
  return targets;
}

/** Explicit live document binding only. Never consult focused or local fallback routing. */
export function getStrictBackendBindingForWebContents(
  sender: Electron.WebContents,
): StrictBinding | null {
  const binding = strictBindings.get(sender);
  if (binding?.view) {
    const view = viewBindings.get(sender);
    if (
      sender.isDestroyed() ||
      binding.window.isDestroyed() ||
      sender.mainFrame !== binding.frame ||
      !view ||
      view.host !== binding.window ||
      view.backendId !== binding.backendId
    ) {
      retireStrictBinding(sender);
      return null;
    }
    return binding;
  }
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

/**
 * Resolve an IPC sender's backend, defaulting unbound windows to local. A Unified
 * window machine view resolves to its own binding; the Unified shell resolves to
 * {@link UNIFIED_SHELL_BACKEND_ID}, which no client serves.
 */
export function getBackendIdForWebContents(webContents: Electron.WebContents): string {
  const view = viewBindings.get(webContents);
  if (view) return view.backendId;
  if (unifiedContents.has(webContents)) return UNIFIED_SHELL_BACKEND_ID;
  const window = BrowserWindow.fromWebContents(webContents) as BackendBoundWindow | null;
  return window ? getBackendIdForWindow(window) : LOCAL_CONNECTION_ID;
}
