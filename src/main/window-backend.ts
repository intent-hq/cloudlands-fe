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

/**
 * A machine view: a second renderer hosted inside `window` (machine rail lab),
 * bound to its own backend. The window's own web contents keeps the window's
 * stamp; a view's binding is read from here first.
 */
type MachineViewBinding = Readonly<{ window: BrowserWindowType; backendId: string }>;

const strictBindings = new WeakMap<Electron.WebContents, StrictBinding>();
const machineViewBindings = new WeakMap<Electron.WebContents, MachineViewBinding>();
const machineViewsByWindow = new WeakMap<BrowserWindowType, Set<Electron.WebContents>>();
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

function bindCurrentDocument(
  window: BrowserWindowType,
  backendId: string,
  sender: Electron.WebContents = window.webContents,
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

/**
 * Bind a machine view's web contents to `backendId` for as long as it lives
 * inside `window`. Call before the view loads its first document.
 */
export function bindMachineViewToBackend(
  window: BrowserWindowType,
  sender: Electron.WebContents,
  backendId: string,
): void {
  machineViewBindings.set(sender, Object.freeze({ window, backendId }));
  let views = machineViewsByWindow.get(window);
  if (!views) {
    views = new Set();
    machineViewsByWindow.set(window, views);
  }
  views.add(sender);
  const release = (): void => {
    retireStrictBinding(sender);
    machineViewBindings.delete(sender);
    machineViewsByWindow.get(window)?.delete(sender);
  };
  sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) retireStrictBinding(sender);
  });
  sender.on('dom-ready', () => {
    if (machineViewBindings.get(sender)?.backendId === backendId) {
      bindCurrentDocument(window, backendId, sender);
    }
  });
  sender.on('render-process-gone', () => retireStrictBinding(sender));
  sender.once('destroyed', release);
  window.once('closed', release);
}

/**
 * Every live renderer hosted by `window`: its own web contents first, then its
 * machine views. Use it wherever a message must reach each renderer.
 */
export function getRendererWebContents(window: BrowserWindowType): Electron.WebContents[] {
  if (window.isDestroyed()) return [];
  const renderers = [window.webContents];
  for (const view of machineViewsByWindow.get(window) ?? []) {
    if (!view.isDestroyed()) renderers.push(view);
  }
  return renderers;
}

/** Whether `sender` is a machine view that main created inside `window`. */
export function isMachineViewOf(window: BrowserWindowType, sender: Electron.WebContents): boolean {
  return machineViewBindings.get(sender)?.window === window;
}

const shownMachineViews = new WeakMap<BrowserWindowType, Electron.WebContents>();

/** Record which machine view `window` shows; `null` when it shows its own renderer. */
export function setShownMachineView(
  window: BrowserWindowType,
  sender: Electron.WebContents | null,
): void {
  if (sender) shownMachineViews.set(window, sender);
  else shownMachineViews.delete(window);
}

/**
 * The renderer the user is looking at in `window`: the shown machine view, or
 * the window's own web contents. Menu commands and input gestures go here.
 */
export function getShownRendererWebContents(window: BrowserWindowType): Electron.WebContents {
  const shown = shownMachineViews.get(window);
  return shown && !shown.isDestroyed() && machineViewBindings.get(shown)?.window === window
    ? shown
    : window.webContents;
}

/**
 * Whether `sender` is the renderer `window` shows. Only that renderer speaks
 * for the window (current workspace, open tabs) to the main process.
 */
export function isShownRenderer(window: BrowserWindowType, sender: Electron.WebContents): boolean {
  const shown = shownMachineViews.get(window);
  const showsView =
    !!shown && !shown.isDestroyed() && machineViewBindings.get(shown)?.window === window;
  return machineViewBindings.has(sender) ? showsView && shown === sender : !showsView;
}

function getStrictMachineViewBinding(
  sender: Electron.WebContents,
  binding: StrictBinding,
): StrictBinding | null {
  const view = machineViewBindings.get(sender);
  if (
    !view ||
    sender.isDestroyed() ||
    binding.window.isDestroyed() ||
    view.window !== binding.window ||
    view.backendId !== binding.backendId ||
    sender.mainFrame !== binding.frame
  ) {
    retireStrictBinding(sender);
    return null;
  }
  return binding;
}

/** Explicit live document binding only. Never consult focused or local fallback routing. */
export function getStrictBackendBindingForWebContents(
  sender: Electron.WebContents,
): StrictBinding | null {
  const binding = strictBindings.get(sender);
  if (binding && machineViewBindings.has(sender)) {
    return getStrictMachineViewBinding(sender, binding);
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

/** Resolve an IPC sender's backend, defaulting unbound windows to local. */
export function getBackendIdForWebContents(webContents: Electron.WebContents): string {
  const view = machineViewBindings.get(webContents);
  if (view) return view.backendId;
  const window = BrowserWindow.fromWebContents(webContents) as BackendBoundWindow | null;
  return window ? getBackendIdForWindow(window) : LOCAL_CONNECTION_ID;
}
