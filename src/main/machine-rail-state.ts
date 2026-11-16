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
  machinesAside.delete(window);
}

/**
 * A frame's whole machine list, in rail order, while the rail is off and the
 * frame holds only the machine it shows. Saved in its place, so a launch with
 * the rail off does not lose the frame's other machines.
 */
const machinesAside = new WeakMap<BrowserWindowType, string[]>();

/** Keep `machineIds` (the shown one among them) aside for `window`; null forgets them. */
export function setFrameMachinesAside(
  window: BrowserWindowType,
  machineIds: readonly string[] | null,
): void {
  if (machineIds && machineIds.length > 1) machinesAside.set(window, [...machineIds]);
  else machinesAside.delete(window);
}

/** The machine list kept aside for `window`, if any. */
export function getFrameMachinesAside(window: BrowserWindowType): string[] | undefined {
  const aside = machinesAside.get(window);
  return aside ? [...aside] : undefined;
}

const emptiedFrames = new WeakSet<BrowserWindowType>();

/**
 * The user removed the frame's last machine and it is about to close: empty
 * its rail so no save keeps the removed machine, and mark it so the closing
 * save drops the frame even when it is the last window.
 */
export function emptyFrameForClose(window: BrowserWindowType): void {
  clearWindowRail(window);
  emptiedFrames.add(window);
}

/** Whether `window` is closing because its last machine was removed. */
export function isFrameEmptied(window: BrowserWindowType): boolean {
  return emptiedFrames.has(window);
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
  const aside = machinesAside.get(window);
  if (aside?.includes(selectedId)) return { machineIds: [...aside], selectedId };
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

/**
 * What the rail owner does for window-level commands (open a machine, show a
 * workspace) so main/window.ts never imports machine-rail.ts.
 */
export interface FrameMachineCommands {
  /** Show `backendId` in `window`, which holds it; null when it does not. */
  select(window: BrowserWindowType, backendId: string): ShownRailMachine | null;
  /** Add `backendId` to `window` and show it; false when the window cannot take it. */
  add(window: BrowserWindowType, backendId: string): Promise<boolean>;
}
let frameMachineCommands: FrameMachineCommands | null = null;

export function setFrameMachineCommands(commands: FrameMachineCommands | null): void {
  frameMachineCommands = commands;
}

/** Show `backendId` in `window`, which holds it. Null before the rail owner registered. */
export function selectFrameMachine(
  window: BrowserWindowType,
  backendId: string,
): ShownRailMachine | null {
  return frameMachineCommands?.select(window, backendId) ?? null;
}

/** Add `backendId` to `window` (rail on) and show it; false when it cannot join. */
export async function addMachineToFrame(
  window: BrowserWindowType,
  backendId: string,
): Promise<boolean> {
  if (!enabled || !frameMachineCommands) return false;
  return frameMachineCommands.add(window, backendId);
}
