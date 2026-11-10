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

import { BrowserWindow, webContents as webContentsModule } from 'electron';
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

/**
 * Renderer ids key per-renderer state (viewed workspace, open tabs, background
 * hosting). A normal window keeps its `BrowserWindow.id`; a Unified window machine
 * view gets the negative of its contents id, so the two never collide and three
 * views in one window do not overwrite each other.
 */
export function rendererIdForContents(contents: Electron.WebContents): number | null {
  if (contents.isDestroyed?.()) return null;
  if (viewBindings.has(contents)) return -contents.id;
  if (unifiedContents.has(contents)) return null;
  const window = BrowserWindow.fromWebContents(contents);
  return window && !window.isDestroyed() ? window.id : null;
}

function liveContents(window: BrowserWindowType): Electron.WebContents | null {
  const contents = window.webContents;
  return contents && !contents.isDestroyed?.() ? contents : null;
}

/** The live contents behind a renderer id (a window's own contents, or a bound view). */
export function contentsForRendererId(id: number): Electron.WebContents | null {
  if (id < 0) {
    const contents = webContentsModule?.fromId?.(-id);
    return contents && !contents.isDestroyed() && viewBindings.has(contents) ? contents : null;
  }
  const window = BrowserWindow.fromId(id);
  return window && !window.isDestroyed() ? liveContents(window) : null;
}

/** Whether a renderer id is live: a window still open, or a still-bound view. */
export function isRendererAlive(id: number): boolean {
  if (id < 0) return contentsForRendererId(id) !== null;
  const window = BrowserWindow.fromId(id);
  return !!window && !window.isDestroyed();
}

/** The window that shows a renderer (a view's host window). */
export function hostWindowForRendererId(id: number): BrowserWindowType | null {
  if (id < 0) {
    const contents = contentsForRendererId(id);
    const host = contents ? viewBindings.get(contents)?.host : undefined;
    return host && !host.isDestroyed() ? host : null;
  }
  const window = BrowserWindow.fromId(id);
  return window && !window.isDestroyed() ? window : null;
}

/** The backend a renderer talks to now, or null when it is gone. */
export function backendIdForRendererId(id: number): string | null {
  if (id < 0) {
    const contents = contentsForRendererId(id);
    return contents ? (viewBindings.get(contents)?.backendId ?? null) : null;
  }
  const window = BrowserWindow.fromId(id);
  return window && !window.isDestroyed() ? getBackendIdForWindow(window) : null;
}

const activeViews = new WeakMap<BrowserWindowType, Electron.WebContents>();

/** Record the machine view a Unified window currently shows (focus and menu routing). */
export function setActiveView(host: BrowserWindowType, contents: Electron.WebContents | null): void {
  if (contents) activeViews.set(host, contents);
  else activeViews.delete(host);
}

/**
 * The renderer that stands for `window` for focus-based routing: the window's own
 * renderer, or for the Unified window the machine view it shows.
 */
export function focusRendererIdForWindow(window: BrowserWindowType): number | null {
  if (window.isDestroyed()) return null;
  if (isUnifiedShellWindow(window)) {
    const active = activeViews.get(window);
    return active && viewBindings.has(active) ? rendererIdForContents(active) : null;
  }
  return window.id;
}

/** Whether a live Unified window machine view still holds `backendId`'s pooled client. */
export function hasLiveViewForBackend(backendId: string): boolean {
  return getBoundViews().some((contents) => {
    const binding = viewBindings.get(contents);
    return binding?.backendId === backendId && !binding.host.isDestroyed();
  });
}

/** A window's own contents plus any Unified window machine views it hosts. */
export function getContentsForWindow(window: BrowserWindowType): Electron.WebContents[] {
  if (window.isDestroyed()) return [];
  const own = liveContents(window);
  const contents = own ? [own] : [];
  for (const view of getBoundViews()) {
    if (viewBindings.get(view)?.host === window) contents.push(view);
  }
  return contents;
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
  id: number;
  window: BrowserWindowType;
  contents: Electron.WebContents;
  backendId: string;
}> {
  const targets: Array<{
    id: number;
    window: BrowserWindowType;
    contents: Electron.WebContents;
    backendId: string;
  }> = [];
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !liveContents(window)) continue;
    targets.push({
      id: window.id,
      window,
      contents: window.webContents,
      backendId: getBackendIdForWindow(window),
    });
  }
  for (const contents of getBoundViews()) {
    const binding = viewBindings.get(contents);
    if (binding && !binding.host.isDestroyed())
      targets.push({
        id: -contents.id,
        window: binding.host,
        contents,
        backendId: binding.backendId,
      });
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
