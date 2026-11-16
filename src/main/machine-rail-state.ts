/**
 * Machine rail (Labs) — per-window state, main process.
 *
 * Holds which machines a window keeps in its rail and which one it shows.
 * Dependency-light on purpose: window.ts reads it to save and restore window
 * sessions, and machine-rail.ts (views and IPC) writes it, without either
 * importing the other.
 */

import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { MachineRailSession } from '../shared/types/machine-rail';
import { getBackendIdForWindow } from './window-backend';

export interface WindowRail {
  /** Home machine first, then the machines added to the window. */
  machineIds: string[];
  selectedId: string;
}

/** `app` event, with the window: it now shows another machine's renderer. */
export const MACHINE_RAIL_SHOWN_CHANGED_EVENT = 'machine-rail-shown-changed';

const rails = new WeakMap<BrowserWindowType, WindowRail>();
/** A machine a window waits to show; the session saves it as the selection. */
const pendingSelections = new WeakMap<BrowserWindowType, string>();
let enabled = false;

type RestoreHandler = (window: BrowserWindowType, session: unknown) => void;
let restoreHandler: RestoreHandler | null = null;

export function isMachineRailEnabled(): boolean {
  return enabled;
}

export function setMachineRailEnabledFlag(next: boolean): void {
  enabled = next;
}

/** The window's rail; a window without one shows only its own machine. */
export function readWindowRail(window: BrowserWindowType): WindowRail {
  const homeId = getBackendIdForWindow(window);
  const rail = rails.get(window);
  if (!rail || rail.machineIds[0] !== homeId) return { machineIds: [homeId], selectedId: homeId };
  return rail;
}

export function writeWindowRail(window: BrowserWindowType, rail: WindowRail): void {
  rails.set(window, rail);
}

export function clearWindowRail(window: BrowserWindowType): void {
  rails.delete(window);
  pendingSelections.delete(window);
}

/** Record the machine the window waits to show (`''` when none). */
export function setPendingSelection(window: BrowserWindowType, id: string): void {
  if (id) pendingSelections.set(window, id);
  else pendingSelections.delete(window);
}

/** What to save with the window's session; nothing while the rail holds only home. */
export function getMachineRailSession(window: BrowserWindowType): MachineRailSession | undefined {
  if (!enabled) return undefined;
  const rail = readWindowRail(window);
  if (rail.machineIds.length < 2) return undefined;
  const pending = pendingSelections.get(window);
  const selectedId = pending && rail.machineIds.includes(pending) ? pending : rail.selectedId;
  return { machineIds: rail.machineIds.slice(1), selectedId };
}

export function setMachineRailRestoreHandler(handler: RestoreHandler | null): void {
  restoreHandler = handler;
}

type RendererStarter = (backendId: string, deadline: number) => Promise<void>;
let rendererStarter: RendererStarter | null = null;

export function setMachineRailRendererStarter(starter: RendererStarter | null): void {
  rendererStarter = starter;
}

/**
 * Make sure a machine some rail lists has a renderer, starting it hidden if
 * none runs yet, so work main routes to that machine's renderer (agent
 * browser ops) reaches it without the user opening the machine. Settles once
 * the renderer is ready, or at `deadline` (epoch ms).
 */
export async function startRailMachineRenderer(backendId: string, deadline: number): Promise<void> {
  if (!enabled || !rendererStarter) return;
  await rendererStarter(backendId, deadline);
}

/** A machine a rail now shows, and when its renderer is ready to take a route. */
export interface ShownRailMachine {
  window: BrowserWindowType;
  contents: Electron.WebContents;
  ready: Promise<void>;
}

type MachineShower = (backendId: string) => ShownRailMachine | null;
let machineShower: MachineShower | null = null;

export function setMachineRailShower(shower: MachineShower | null): void {
  machineShower = shower;
}

/**
 * Pick `backendId` in a window whose rail lists it (the focused one first),
 * starting its renderer if needed. Null when no rail lists the machine.
 */
export function showRailMachine(backendId: string): ShownRailMachine | null {
  if (!enabled || !machineShower) return null;
  return machineShower(backendId);
}

/** Hand a saved rail to the rail owner; ignored while the lab is off. */
export function restoreMachineRailSession(window: BrowserWindowType, session: unknown): void {
  if (!enabled || session === undefined || session === null) return;
  restoreHandler?.(window, session);
}
