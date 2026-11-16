/**
 * Machine rail — frames' machine views, main process.
 *
 * A frame (app window) holds one or more machines and shows one at a time;
 * with the rail lab off it holds one. Every machine, the local one included,
 * gets its own renderer: a WebContentsView filling the window, bound to that
 * machine's backend (see `bindMachineViewToBackend`) and created when the
 * frame opens on it or the machine is first selected. The window's own web
 * contents is the frame page, which only paints the backdrop under the views.
 * Selecting a machine only changes which view is visible, so each machine
 * keeps its tabs, drafts and scroll position. Removing a frame's last machine
 * closes the frame.
 *
 * Connections are pooled in backend.ipc.ts; this module asks for them through
 * {@link MachineRailDeps} so it never imports that module graph.
 */

import { app, ipcMain, WebContentsView } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { Logger } from '../shared/logger';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import {
  addRailMachine,
  MACHINE_RAIL_MAX_MACHINES,
  removeRailMachine,
  reorderRailMachines,
  type FrameMachineSession,
  type MachineRailBackdrop,
  type MachineRailState,
  type MachineRailToastEvent,
} from '../shared/types/machine-rail';
import {
  EmptySchema,
  MachineRailBackdropSchema,
  MachineRailForwardToastSchema,
  MachineRailHealthSchema,
  MachineRailMachineSchema,
  MachineRailReorderSchema,
  MachineRailSetEnabledSchema,
} from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getLocalPref, setLocalPref } from './local-prefs';
import {
  clearWindowRail,
  emptyFrameForClose,
  FRAME_LAYOUT_CHANGED_EVENT,
  isMachineRailEnabled,
  MACHINE_RAIL_SHOWN_CHANGED_EVENT,
  readWindowRail,
  setMachineRailEnabledFlag,
  setPendingSelection,
  setFrameMachineCommands,
  setFrameOpener,
  setMachineRailRendererStarter,
  setMachineRailShower,
  writeWindowRail,
  type ShownRailMachine,
} from './machine-rail-state';
import { getAppWindows } from './offscreen-window';
import { framesHolding, frameToShow, isMachineInUse, isMachineRendered } from './frames';
import { attachRendererHangMonitor } from './renderer-hang-monitor';
import { decorateWindowTitle } from './utils/resolve-app-title';
import { queueDeepLinkForRenderer } from '../features/deeplink/main/pending-deep-links';
import { FRAME_ROUTE } from '../shared/frame-route';
import {
  buildLoadUrl,
  buildRendererWebPreferences,
  forwardRendererConsoleToMainLog,
} from './window';
import {
  bindMachineViewToBackend,
  getBackendIdForWebContents,
  getRendererWebContents,
  getWindowForWebContents,
  getShownRendererWebContents,
  isFrameWindow,
  isMachineViewOf,
  isShownRenderer,
  setShownMachineView,
} from './window-backend';

const logger = new Logger('MachineRail');
const MACHINE_RAIL = IPC_CHANNELS.MACHINE_RAIL;
const ENABLED_PREF = 'machineRailEnabled';

export interface MachineRailDeps {
  /** Ids of the machines a window may show: saved machines (no nodes) and guest hosts. */
  listMachineIds(): Promise<string[]>;
  /** Connect (or reuse) the pooled client of a saved machine. */
  connect(id: string): Promise<unknown>;
  /** Whether the machine's pooled client is connected right now. */
  isConnected(id: string): boolean;
  /** Call `listener` each time a machine's pooled client connects; returns a disposer. */
  onConnected(listener: (id: string) => void): () => void;
  /** Dial the machine now; `true` once connected, `false` once that attempt fails. */
  retry(id: string): Promise<boolean>;
  /** Drop the pooled client of a machine no window or rail uses any more. */
  disconnect(id: string): void;
}

let deps: MachineRailDeps | null = null;
/** Machines whose daemon a renderer reported degraded. */
const degradedMachines = new Set<string>();
const viewsByWindow = new WeakMap<BrowserWindowType, Map<string, WebContentsView>>();
const observedWindows = new WeakSet<BrowserWindowType>();

function viewsOf(window: BrowserWindowType): Map<string, WebContentsView> {
  let views = viewsByWindow.get(window);
  if (!views) {
    views = new Map();
    viewsByWindow.set(window, views);
  }
  return views;
}

