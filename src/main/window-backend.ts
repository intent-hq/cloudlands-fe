/**
 * Backend stamping for app renderers (main process).
 *
 * Every renderer page is stamped with the backend id it talks to
 * (multi-backend connect); per-sender IPC routing and the per-backend HUD
 * registry read the stamp back. A window's own page is stamped through
 * `stampWindowWithBackend`; a window can also host connection panels
 * (`WebContentsView` pages for other backends, see connection-panels.ts),
 * stamped through `stampPanelWithBackend`. Kept in its own dependency-light
 * module so hud-window.ts / webview-security.ts can import it without
 * dragging in main/window.ts's full module graph. main/window.ts re-exports
 * these helpers, so either import path resolves to the same implementation.
 */

import { BrowserWindow, webContents as allWebContents } from 'electron';
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
const observedContents = new WeakSet<Electron.WebContents>();
const retirementListeners = new WeakMap<Electron.WebContents, Set<() => void>>();
const contentsBackends = new WeakMap<Electron.WebContents, string>();
const panelHosts = new WeakMap<Electron.WebContents, BrowserWindowType>();
const windowPanels = new WeakMap<BrowserWindowType, Set<Electron.WebContents>>();
const activePanels = new WeakMap<BrowserWindowType, Electron.WebContents>();

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

function bindCurrentDocument(
  window: BrowserWindowType,
  sender: Electron.WebContents,
  backendId: string,
): void {
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

function stampContents(
  window: BrowserWindowType,
  sender: Electron.WebContents,
  backendId: string,
): void {
  contentsBackends.set(sender, backendId);
  if (!sender?.mainFrame) return;
  retireStrictBinding(sender);
  bindCurrentDocument(window, sender, backendId);
  if (observedContents.has(sender)) return;
  observedContents.add(sender);
  // A navigation is unavailable until the new main document is ready. Neither
  // a frame object nor a backend ID is a non-reused document lifetime (A/B/A).
  sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) retireStrictBinding(sender);
  });
  sender.on('dom-ready', () => {
    const host = getHostWindowForWebContents(sender);
    if (host) bindCurrentDocument(host, sender, getBackendIdForWebContents(sender));
  });
  sender.on('render-process-gone', () => retireStrictBinding(sender));
  sender.once('destroyed', () => retireStrictBinding(sender));
  window.once('closed', () => retireStrictBinding(sender));
}

/** Stamp a BrowserWindow (its own page) with the backend used by its renderer. */
export function stampWindowWithBackend(
  window: BrowserWindowType,
  backendId: string = LOCAL_CONNECTION_ID,
): void {
  (window as BackendBoundWindow).backendId = backendId;
  const sender = window.webContents;
  if (!sender) return;
  stampContents(window, sender, backendId);
}

/** Register a connection panel page hosted by `window` and stamp its backend. */
export function stampPanelWithBackend(
  window: BrowserWindowType,
  panel: Electron.WebContents,
  backendId: string,
): void {
  panelHosts.set(panel, window);
  let panels = windowPanels.get(window);
  if (!panels) {
    panels = new Set();
    windowPanels.set(window, panels);
  }
  panels.add(panel);
  panel.once('destroyed', () => {
    panels.delete(panel);
    if (activePanels.get(window) === panel) activePanels.delete(window);
  });
  stampContents(window, panel, backendId);
}

/** Record which page of `window` is visible; `null` means the window's own page. */
export function setActivePanel(
  window: BrowserWindowType,
  panel: Electron.WebContents | null,
): void {
  if (panel) activePanels.set(window, panel);
  else activePanels.delete(window);
}

/** The window hosting a renderer page: its owner window, or the panel's host. */
export function getHostWindowForWebContents(
  webContents: Electron.WebContents,
): BrowserWindowType | null {
  const host = panelHosts.get(webContents);
  if (host) return host.isDestroyed() ? null : host;
  return BrowserWindow.fromWebContents?.(webContents) ?? null;
}

