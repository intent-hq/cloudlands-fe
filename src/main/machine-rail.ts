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

import { BrowserWindow, ipcMain, nativeTheme, WebContentsView } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { Logger } from '../shared/logger';
import { getWindowBackgroundColor } from '../shared/main/window-appearance';
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
  MachineRailMachineSchema,
  MachineRailSetEnabledSchema,
} from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getLocalPref, setLocalPref } from './local-prefs';
import {
  clearWindowRail,
  isMachineRailEnabled,
  readWindowRail,
  setMachineRailEnabledFlag,
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
  /** Ids of the saved machines a window may show (no nodes, no guest hosts). */
  listMachineIds(): Promise<string[]>;
  /** Connect (or reuse) the pooled client of a saved machine. */
  connect(id: string): Promise<unknown>;
  /** Drop the pooled client of a machine no window or rail uses any more. */
  disconnect(id: string): void;
}

let deps: MachineRailDeps | null = null;
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

function stateOf(window: BrowserWindowType): MachineRailState {
  const rail = readWindowRail(window);
  return {
    enabled: isMachineRailEnabled(),
    homeId: rail.machineIds[0],
    machineIds: [...rail.machineIds],
    selectedId: rail.selectedId,
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
    for (const id of [...viewsOf(window).keys()]) destroyView(window, id);
    clearWindowRail(window);
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
  view.setBackgroundColor(getWindowBackgroundColor(nativeTheme.shouldUseDarkColors));
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

/** Show the selected machine's renderer and hide the others. */
function applySelection(window: BrowserWindowType): void {
  if (window.isDestroyed()) return;
  const { machineIds, selectedId } = readWindowRail(window);
  const homeId = machineIds[0];
  const selected = selectedId === homeId ? null : ensureView(window, selectedId);
  setShownMachineView(window, selected ? selected.webContents : null);
  for (const [id, view] of viewsOf(window)) view.setVisible(id === selectedId);
  const target = selected ? selected.webContents : window.webContents;
  if (window.isFocused() && !target.isDestroyed()) target.focus();
}

function selectMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  if (!rail.machineIds.includes(id)) throw new Error('Machine is not in this window');
  writeWindowRail(window, { machineIds: rail.machineIds, selectedId: id });
  applySelection(window);
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
  broadcastState(window);
  await connectQuietly(id);
  if (window.isDestroyed()) throw new Error('Window closed');
  if (!readWindowRail(window).machineIds.includes(id)) return stateOf(window);
  return selectMachine(window, id);
}

function removeMachine(window: BrowserWindowType, id: string): MachineRailState {
  const rail = readWindowRail(window);
  const next = removeRailMachine({ homeId: rail.machineIds[0], ...rail }, id);
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
  writeWindowRail(window, rail);
  broadcastState(window);
  // Every machine reconnects now; only the one that was shown gets a renderer.
  const selected = rail.selectedId;
  await Promise.all(
    rail.machineIds.slice(1).map(async (id) => {
      await connectQuietly(id);
      if (id !== selected || window.isDestroyed()) return;
      if (readWindowRail(window).selectedId === id) {
        applySelection(window);
        broadcastState(window);
      }
    }),
  );
}

function resetWindow(window: BrowserWindowType): void {
  const rail = readWindowRail(window);
  for (const id of [...viewsOf(window).keys()]) destroyView(window, id);
  clearWindowRail(window);
  setShownMachineView(window, null);
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
  // The status menu of a machine lives in that machine's renderer: show the
  // machine, then ask its renderer to open the menu at its rail item.
  ipcMain.handle(
    MACHINE_RAIL.OPEN_MENU,
    createValidatedHandler(
      MachineRailMachineSchema,
      async (event, { id }) => {
        assertEnabled();
        const window = windowOf(event.sender);
        const state = selectMachine(window, id);
        const target = getShownRendererWebContents(window);
        // A view that is still loading has no rail to anchor the menu to yet.
        if (!target.isLoadingMainFrame()) target.send(MACHINE_RAIL.MENU_REQUESTED, { id });
        return state;
      },
      MACHINE_RAIL.OPEN_MENU,
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
