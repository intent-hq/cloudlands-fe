/**
 * Machine rail (Labs) — main process.
 *
 * One window stays connected to several machines and shows one at a time. The
 * window's own renderer serves its home machine exactly as before. Every other
 * machine in the rail gets its own renderer: a WebContentsView inside the same
 * window, bound to that machine's backend (see `bindMachineViewToBackend`) and
 * created the first time the machine is selected. Selecting a machine only
 * changes which view is visible, so each machine keeps its tabs, drafts and
 * scroll position.
 *
 * Connections are pooled in backend.ipc.ts; this module asks for them through
 * {@link MachineRailDeps} so it never imports that module graph.
 */

import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { Logger } from '../shared/logger';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import {
  addRailMachine,
  normalizeRailSession,
  removeRailMachine,
  type MachineRailState,
  type MachineRailToastEvent,
} from '../shared/types/machine-rail';
import {
  EmptySchema,
  MachineRailForwardToastSchema,
  MachineRailHealthSchema,
  MachineRailMachineSchema,
  MachineRailSetEnabledSchema,
} from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getLocalPref, setLocalPref } from './local-prefs';
import {
  clearWindowRail,
  isMachineRailEnabled,
  MACHINE_RAIL_SHOWN_CHANGED_EVENT,
  readWindowRail,
  setMachineRailEnabledFlag,
  setPendingSelection,
  setMachineRailRestoreHandler,
  writeWindowRail,
} from './machine-rail-state';
import { getAppWindows } from './offscreen-window';
import {
  buildLoadUrl,
  buildRendererWebPreferences,
  forwardRendererConsoleToMainLog,
} from './window';
import {
  bindMachineViewToBackend,
  getBackendIdForWindow,
  getBackendIdForWebContents,
  getRendererWebContents,
  getShownRendererWebContents,
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
    homeId: rail.machineIds[0],
    machineIds: [...rail.machineIds],
    selectedId: rail.selectedId,
    shownId: listed(transition?.shownId) ? transition.shownId : rail.selectedId,
    pendingId: listed(transition?.pendingId) ? transition.pendingId : '',
    degradedIds: rail.machineIds.filter((id) => degradedMachines.has(id)),
  };
}