function isGone(target: { isDestroyed?: () => boolean } | null | undefined): boolean {
  return !target || (typeof target.isDestroyed === 'function' && target.isDestroyed());
}

/** A renderer page by `webContents.id`, while it and its host window are alive. */
export function getRendererPage(pageId: number): Electron.WebContents | null {
  const contents = allWebContents?.fromId?.(pageId);
  if (!contents || isGone(contents)) return null;
  const host = getHostWindowForWebContents(contents);
  return host && !isGone(host) ? contents : null;
}

/** Whether `contents` is a registered connection panel page of a live window. */
export function isConnectionPanelContents(contents: Electron.WebContents): boolean {
  const host = panelHosts.get(contents);
  return !!host && !host.isDestroyed() && !contents.isDestroyed();
}

/** Live connection panel pages hosted by `window` (not its own page). */
function getPanelContents(window: BrowserWindowType): Electron.WebContents[] {
  return [...(windowPanels.get(window) ?? [])].filter((panel) => !isGone(panel));
}

/** Every renderer page of `window`: its own page plus its connection panels. */
export function getRendererContents(window: BrowserWindowType): Electron.WebContents[] {
  if (isGone(window)) return [];
  const own = window.webContents;
  return [...(isGone(own) ? [] : [own]), ...getPanelContents(window)];
}

/** The page of `window` (its own, or a connection panel) bound to `backendId`, if any. */
export function getPageForBackend(
  window: BrowserWindowType,
  backendId: string,
): Electron.WebContents | undefined {
  if (isGone(window)) return undefined;
  if (((window as BackendBoundWindow).backendId ?? LOCAL_CONNECTION_ID) === backendId) {
    return window.webContents;
  }
  return getPanelContents(window).find((panel) => contentsBackends.get(panel) === backendId);
}

/** The page the user sees in `window`. */
export function getActiveContents(window: BrowserWindowType): Electron.WebContents {
  const panel = activePanels.get(window);
  return panel && !isGone(panel) ? panel : window.webContents;
}

/** Every renderer page of every live window. */
export function getAllRendererContents(): Electron.WebContents[] {
  return (BrowserWindow.getAllWindows?.() ?? []).flatMap(getRendererContents);
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
    sender.mainFrame !== binding.frame ||
    contentsBackends.get(sender) !== binding.backendId ||
    getHostWindowForWebContents(sender) !== binding.window ||
    (!panelHosts.has(sender) && binding.window.webContents !== sender)
  ) {
    retireStrictBinding(sender);
    return null;
  }
  return binding;
}

/** Resolve the backend the user sees in a window, defaulting unbound windows to local. */
export function getBackendIdForWindow(window: BrowserWindowType): string {
  const panel = activePanels.get(window);
  if (panel && !panel.isDestroyed()) {
    const panelBackend = contentsBackends.get(panel);
    if (panelBackend) return panelBackend;
  }
  return (window as BackendBoundWindow).backendId ?? LOCAL_CONNECTION_ID;
}

/** Resolve an IPC sender's backend, defaulting unbound windows to local. */
export function getBackendIdForWebContents(webContents: Electron.WebContents): string {
  const stamped = contentsBackends.get(webContents);
  if (stamped) return stamped;
  const window = BrowserWindow.fromWebContents(webContents) as BackendBoundWindow | null;
  return window?.backendId ?? LOCAL_CONNECTION_ID;
}

type PanelSwitcher = (window: BrowserWindowType, backendId: string) => void;
let panelSwitcher: PanelSwitcher | null = null;

/** main/window.ts registers the connection-panel switch here. */
export function registerPanelSwitcher(switcher: PanelSwitcher | null): void {
  panelSwitcher = switcher;
}

/** Make `page` the page its window shows (no-op when it already is). */
export function showRendererPage(page: Electron.WebContents): BrowserWindowType | null {
  const host = getHostWindowForWebContents(page);
  if (!host || host.isDestroyed()) return null;
  if (getActiveContents(host) !== page) panelSwitcher?.(host, getBackendIdForWebContents(page));
  return host;
}
