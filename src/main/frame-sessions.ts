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

/**
 * A frame made safe to restore, or null when nothing restorable is left: valid
 * bounds, only saved machines, no duplicates, routes that are app paths, and a
 * selection that is in the list. The first machine's page is the window's own
 * page, so a frame whose first page may not reopen is dropped; any other
 * machine's unrestorable page just falls back to its default page.
 */
function normalizeFrameSession(raw: unknown, filter: FrameSessionFilter): FrameSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const bounds = readBounds(record.bounds);
  if (!bounds || !Array.isArray(record.machines)) return null;
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

/** The machine a saved frame opens its window on (the window's own machine, for now). */
export function frameOwnMachineId(frame: FrameSession): string {
  return frame.machines[0].id;
}

/** Frames to restore, the ones opening on `activeId` first; the rest keep their saved order. */
export function orderFramesForRestore(frames: FrameSession[], activeId: string): FrameSession[] {
  const isActive = (frame: FrameSession) => frameOwnMachineId(frame) === activeId;
  return [...frames.filter(isActive), ...frames.filter((frame) => !isActive(frame))];
}

/**
 * What to save: the live frames, then the saved frames not restored this run
 * (their machine could not connect) unless the user has since opened a window
 * on that machine, which replaces them.
 */
export function mergeParkedFrames(live: FrameSession[], parked: FrameSession[]): FrameSession[] {
  const liveOwners = new Set(live.map(frameOwnMachineId));
  return [...live, ...parked.filter((frame) => !liveOwners.has(frameOwnMachineId(frame)))];
}

/**
 * `frame` reopened on `ownId`: that machine first, the others after it in
 * their order. The machines before it could not connect and are dropped.
 */
export function promoteFrameMachine(frame: FrameSession, ownId: string): FrameSession {
  const index = frame.machines.findIndex((machine) => machine.id === ownId);
  if (index <= 0) return frame;
  const machines = frame.machines.slice(index);
  const selectedId = machines.some((m) => m.id === frame.selectedId) ? frame.selectedId : ownId;
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