function broadcastState(window: BrowserWindowType): void {
  const state = stateOf(window);
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

function layoutViews(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  for (const view of viewsOf(window).values()) view.setBounds({ x: 0, y: 0, width, height });
}

/** Whether any window is bound to `id` or keeps it in its rail. */
function isMachineInUse(id: string): boolean {
  return getAppWindows().some(
    (window) =>
      !window.isDestroyed() &&
      (getBackendIdForWindow(window) === id || readWindowRail(window).machineIds.includes(id)),
  );
}

function releaseMachine(id: string): void {
  if (id === LOCAL_CONNECTION_ID || isMachineInUse(id)) return;
  try {
    deps?.disconnect(id);
  } catch (error) {
    logger.warn('Failed to disconnect a machine removed from the rail', {
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
  // A view's web contents outlives its window unless it is closed here.
  if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  forgetHealthWithoutRenderer(id);
}

/** Broadcast to every window whose rail lists `id`. */
function broadcastToRailsOf(id: string): void {
  for (const window of getAppWindows()) {
    if (!window.isDestroyed() && readWindowRail(window).machineIds.includes(id)) {
      broadcastState(window);
    }
  }
}

/** Health is reported by a machine's renderers: with none left, its report is stale. */
function forgetHealthWithoutRenderer(id: string): void {
  if (!degradedMachines.has(id)) return;
  const rendered = getAppWindows().some(
    (window) =>
      !window.isDestroyed() && (getBackendIdForWindow(window) === id || viewsOf(window).has(id)),
  );
  if (rendered) return;
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
  window.once('closed', () => {
    const rail = readWindowRail(window);
    clearTransition(window);
    for (const id of [...viewsOf(window).keys()]) destroyView(window, id);
    clearWindowRail(window);
    forgetHealthWithoutRenderer(rail.machineIds[0]);
    for (const id of rail.machineIds.slice(1)) releaseMachine(id);
  });
}

function ensureView(window: BrowserWindowType, id: string): WebContentsView {
  const views = viewsOf(window);
  const existing = views.get(id);
  if (existing && !existing.webContents.isDestroyed()) return existing;
  observeWindow(window);
  const view = new WebContentsView({ webPreferences: buildRendererWebPreferences() });
  bindMachineViewToBackend(window, view.webContents, id);
  // The window's own renderer paints the shell background and accent tint
  // under every view, so the tint can cross-fade between machines.
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  forwardRendererConsoleToMainLog(window, view.webContents);
  views.set(id, view);
  window.contentView.addChildView(view);
  layoutViews(window);
  view.webContents
    .loadURL(buildLoadUrl())
    .catch((error: unknown) => logger.error('Failed to load a machine view', error as Error));
  return view;
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
 * an empty window. The window's own renderer is always at the bottom.
 */
function applySelection(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const { machineIds, selectedId } = readWindowRail(window);
  const transition = transitionOf(window);
  const selected = selectedId === machineIds[0] ? null : ensureView(window, selectedId);
  setShownMachineView(window, selected ? selected.webContents : null);
  app.emit(MACHINE_RAIL_SHOWN_CHANGED_EVENT, window);
  if (selected) {
    selected.setVisible(true);
    // Adding a child view again moves it to the top.
    window.contentView.addChildView(selected);
  }
  clearTimeout(transition.revealTimer);
  transition.revealTimer = undefined;
  if (transition.shownId === selectedId) finishReveal(window);
  else transition.revealTimer = setTimeout(() => finishReveal(window), REVEAL_TIMEOUT_MS);
  const target = selected ? selected.webContents : window.webContents;
  if (window.isFocused() && !target.isDestroyed()) target.focus();
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
  if (id === readWindowRail(window).machineIds[0]) return true;
  const view = viewsOf(window).get(id);
  return !!view && !view.webContents.isDestroyed() && readyViews.has(view.webContents);
}

/** A machine's renderer finished starting: show it if the user is waiting for it. */
function markReady(window: BrowserWindowType, sender: Electron.WebContents): void {
  const entry = [...viewsOf(window)].find(([, view]) => view.webContents === sender);
  if (!entry) return;
  readyViews.add(sender);
  if (isMachineRailEnabled() && transitions.get(window)?.pendingId === entry[0]) {
    showMachine(window, entry[0]);
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

async function addMachine(window: BrowserWindowType, id: string): Promise<MachineRailState> {
  if (!deps || !(await deps.listMachineIds()).includes(id)) throw new Error('Unknown machine');
  const rail = readWindowRail(window);
  const machineIds = addRailMachine(rail.machineIds, id);
  if (!machineIds.includes(id)) throw new Error('This window has no room for another machine');
  observeWindow(window);
  writeWindowRail(window, { machineIds, selectedId: rail.selectedId });
  awaitMachine(window, id);
  broadcastState(window);
  await connectQuietly(id);
  if (window.isDestroyed()) throw new Error('Window closed');
  // The user may have picked another machine (or removed this one) meanwhile.
  if (transitions.get(window)?.pendingId !== id) return stateOf(window);
  return selectMachine(window, id);
}

function removeMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  const next = removeRailMachine({ homeId: rail.machineIds[0], ...rail }, id);
  if (transitionOf(window).pendingId === id) clearPending(window);
  writeWindowRail(window, next);
  applySelection(window);
  destroyView(window, id);
  broadcastState(window);
  releaseMachine(id);
  return stateOf(window);
}

/** A forgotten machine leaves every rail. */
export function removeMachineFromAllRails(id: string): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    const rail = readWindowRail(window);
    if (rail.machineIds.indexOf(id) > 0) removeMachine(window, id);
  }
}

async function restoreRail(window: BrowserWindowType, session: unknown): Promise<void> {
  if (!deps) return;
  const saved = await deps.listMachineIds();
  if (window.isDestroyed() || !isMachineRailEnabled()) return;
  const homeId = getBackendIdForWindow(window);
  const rail = normalizeRailSession(homeId, session, (id) => id !== homeId && saved.includes(id));
  if (rail.machineIds.length < 2) return;
  observeWindow(window);
  // The window's own machine shows until the one that was shown has started.
  writeWindowRail(window, { machineIds: rail.machineIds, selectedId: homeId });
  const selected = rail.selectedId;
  if (selected !== homeId) awaitMachine(window, selected);
  broadcastState(window);
  // Every machine reconnects now; only the one that was shown gets a renderer.
  await Promise.all(
    rail.machineIds.slice(1).map(async (id) => {
      await connectQuietly(id);
      if (id !== selected || window.isDestroyed()) return;
      if (transitions.get(window)?.pendingId === id) selectMachine(window, id);
    }),
  );
}

function resetWindow(window: BrowserWindowType): void {
  const rail = readWindowRail(window);
  clearTransition(window);
  for (const id of [...viewsOf(window).keys()]) destroyView(window, id);
  clearWindowRail(window);
  setShownMachineView(window, null);
  app.emit(MACHINE_RAIL_SHOWN_CHANGED_EVENT, window);
  if (!window.webContents.isDestroyed() && window.isFocused()) window.webContents.focus();
  for (const id of rail.machineIds.slice(1)) releaseMachine(id);
}

async function setEnabled(next: boolean): Promise<void> {
  if (next === isMachineRailEnabled()) return;
  await setLocalPref(ENABLED_PREF, next);
  setMachineRailEnabledFlag(next);
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    if (!next) resetWindow(window);
    broadcastState(window);
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
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) throw new Error('No window for this request');
  return window;
}

function assertEnabled(): void {
  if (!isMachineRailEnabled()) throw new Error('The machine rail is turned off');
}

export function registerMachineRailHandlers(railDeps: MachineRailDeps): void {
  deps = railDeps;
  setMachineRailRestoreHandler((window, session) => {
    void restoreRail(window, session).catch((error: unknown) =>
      logger.warn('Failed to restore a machine rail', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
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
        return selectMachine(windowOf(event.sender), id);
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
        return addMachine(windowOf(event.sender), id);
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
        return removeMachine(windowOf(event.sender), id);
      },
      MACHINE_RAIL.REMOVE,
    ),
  );
  ipcMain.handle(
    MACHINE_RAIL.SHOWN,
    createValidatedHandler(
      EmptySchema,
      async (event) => {
        completeReveal(windowOf(event.sender), event.sender);
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
        markReady(windowOf(event.sender), event.sender);
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
