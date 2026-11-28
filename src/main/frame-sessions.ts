/**
 * Saved frames — pure helpers, main process.
 *
 * A frame (app window) saves its bounds, its machines in order with the page
 * each one showed, and the machine it showed, in window-frames.json. This
 * module parses that file, migrates the older per-backend
 * window-sessions.json into it, and orders frames for restore. No Electron or
 * fs access, so every shape can be tested directly; main/window.ts does the
 * I/O.
 */

import type { FrameMachineSession, FrameSession } from '../shared/types/machine-rail';
import {
  isTabWindowId,
  tabWindowRoute,
  type TabWindowRecord,
  type TabWindowTab,
} from '../shared/types/tab-window';

export const WINDOW_FRAMES_VERSION = 1;

/** Most frames restored at startup, guarding against a corrupted file. */
const MAX_SAVED_FRAMES = 20;

export interface FrameSessionFilter {
  /** Whether a machine is still saved; frames drop the others. */
  isSavedMachine: (id: string) => boolean;
  /** Whether a window page may reopen at startup (dock, console and overlay pages may not). */
  isRestorableRoute: (route: string) => boolean;
}

type Bounds = FrameSession['bounds'];

function readBounds(value: unknown): Bounds | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return { x, y, width, height };
}

function readRoute(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') ? value : undefined;
}

/** Most characters in a saved id (workspace, layout, tab). */
const MAX_SAVED_ID_LENGTH = 256;

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SAVED_ID_LENGTH
    ? value
    : null;
}

/**
 * A saved tab window's record, or null when it is not one: a valid id, the
 * workspace and layout it came from, and a tab with an id and a type. The
 * tab's other fields are the renderer's own and pass through.
 */
function readTabWindow(value: unknown): TabWindowRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tabWindowId, workspaceId, sourceLayoutId, tab } = value as Record<string, unknown>;
  if (!isTabWindowId(tabWindowId)) return null;
  const workspace = readId(workspaceId);
  const layout = readId(sourceLayoutId);
  if (!workspace || !layout || typeof tab !== 'object' || tab === null) return null;
  const { id, type } = tab as Record<string, unknown>;
  if (!readId(id) || typeof type !== 'string' || type === '') return null;
  const { tabWindowId: _marker, ...rest } = tab as TabWindowTab;
  return { tabWindowId, workspaceId: workspace, sourceLayoutId: layout, tab: rest };
}

/**
 * A saved tab window frame made safe to restore: one machine, on its tab
 * window page, with its record. Null when the record or machine is not valid.
 */
function normalizeTabWindowFrame(
  record: Record<string, unknown>,
  bounds: Bounds,
  filter: FrameSessionFilter,
): FrameSession | null {
  const tabWindow = readTabWindow(record.tabWindow);
  if (!tabWindow || !Array.isArray(record.machines)) return null;
  const first = record.machines[0] as Record<string, unknown> | undefined;
  const id = first && typeof first === 'object' ? readId(first.id) : null;
  if (!id || !filter.isSavedMachine(id)) return null;
  const frame: FrameSession = {
    bounds,
    machines: [{ id, route: tabWindowRoute(tabWindow.tabWindowId) }],
    selectedId: id,
    tabWindow,
  };
  if (record.isFullScreen === true) frame.isFullScreen = true;
  return frame;
}

/**
 * A frame made safe to restore, or null when nothing restorable is left: valid
 * bounds, only saved machines, no duplicates, routes that are app paths, and a
 * selection that is in the list. A frame whose first page may not reopen (a
 * dock, console or overlay window saved by an older client) is dropped; any
 * other machine's unrestorable page just falls back to its default page.
 */
function normalizeFrameSession(raw: unknown, filter: FrameSessionFilter): FrameSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const bounds = readBounds(record.bounds);
  if (!bounds || !Array.isArray(record.machines)) return null;
  if (record.tabWindow !== undefined) return normalizeTabWindowFrame(record, bounds, filter);
  const machines: FrameMachineSession[] = [];
  for (const entry of record.machines) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, route } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || !filter.isSavedMachine(id)) continue;
    if (machines.some((machine) => machine.id === id)) continue;
    const path = readRoute(route);
    if (machines.length === 0 && path !== undefined && !filter.isRestorableRoute(path)) return null;
    machines.push(
      path !== undefined && filter.isRestorableRoute(path) ? { id, route: path } : { id },
    );
  }
  if (machines.length === 0) return null;
  const selectedId =
    typeof record.selectedId === 'string' && machines.some((m) => m.id === record.selectedId)
      ? record.selectedId
      : machines[0].id;
  const frame: FrameSession = { bounds, machines, selectedId };
  if (record.isFullScreen === true) frame.isFullScreen = true;
  return frame;
}

