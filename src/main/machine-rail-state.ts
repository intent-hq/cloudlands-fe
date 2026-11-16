/**
 * Machine rail — per-frame state, main process.
 *
 * Holds which machines a frame (app window) holds, in rail order, and which
 * one it shows. With the rail lab off a frame holds one machine. Dependency-
 * light on purpose: window.ts reads it to save and open frames, and
 * machine-rail.ts (views and IPC) writes it, without either importing the
 * other.
 */

import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { FrameMachineSession, MachineRailSession } from '../shared/types/machine-rail';

export interface WindowRail {
  /** The frame's machines in rail order; empty only before it opens or once it closed. */
  machineIds: string[];
  selectedId: string;
}

const EMPTY_RAIL: WindowRail = Object.freeze({ machineIds: [], selectedId: '' }) as WindowRail;

/**
 * `app` event, with the window: a frame's saved layout changed (a machine
 * view navigated, or its machines or selection changed).
 */
export const FRAME_LAYOUT_CHANGED_EVENT = 'frame-layout-changed';

/** `app` event, with the window: it now shows another machine's renderer. */
export const MACHINE_RAIL_SHOWN_CHANGED_EVENT = 'machine-rail-shown-changed';

const rails = new WeakMap<BrowserWindowType, WindowRail>();
/** A machine a window waits to show; the session saves it as the selection. */
const pendingSelections = new WeakMap<BrowserWindowType, string>();
let enabled = false;

/** Opens `machines` in a new frame and returns the shown machine's renderer. */
type FrameOpener = (
  window: BrowserWindowType,
  machines: FrameMachineSession[],
  selectedId: string,
) => Electron.WebContents | null;
let frameOpener: FrameOpener | null = null;

export function isMachineRailEnabled(): boolean {
  return enabled;
}

export function setMachineRailEnabledFlag(next: boolean): void {
  enabled = next;
}

/** The frame's machines and the one it shows; empty for a window that is not an open frame. */
export function readWindowRail(window: BrowserWindowType): WindowRail {
  return rails.get(window) ?? EMPTY_RAIL;
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

/**
 * What the frame's saved layout keeps: every machine in rail order and the
 * one it shows, or waits to show. Nothing for a window that holds no machine.
 */
export function getMachineRailSession(window: BrowserWindowType): MachineRailSession | undefined {
  const rail = readWindowRail(window);
  if (rail.machineIds.length === 0) return undefined;
  const pending = pendingSelections.get(window);
  const selectedId = pending && rail.machineIds.includes(pending) ? pending : rail.selectedId;
  return { machineIds: [...rail.machineIds], selectedId };
}

export function setFrameOpener(opener: FrameOpener | null): void {
  frameOpener = opener;
}

/**
 * Open `machines` (each on its saved page) in `window`, a new frame, showing
 * `selectedId`. Returns the shown machine's renderer, or null before the rail
 * owner registered (startup) or when no machine is left to open.
 */
export function openFrameMachines(
  window: BrowserWindowType,
  machines: FrameMachineSession[],
  selectedId: string,
): Electron.WebContents | null {
  return frameOpener?.(window, machines, selectedId) ?? null;
}

type RendererStarter = (backendId: string, deadline: number) => Promise<boolean>;
let rendererStarter: RendererStarter | null = null;

export function setMachineRailRendererStarter(starter: RendererStarter | null): void {
  rendererStarter = starter;
}

/**
 * Make sure a machine some rail lists has a renderer, starting it hidden if
 * none runs yet, so work main routes to that machine's renderer (agent
 * browser ops) reaches it without the user opening the machine. Settles once
 * the renderer is ready, or at `deadline` (epoch ms), with whether a rail
 * lists the machine.
 */
export async function startRailMachineRenderer(
  backendId: string,
  deadline: number,
): Promise<boolean> {
  if (!enabled || !rendererStarter) return false;
  return rendererStarter(backendId, deadline);
}

/** A machine a rail now shows; `ready` settles with whether its renderer started in time. */
export interface ShownRailMachine {
  window: BrowserWindowType;
  contents: Electron.WebContents;
  ready: Promise<boolean>;
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