/**
 * A window's switch in progress: the machine on screen (it trails the
 * selection until the selected renderer has painted) and a machine the user
 * asked for whose renderer is still starting.
 */
interface Transition {
  shownId: string;
  pendingId: string;
  revealTimer?: NodeJS.Timeout;
  pendingTimer?: NodeJS.Timeout;
}

const transitions = new WeakMap<BrowserWindowType, Transition>();
/** Machine views whose renderer has finished starting up. */
const readyViews = new WeakSet<Electron.WebContents>();
/** Callers waiting for a renderer to report ready. */
const readyWaiters = new WeakMap<Electron.WebContents, Array<() => void>>();
/** When each machine view started loading. */
const viewStartedAt = new WeakMap<Electron.WebContents, number>();

function transitionOf(window: BrowserWindowType): Transition {
  let transition = transitions.get(window);
  if (!transition) {
    transition = { shownId: readWindowRail(window).selectedId, pendingId: '' };
    transitions.set(window, transition);
  }
  return transition;
}

function clearTransition(window: BrowserWindowType): void {
  const transition = transitions.get(window);
  if (!transition) return;
  clearTimeout(transition.revealTimer);
  clearTimeout(transition.pendingTimer);
  transitions.delete(window);
  setPendingSelection(window, '');
}

function stateOf(window: BrowserWindowType): MachineRailState {
  const rail = readWindowRail(window);
  const transition = transitions.get(window);
  const listed = (id: string | undefined): id is string => !!id && rail.machineIds.includes(id);
  return {
    enabled: isMachineRailEnabled(),
    machineIds: [...rail.machineIds],
    selectedId: rail.selectedId,
    shownId: listed(transition?.shownId) ? transition.shownId : rail.selectedId,
    pendingId: listed(transition?.pendingId) ? transition.pendingId : '',
    degradedIds: rail.machineIds.filter((id) => degradedMachines.has(id)),
  };
}

