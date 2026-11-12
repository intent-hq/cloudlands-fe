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
}

/** What to save with the window's session; nothing while the rail holds only home. */
export function getMachineRailSession(window: BrowserWindowType): MachineRailSession | undefined {
  if (!enabled) return undefined;
  const rail = readWindowRail(window);
  if (rail.machineIds.length < 2) return undefined;
  return { machineIds: rail.machineIds.slice(1), selectedId: rail.selectedId };
}

export function setMachineRailRestoreHandler(handler: RestoreHandler | null): void {
  restoreHandler = handler;
}

/** Hand a saved rail to the rail owner; ignored while the lab is off. */
export function restoreMachineRailSession(window: BrowserWindowType, session: unknown): void {
  if (!enabled || session === undefined || session === null) return;
  restoreHandler?.(window, session);
}