function normalizeFrames(raws: unknown[], filter: FrameSessionFilter): FrameSession[] {
  const frames: FrameSession[] = [];
  for (const raw of raws) {
    if (frames.length >= MAX_SAVED_FRAMES) break;
    const frame = normalizeFrameSession(raw, filter);
    if (frame) frames.push(frame);
  }
  return frames;
}

/**
 * The frames in a parsed window-frames.json, or null when the data is not a
 * version-1 frames file.
 */
export function parseWindowFramesFile(
  data: unknown,
  filter: FrameSessionFilter,
): FrameSession[] | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { version, frames } = data as Record<string, unknown>;
  if (version !== WINDOW_FRAMES_VERSION || !Array.isArray(frames)) return null;
  return normalizeFrames(frames, filter);
}

/** One old window session: `{ route, bounds, isFullScreen?, rail? }` saved under backend `backendId`. */
function frameFromLegacySession(backendId: string, session: unknown): unknown {
  if (typeof session !== 'object' || session === null) return null;
  const { route, bounds, isFullScreen, rail } = session as Record<string, unknown>;
  if (typeof route !== 'string') return null;
  const { machineIds, selectedId } = (rail ?? {}) as Record<string, unknown>;
  const railIds = Array.isArray(machineIds) ? machineIds : [];
  return {
    bounds,
    isFullScreen,
    machines: [{ id: backendId, route }, ...railIds.map((id: unknown) => ({ id }))],
    selectedId: typeof selectedId === 'string' ? selectedId : backendId,
  };
}

/**
 * Best-effort migration of a parsed window-sessions.json (older clients) into
 * frames. That file is either a bare session array (the oldest clients, all on
 * the local machine) or a map from backend id to that backend's sessions. Each
 * session in bucket `B` becomes a frame holding `B` with its page, then its
 * rail machines, showing the rail's selection. Anything unreadable is skipped.
 */
export function migrateWindowSessions(
  data: unknown,
  localMachineId: string,
  filter: FrameSessionFilter,
): FrameSession[] {
  let buckets: [string, unknown][];
  if (Array.isArray(data)) buckets = [[localMachineId, data]];
  else if (typeof data === 'object' && data !== null) buckets = Object.entries(data);
  else return [];
  const raws: unknown[] = [];
  for (const [backendId, sessions] of buckets) {
    if (!Array.isArray(sessions)) continue;
    for (const session of sessions) raws.push(frameFromLegacySession(backendId, session));
  }
  return normalizeFrames(raws, filter);
}

/** Whether a saved frame holds `machineId`. */
export function frameHolds(frame: FrameSession, machineId: string): boolean {
  return frame.machines.some((machine) => machine.id === machineId);
}

/**
 * Frames to restore, the ones showing `activeId` first; the rest keep their
 * saved order. Tab windows come last, in saved order: the frames their tabs
 * go back to open first, and a tab window never becomes the main window.
 */
export function orderFramesForRestore(frames: FrameSession[], activeId: string): FrameSession[] {
  const app = frames.filter((frame) => !frame.tabWindow);
  const isActive = (frame: FrameSession) => frame.selectedId === activeId;
  return [
    ...app.filter(isActive),
    ...app.filter((frame) => !isActive(frame)),
    ...frames.filter((frame) => frame.tabWindow),
  ];
}

/**
 * What to save: the live frames, then the saved frames not restored this run
 * (none of their machines could connect). A saved frame is replaced only once
 * live frames hold every one of its machines, so a machine opened elsewhere
 * never takes the frame's other machines with it.
 */
export function mergeParkedFrames(live: FrameSession[], parked: FrameSession[]): FrameSession[] {
  const liveMachines = new Set(live.flatMap((frame) => frame.machines.map((m) => m.id)));
  return [
    ...live,
    ...parked.filter((frame) => !frame.machines.every((machine) => liveMachines.has(machine.id))),
  ];
}

/**
 * `frame` with only the machines `keep` accepts, in their order, or null when
 * none is left. A selection that was dropped moves to the first kept machine.
 */
export function keepFrameMachines(
  frame: FrameSession,
  keep: (id: string) => boolean,
): FrameSession | null {
  const machines = frame.machines.filter((machine) => keep(machine.id));
  if (machines.length === 0) return null;
  if (machines.length === frame.machines.length) return frame;
  const selectedId = machines.some((m) => m.id === frame.selectedId)
    ? frame.selectedId
    : machines[0].id;
  return { ...frame, machines, selectedId };
}

/**
 * The app route a renderer URL shows, or null before it loaded a page.
 * Windows created through `WINDOW_CHANNELS.CREATE` load a `file:` URL with an
 * `?initialRoute=`; dev (`http:`) and production (`app:`) URLs carry it as the
 * path.
 */
export function routeFromRendererUrl(url: string, defaultRoute: string): string | null {
  if (!url || url === 'about:blank') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return parsed.searchParams.get('initialRoute') || defaultRoute;
    return parsed.pathname;
  } catch {
    return defaultRoute;
  }
}