function broadcastState(window: BrowserWindowType): void {
  const state = stateOf(window);
  app.emit(FRAME_LAYOUT_CHANGED_EVENT, window);
  for (const renderer of getRendererWebContents(window)) {
    try {
      renderer.send(MACHINE_RAIL.CHANGED, state);
    } catch (error) {
      logger.warn('Failed to send machine rail state', {
        windowId: window.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** The backdrop each machine view last reported for its machine. */
const backdrops = new WeakMap<Electron.WebContents, MachineRailBackdrop>();

/** What the frame page paints: the shown machine's backdrop while the rail is on. */
function frameBackdrop(window: BrowserWindowType): MachineRailBackdrop | null {
  if (!isMachineRailEnabled() || window.isDestroyed()) return null;
  const shown = getShownRendererWebContents(window);
  return shown === window.webContents ? null : (backdrops.get(shown) ?? null);
}

function pushBackdrop(window: BrowserWindowType): void {
  if (window.isDestroyed() || !isFrameWindow(window) || window.webContents.isDestroyed()) return;
  window.webContents.send(MACHINE_RAIL.BACKDROP_CHANGED, frameBackdrop(window));
}

/**
 * Load the frame page under `window`'s views once it has something to paint:
 * only while the rail lab is on (with it off every machine paints its own
 * shell), and only after the shown machine's view has loaded, so the two
 * renderers do not boot at the same time.
 */
function ensureFramePage(window: BrowserWindowType): void {
  if (!isMachineRailEnabled() || window.isDestroyed() || !isFrameWindow(window)) return;
  const page = window.webContents;
  if (page.isDestroyed() || page.getURL() !== '' || framePageRequested.has(window)) return;
  framePageRequested.add(window);
  const load = (): void => {
    if (window.isDestroyed() || page.isDestroyed()) return;
    page
      .loadURL(buildLoadUrl(FRAME_ROUTE))
      .catch((error: unknown) => logger.error('Failed to load the frame page', error as Error));
  };
  const shown = getShownRendererWebContents(window);
  if (shown === page || shown.isDestroyed() || !shown.isLoading()) load();
  else shown.once('did-finish-load', load);
}

const framePageRequested = new WeakSet<BrowserWindowType>();

function layoutViews(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  for (const view of viewsOf(window).values()) view.setBounds({ x: 0, y: 0, width, height });
}

function releaseMachine(id: string): void {
  if (id === LOCAL_CONNECTION_ID || isMachineInUse(id)) return;
  try {
    deps?.disconnect(id);
  } catch (error) {
    logger.warn('Failed to disconnect a machine no window uses', {
      backendId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function destroyView(window: BrowserWindowType, id: string): void {
  const views = viewsOf(window);
  const view = views.get(id);
  if (!view) return;
  views.delete(id);
  try {
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
  } catch {
    /* The window is already tearing its views down. */
  }
  settleReadyWaiters(view.webContents);
  // A view's web contents outlives its window unless it is closed here.
  if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  forgetHealthWithoutRenderer(id);
}

/** Broadcast to every frame that holds `id`. */
function broadcastToRailsOf(id: string): void {
  for (const window of framesHolding(id)) broadcastState(window);
}

/** Health is reported by a machine's renderers: with none left, its report is stale. */
function forgetHealthWithoutRenderer(id: string): void {
  if (!degradedMachines.has(id) || isMachineRendered(id)) return;
  degradedMachines.delete(id);
  broadcastToRailsOf(id);
}

function observeWindow(window: BrowserWindowType): void {
  if (observedWindows.has(window)) return;
  observedWindows.add(window);
  const relayout = (): void => layoutViews(window);
  window.on('resize', relayout);
  window.on('enter-full-screen', relayout);
  window.on('leave-full-screen', relayout);
  // A window that becomes active again focuses its frame page; hand keyboard
  // focus to the machine on screen, so its shortcuts work without a click.
  // Skip a view that already has it: refocusing re-activates the window on
  // Linux/X11, and two frames then trade focus without end.
  window.on('focus', () => {
    const shown = getShownRendererWebContents(window);
    if (shown !== window.webContents && !shown.isDestroyed() && !shown.isFocused()) {
      shown.focus();
    }
  });
  // The machines go with the frame; a machine no other window uses is released.
  window.once('closed', () => {
    // A frame emptied by removing its last machine still has that view.
    const held = new Set([...readWindowRail(window).machineIds, ...viewsOf(window).keys()]);
    clearTransition(window);
    for (const id of [...viewsOf(window).keys()]) destroyView(window, id);
    clearWindowRail(window);
    restoredRoutes.delete(window);
    for (const id of held) releaseMachine(id);
  });
}

function ensureView(window: BrowserWindowType, id: string): WebContentsView {
  const views = viewsOf(window);
  const existing = views.get(id);
  if (existing && !existing.webContents.isDestroyed()) return existing;
  observeWindow(window);
  const view = new WebContentsView({ webPreferences: buildRendererWebPreferences() });
  bindMachineViewToBackend(window, view.webContents, id);
  // The frame page paints the shell background and accent tint under every
  // view, so the tint can cross-fade between machines.
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  forwardRendererConsoleToMainLog(window, view.webContents);
  attachRendererHangMonitor(window, {}, view.webContents);
  const layoutChanged = (): void => {
    app.emit(FRAME_LAYOUT_CHANGED_EVENT, window);
  };
  view.webContents.on('did-navigate', layoutChanged);
  view.webContents.on('did-navigate-in-page', layoutChanged);
  // The window is titled after the machine it shows.
  view.webContents.on('page-title-updated', (_event, title) => {
    if (!window.isDestroyed() && getShownRendererWebContents(window) === view.webContents) {
      window.setTitle(decorateWindowTitle(title));
    }
  });
  views.set(id, view);
  viewStartedAt.set(view.webContents, Date.now());
  window.contentView.addChildView(view);
  layoutViews(window);
  view.webContents
    .loadURL(buildLoadUrl(takeRestoredRoute(window, id)))
    .catch((error: unknown) => logger.error('Failed to load a machine view', error as Error));
  return view;
}

/** Pages a restored window's machines showed, used once by each machine's first view. */
const restoredRoutes = new WeakMap<BrowserWindowType, Map<string, string>>();

function takeRestoredRoute(window: BrowserWindowType, id: string): string | undefined {
  const routes = restoredRoutes.get(window);
  const route = routes?.get(id);
  routes?.delete(id);
  return route;
}

/** Longest the previous machine stays up waiting for the selected renderer to paint. */
const REVEAL_TIMEOUT_MS = 250;
/** Longest a machine's startup keeps its rail item spinning before it is shown anyway. */
const READY_TIMEOUT_MS = 20_000;

/** The selected renderer is on screen: take the others away. */
function finishReveal(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const transition = transitionOf(window);
  clearTimeout(transition.revealTimer);
  transition.revealTimer = undefined;
  const { selectedId } = readWindowRail(window);
  for (const [id, view] of viewsOf(window)) view.setVisible(id === selectedId);
  if (transition.shownId === selectedId) return;
  transition.shownId = selectedId;
  broadcastState(window);
}

/** The selected renderer reports that it has painted. */
function completeReveal(window: BrowserWindowType, sender: Electron.WebContents): void {
  const transition = transitions.get(window);
  if (!transition?.revealTimer || getShownRendererWebContents(window) !== sender) return;
  finishReveal(window);
}

/**
 * Put the selected machine's renderer on top. The one on screen stays up
 * under it until the selected renderer has painted, so a switch never shows
 * an empty window. The frame page is always at the bottom.
 */
function applySelection(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const { selectedId } = readWindowRail(window);
  if (!selectedId) return;
  const transition = transitionOf(window);
  const selected = ensureView(window, selectedId);
  setShownMachineView(window, selected.webContents);
  app.emit(MACHINE_RAIL_SHOWN_CHANGED_EVENT, window);
  pushBackdrop(window);
  selected.setVisible(true);
  // Adding a child view again moves it to the top.
  window.contentView.addChildView(selected);
  const title = selected.webContents.getTitle();
  if (title && !selected.webContents.isLoading()) window.setTitle(decorateWindowTitle(title));
  clearTimeout(transition.revealTimer);
  transition.revealTimer = undefined;
  if (transition.shownId === selectedId) finishReveal(window);
  else transition.revealTimer = setTimeout(() => finishReveal(window), REVEAL_TIMEOUT_MS);
  if (window.isFocused() && !selected.webContents.isDestroyed()) selected.webContents.focus();
}

function clearPending(window: BrowserWindowType): void {
  const transition = transitionOf(window);
  clearTimeout(transition.pendingTimer);
  transition.pendingTimer = undefined;
  transition.pendingId = '';
  setPendingSelection(window, '');
}

/** Show `id` in place of the machine on screen, ready or not. */
function showMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  clearPending(window);
  writeWindowRail(window, { machineIds: rail.machineIds, selectedId: id });
  applySelection(window);
  broadcastState(window);
  return stateOf(window);
}

/**
 * Wait for `id` to finish starting while the machine on screen stays; its rail
 * item spins meanwhile. A machine that never reports ready is shown anyway.
 */
function awaitMachine(window: BrowserWindowType, id: string): void {
  clearPending(window);
  const transition = transitionOf(window);
  transition.pendingId = id;
  setPendingSelection(window, id);
  transition.pendingTimer = setTimeout(() => {
    if (window.isDestroyed() || transitions.get(window)?.pendingId !== id) return;
    if (readWindowRail(window).machineIds.includes(id)) showMachine(window, id);
  }, READY_TIMEOUT_MS);
}

function isMachineReady(window: BrowserWindowType, id: string): boolean {
  const view = viewsOf(window).get(id);
  return !!view && !view.webContents.isDestroyed() && readyViews.has(view.webContents);
}

/** A machine's renderer finished starting: show it if the user is waiting for it. */
function markReady(window: BrowserWindowType, sender: Electron.WebContents): void {
  const entry = [...viewsOf(window)].find(([, view]) => view.webContents === sender);
  if (!entry) return;
  readyViews.add(sender);
  settleReadyWaiters(sender);
  if (isMachineRailEnabled() && transitions.get(window)?.pendingId === entry[0]) {
    showMachine(window, entry[0]);
  }
}

function settleReadyWaiters(contents: Electron.WebContents): void {
  for (const resolve of readyWaiters.get(contents) ?? []) resolve();
  readyWaiters.delete(contents);
}

/** Settles once `contents` reports ready or is dropped, or after the longest a start may take. */
function whenReady(contents: Electron.WebContents): Promise<void> {
  if (contents.isDestroyed() || readyViews.has(contents)) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const waiters = readyWaiters.get(contents);
      const index = waiters?.indexOf(settle) ?? -1;
      if (index >= 0) waiters?.splice(index, 1);
      resolve();
    }, READY_TIMEOUT_MS);
    readyWaiters.set(contents, [...(readyWaiters.get(contents) ?? []), settle]);
  });
}

/**
 * Start `id`'s renderer, hidden, in a frame that holds it (the focused, else most recently focused
 * one first) unless one runs already, then wait until it is ready or
 * `deadline` passes. A renderer still not ready after its startup budget is
 * not waited for again. Settles with whether a rail lists the machine.
 */
async function startRendererFor(id: string, deadline: number): Promise<boolean> {
  const rails = framesHolding(id);
  if (rails.length === 0) return false;
  const running = rails
    .map((window) => viewsOf(window).get(id))
    .find((view) => view && !view.webContents.isDestroyed());
  const host = frameToShow(id) ?? rails[0];
  const contents = (running ?? ensureView(host, id)).webContents;
  const started = viewStartedAt.get(contents) ?? 0;
  if (readyViews.has(contents) || Date.now() - started >= READY_TIMEOUT_MS) return true;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    whenReady(contents),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    }),
  ]).finally(() => clearTimeout(timer));
  return true;
}

/** Pick `id` in a frame that holds it (the focused one, else the most recently focused). */
function showRailMachineFor(id: string): ShownRailMachine | null {
  const window = frameToShow(id);
  return window ? selectMachineInFrame(window, id) : null;
}

/**
 * Show `id` in `window` as a rail click would, starting its renderer when it
 * has not started yet. Returns that renderer and when it is ready for
 * messages; null when `window` does not hold the machine.
 */
export function selectMachineInFrame(
  window: BrowserWindowType,
  id: string,
): ShownRailMachine | null {
  if (window.isDestroyed()) return null;
  if (!readWindowRail(window).machineIds.includes(id)) return null;
  selectMachine(window, id);
  const contents = ensureView(window, id).webContents;
  return { window, contents, ready: whenReady(contents).then(() => readyViews.has(contents)) };
}

/** Longest the background start waits for a machine that is still connecting. */
const PRELOAD_CONNECT_WAIT_MS = 60_000;

/** Background starts waiting for one of their machines to connect. */
const connectionWaits = new Set<{ ids: string[]; finish: (id: string | null) => void }>();
let connectedFeed: (() => void) | null = null;

/** Settles with the first of `ids` to connect, or `null` once the wait runs out. */
function nextConnection(ids: string[]): Promise<string | null> {
  if (!deps) return Promise.resolve(null);
  connectedFeed ??= deps.onConnected((id) => {
    for (const wait of [...connectionWaits]) if (wait.ids.includes(id)) wait.finish(id);
  });
  return new Promise((resolve) => {
    const wait = {
      ids,
      finish: (id: string | null) => {
        clearTimeout(timer);
        connectionWaits.delete(wait);
        resolve(id);
      },
    };
    const timer = setTimeout(() => wait.finish(null), PRELOAD_CONNECT_WAIT_MS);
    connectionWaits.add(wait);
  });
}

/**
 * Start each machine's renderer in the background, hidden and one at a time,
 * as it connects, so picking it later shows it at once. One that is still
 * offline once the wait runs out starts when picked, as before.
 */
async function preloadMachines(window: BrowserWindowType, ids: string[]): Promise<void> {
  const remaining = new Set(ids);
  while (remaining.size > 0) {
    if (window.isDestroyed() || !isMachineRailEnabled()) return;
    const inRail = readWindowRail(window).machineIds;
    for (const id of remaining) if (!inRail.includes(id)) remaining.delete(id);
    const next = [...remaining].find((id) => deps?.isConnected(id) ?? false);
    if (next === undefined) {
      if (remaining.size === 0 || (await nextConnection([...remaining])) === null) return;
      continue;
    }
    remaining.delete(next);
    await whenReady(ensureView(window, next).webContents);
  }
}

/** A started machine that is offline: try it once more, then show it either way. */
async function retryThenShow(window: BrowserWindowType, id: string): Promise<void> {
  try {
    await deps?.retry(id);
  } catch (error) {
    logger.warn('Machine in the rail could not be retried', {
      backendId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (window.isDestroyed() || transitions.get(window)?.pendingId !== id) return;
  if (readWindowRail(window).machineIds.includes(id)) showMachine(window, id);
}

/**
 * Show `id` at once when it is started and connected. Otherwise the machine
 * on screen stays while `id` starts, or (started but offline) dials once
 * more; then `id` shows, connected or with its usual cannot-connect dialog.
 */
function selectMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  if (!rail.machineIds.includes(id)) throw new Error('Machine is not in this window');
  const started = isMachineReady(window, id);
  if (rail.selectedId === id || (started && (deps?.isConnected(id) ?? true))) {
    return showMachine(window, id);
  }
  if (!started) ensureView(window, id);
  if (transitionOf(window).pendingId !== id) {
    awaitMachine(window, id);
    if (started) void retryThenShow(window, id);
  }
  broadcastState(window);
  return stateOf(window);
}

async function connectQuietly(id: string): Promise<void> {
  try {
    await deps?.connect(id);
  } catch (error) {
    // The machine stays in the rail, greyed out; its own view owns recovery.
    logger.warn('Machine in the rail could not connect', {
      backendId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

class MachineRailFullError extends Error {
  constructor() {
    super('This window has no room for another machine');
    this.name = 'MachineRailFullError';
  }
}

async function addMachine(
  window: BrowserWindowType,
  id: string,
  mayOpen: () => boolean = () => true,
): Promise<MachineRailState> {
  if (!deps || !(await deps.listMachineIds()).includes(id)) throw new Error('Unknown machine');
  if (!mayOpen() || window.isDestroyed()) throw new Error('Invitation is no longer current');
  const rail = readWindowRail(window);
  const machineIds = addRailMachine(rail.machineIds, id);
  if (!machineIds.includes(id)) throw new MachineRailFullError();
  observeWindow(window);
  writeWindowRail(window, { machineIds, selectedId: rail.selectedId });
  awaitMachine(window, id);
  broadcastState(window);
  await connectQuietly(id);
  if (window.isDestroyed()) throw new Error('Window closed');
  // The user may have picked another machine (or removed this one) meanwhile.
  if (!mayOpen()) {
    if (transitions.get(window)?.pendingId === id) clearPending(window);
    return stateOf(window);
  }
  if (transitions.get(window)?.pendingId !== id) return stateOf(window);
  return selectMachine(window, id);
}

/** Open a joined host in the original window only when its machine rail is enabled. */
export async function openInvitedMachineInWindow(
  window: BrowserWindowType,
  id: string,
  workspaceId?: string,
  mayOpen: () => boolean = () => true,
): Promise<boolean> {
  if (!isMachineRailEnabled() || window.isDestroyed() || !mayOpen()) return false;
  // A frame that holds the machine already (this one first) shows it there.
  const holder = frameToShow(id, window);
  if (holder) {
    const shown = selectMachineInFrame(holder, id);
    if (!shown) return false;
    showOpenedMachine(holder, shown.contents, workspaceId);
    return true;
  }
  // A machine that cannot be in a rail (this app's own daemon, a node) keeps its own window.
  if (!deps || !(await deps.listMachineIds()).includes(id)) return false;
  const canContinue = () => isMachineRailEnabled() && !window.isDestroyed() && mayOpen();
  try {
    await addMachine(window, id, canContinue);
  } catch (error) {
    // A full rail, or a window closed meanwhile, leaves the caller to open the backend window.
    if (error instanceof MachineRailFullError || window.isDestroyed()) return false;
    throw error;
  }
  // The rail was turned off or the window closed meanwhile: the machine still needs a window.
  if (!isMachineRailEnabled() || window.isDestroyed()) return false;
  if (!mayOpen()) return true;
  showOpenedMachine(window, ensureView(window, id).webContents, workspaceId);
  return true;
}

/** Queue `workspaceId` (if any) for the opened machine's view and bring its frame to the front. */
function showOpenedMachine(
  window: BrowserWindowType,
  contents: Electron.WebContents,
  workspaceId: string | undefined,
): void {
  if (workspaceId)
    queueDeepLinkForRenderer(contents, { type: 'open', params: { id: workspaceId } });
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Remove `id` from `window`; removing its last machine closes the frame. */
function removeMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  if (!rail.machineIds.includes(id)) return stateOf(window);
  const next = removeRailMachine(rail, id);
  if (transitionOf(window).pendingId === id) clearPending(window);
  if (next.machineIds.length === 0) {
    const state = stateOf(window);
    // Empty the frame first: the close listener saves the layout, and the
    // removed machine must not come back on the next launch.
    clearTransition(window);
    emptyFrameForClose(window);
    window.close();
    return { ...state, machineIds: [], selectedId: '', shownId: '', pendingId: '' };
  }
  writeWindowRail(window, next);
  applySelection(window);
  destroyView(window, id);
  restoredRoutes.get(window)?.delete(id);
  broadcastState(window);
  releaseMachine(id);
  return stateOf(window);
}

function reorderMachines(window: BrowserWindowType, order: string[]): MachineRailState {
  const rail = readWindowRail(window);
  const machineIds = reorderRailMachines(rail.machineIds, order);
  writeWindowRail(window, { machineIds, selectedId: rail.selectedId });
  broadcastState(window);
  return stateOf(window);
}

/** A forgotten machine leaves every frame; a frame left with no machine closes. */
export function removeMachineFromAllRails(id: string): void {
  for (const window of framesHolding(id)) removeMachine(window, id);
}

/**
 * Open `machines` in `window`, a new frame: the shown machine's view starts at
 * once on its saved page; the others connect now and start in the background
 * once it is ready, as each one connects. With the rail lab off the frame
 * keeps only the machine it shows. Returns the shown machine's renderer.
 */
function openFrame(
  window: BrowserWindowType,
  machines: FrameMachineSession[],
  selectedId: string,
): Electron.WebContents | null {
  if (window.isDestroyed()) return null;
  const ids: string[] = [];
  const routes = new Map<string, string>();
  for (const machine of machines) {
    if (ids.includes(machine.id)) continue;
    if (ids.length >= MACHINE_RAIL_MAX_MACHINES) break;
    ids.push(machine.id);
    if (machine.route?.startsWith('/')) routes.set(machine.id, machine.route);
  }
  if (ids.length === 0) return null;
  const selected = ids.includes(selectedId) ? selectedId : ids[0];
  const machineIds = isMachineRailEnabled() ? ids : [selected];
  observeWindow(window);
  clearTransition(window);
  restoredRoutes.set(window, routes);
  writeWindowRail(window, { machineIds, selectedId: selected });
  applySelection(window);
  broadcastState(window);
  ensureFramePage(window);
  const others = machineIds.filter((id) => id !== selected);
  if (others.length > 0) {
    void startOthers(window, selected, others).catch((error: unknown) =>
      logger.warn("Failed to start a frame's other machines", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return viewsOf(window).get(selected)?.webContents ?? null;
}

/** Connect a new frame's other machines, then preload them once the shown one is ready. */
async function startOthers(
  window: BrowserWindowType,
  selected: string,
  others: string[],
): Promise<void> {
  for (const id of others) void connectQuietly(id);
  const shown = viewsOf(window).get(selected);
  if (shown) await whenReady(shown.webContents);
  await preloadMachines(window, others);
}

/** The rail lab was turned off: a frame keeps only the machine it shows. */
function resetWindow(window: BrowserWindowType): void {
  const rail = readWindowRail(window);
  if (rail.machineIds.length === 0) return;
  const keep = rail.machineIds.includes(rail.selectedId) ? rail.selectedId : rail.machineIds[0];
  clearTransition(window);
  writeWindowRail(window, { machineIds: [keep], selectedId: keep });
  applySelection(window);
  for (const id of [...viewsOf(window).keys()]) if (id !== keep) destroyView(window, id);
  for (const id of rail.machineIds) if (id !== keep) releaseMachine(id);
}

async function setEnabled(next: boolean): Promise<void> {
  if (next === isMachineRailEnabled()) return;
  await setLocalPref(ENABLED_PREF, next);
  setMachineRailEnabledFlag(next);
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    if (!next) resetWindow(window);
    else ensureFramePage(window);
    broadcastState(window);
    pushBackdrop(window);
  }
}

/** Reads the persisted Labs setting once at startup; a failed read keeps it off. */
export async function loadMachineRailEnabled(): Promise<void> {
  try {
    setMachineRailEnabledFlag((await getLocalPref(ENABLED_PREF)) === true);
  } catch {
    setMachineRailEnabledFlag(false);
  }
}

function windowOf(sender: Electron.WebContents): BrowserWindowType {
  const window = getWindowForWebContents(sender);
  if (!window || window.isDestroyed()) throw new Error('No window for this request');
  return window;
}

/**
 * The frame whose machine view sent a request. Requests that change a frame's
 * rail, or report a view's progress, must come from one of its machine views:
 * not the frame page (which only reads the backdrop) or any other renderer.
 */
function viewWindowOf(sender: Electron.WebContents): BrowserWindowType {
  const window = windowOf(sender);
  if (!isFrameWindow(window) || !isMachineViewOf(window, sender)) {
    throw new Error('Only a machine view may send this request');
  }
  return window;
}

function assertEnabled(): void {
  if (!isMachineRailEnabled()) throw new Error('The machine rail is turned off');
}

export function registerMachineRailHandlers(railDeps: MachineRailDeps): void {
  connectedFeed?.();
  connectedFeed = null;
  for (const wait of [...connectionWaits]) wait.finish(null);
  deps = railDeps;
  setMachineRailRendererStarter(startRendererFor);
  setMachineRailShower(showRailMachineFor);
  setFrameOpener(openFrame);
  setFrameMachineCommands({
    select: selectMachineInFrame,
    add: (window, id) => openInvitedMachineInWindow(window, id),
  });
  ipcMain.handle(
    MACHINE_RAIL.GET_STATE,
    createValidatedHandler(
      EmptySchema,
      async (event) => stateOf(windowOf(event.sender)),
      MACHINE_RAIL.GET_STATE,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.SELECT,
    createValidatedHandler(
      MachineRailMachineSchema,
      async (event, { id }) => {
        assertEnabled();
        return selectMachine(viewWindowOf(event.sender), id);
      },
      MACHINE_RAIL.SELECT,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.ADD,
    createValidatedHandler(
      MachineRailMachineSchema,
      async (event, { id }) => {
        assertEnabled();
        return addMachine(viewWindowOf(event.sender), id);
      },
      MACHINE_RAIL.ADD,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.REMOVE,
    createValidatedHandler(
      MachineRailMachineSchema,
      async (event, { id }) => {
        assertEnabled();
        return removeMachine(viewWindowOf(event.sender), id);
      },
      MACHINE_RAIL.REMOVE,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.REORDER,
    createValidatedHandler(
      MachineRailReorderSchema,
      async (event, { machineIds }) => {
        assertEnabled();
        return reorderMachines(viewWindowOf(event.sender), machineIds);
      },
      MACHINE_RAIL.REORDER,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.SHOWN,
    createValidatedHandler(
      EmptySchema,
      async (event) => {
        completeReveal(viewWindowOf(event.sender), event.sender);
        return { ok: true };
      },
      MACHINE_RAIL.SHOWN,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.HEALTH,
    createValidatedHandler(
      MachineRailHealthSchema,
      async (event, { degraded }) => {
        const id = getBackendIdForWebContents(event.sender);
        if (degradedMachines.has(id) === degraded) return { ok: true };
        if (degraded) degradedMachines.add(id);
        else degradedMachines.delete(id);
        if (isMachineRailEnabled()) broadcastToRailsOf(id);
        return { ok: true };
      },
      MACHINE_RAIL.HEALTH,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.READY,
    createValidatedHandler(
      EmptySchema,
      async (event) => {
        markReady(viewWindowOf(event.sender), event.sender);
        return { ok: true };
      },
      MACHINE_RAIL.READY,
    ),
  );
  // A toast from a machine that is not shown appears in the one that is.
  ipcMain.handle(
    MACHINE_RAIL.FORWARD_TOAST,
    createValidatedHandler(
      MachineRailForwardToastSchema,
      async (event, { kind, message }) => {
        const window = windowOf(event.sender);
        if (!isMachineRailEnabled() || isShownRenderer(window, event.sender)) {
          return { forwarded: false };
        }
        const toast: MachineRailToastEvent = {
          kind,
          message,
          machineId: getBackendIdForWebContents(event.sender),
        };
        getShownRendererWebContents(window).send(MACHINE_RAIL.TOAST, toast);
        return { forwarded: true };
      },
      MACHINE_RAIL.FORWARD_TOAST,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.BACKDROP,
    createValidatedHandler(
      MachineRailBackdropSchema,
      async (event, backdrop) => {
        backdrops.set(event.sender, backdrop);
        const window = viewWindowOf(event.sender);
        if (isShownRenderer(window, event.sender)) pushBackdrop(window);
        return { ok: true };
      },
      MACHINE_RAIL.BACKDROP,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.GET_BACKDROP,
    createValidatedHandler(
      EmptySchema,
      async (event) => frameBackdrop(windowOf(event.sender)),
      MACHINE_RAIL.GET_BACKDROP,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.SET_ENABLED,
    createValidatedHandler(
      MachineRailSetEnabledSchema,
      async (event, { enabled }) => {
        await setEnabled(enabled);
        return stateOf(windowOf(event.sender));
      },
      MACHINE_RAIL.SET_ENABLED,
    ),
  );
}
