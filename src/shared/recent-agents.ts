/**
 * Recent agents: the agent conversations the user opened on this device, most recent first,
 * across every saved connection. Main owns the list (one per app, shared by every window, not
 * synced across devices); these pure helpers keep it, as the iOS app's agent history does.
 */

import {
  matchesShortcut,
  normalizeShortcut,
  type ShortcutKeyboardEvent,
} from './keyboard-shortcut-bindings';

/** One opened agent conversation, keyed by its connection and agent. */
export interface RecentAgentEntry {
  connectionId: string;
  workspaceId: string;
  /** Null when the workspace title was not known at the visit. */
  workspaceTitle: string | null;
  agentId: string;
  agentName: string;
  /** Epoch milliseconds of the latest visit. */
  visitedAt: number;
}

/** @internal */
export const RECENT_AGENTS_LIMIT = 30;

/** Push channel (main → renderer) that carries the whole list after each change. */
export const RECENT_AGENTS_CHANGED_EVENT = 'recent-agents:changed';

/** Push channel (main → renderer) for switcher keys pressed in a browser-panel page. */
export const RECENT_AGENTS_PAGE_KEY_EVENT = 'recent-agents:page-key';

/** A key a browser-panel page forwarded to its app window, with the modifiers then held. */
export interface RecentAgentPageKey {
  type: 'keydown' | 'keyup';
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The fields of Electron's `Input` that a browser-panel page reports. */
export interface PageInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Whether `event` presses the switcher chord: forward, or backwards with Shift added. A binding
 * that already uses Shift has no backwards chord.
 */
export function matchSwitcherChord(
  event: ShortcutKeyboardEvent,
  binding: string,
  mac: boolean,
): 'forward' | 'backward' | null {
  if (matchesShortcut(event, binding, mac)) return 'forward';
  const normalized = normalizeShortcut(binding);
  if (!event.shiftKey || !normalized || normalized.split('+').includes('shift')) return null;
  const key = normalized.slice(normalized.lastIndexOf('+') + 1);
  const modifiers = normalized.slice(0, normalized.length - key.length);
  return matchesShortcut(event, `${modifiers}shift+${key}`, mac) ? 'backward' : null;
}

/**
 * What a browser-panel page forwards to its app window: the switcher chord (`binding`, forward or
 * with Shift), then, while that chord is open, the release of a modifier. Other keys stay with the
 * page.
 */
export function pageKeyToForward(
  input: PageInput,
  chordOpen: boolean,
  binding: string,
  mac: boolean,
): RecentAgentPageKey | null {
  const key = {
    key: input.key,
    metaKey: input.meta,
    ctrlKey: input.control,
    altKey: input.alt,
    shiftKey: input.shift,
  };
  if (input.type === 'keyDown' && matchSwitcherChord(key, binding, mac))
    return { type: 'keydown', ...key };
  if (chordOpen && input.type === 'keyUp' && ['Control', 'Meta', 'Alt'].includes(input.key))
    return { type: 'keyup', ...key };
  return null;
}

export function recentAgentKey(entry: Pick<RecentAgentEntry, 'connectionId' | 'agentId'>): string {
  return `${entry.connectionId}/${entry.agentId}`;
}

/**
 * Moves `visit` to the front. A visit made before the workspace list loaded keeps the title an
 * earlier visit recorded.
 */
export function recordRecentAgentVisit(
  entries: readonly RecentAgentEntry[],
  visit: RecentAgentEntry,
  limit: number = RECENT_AGENTS_LIMIT,
): RecentAgentEntry[] {
  const key = recentAgentKey(visit);
  const previous = entries.find((entry) => recentAgentKey(entry) === key);
  const recorded =
    visit.workspaceTitle === null && previous
      ? { ...visit, workspaceTitle: previous.workspaceTitle }
      : visit;
  return [recorded, ...entries.filter((entry) => recentAgentKey(entry) !== key)].slice(0, limit);
}

/** Drops one connection's entries for a workspace it reported deleted or archived. */
export function removeRecentAgentWorkspace(
  entries: readonly RecentAgentEntry[],
  connectionId: string,
  workspaceId: string,
): RecentAgentEntry[] {
  return entries.filter(
    (entry) => entry.connectionId !== connectionId || entry.workspaceId !== workspaceId,
  );
}

/** Entries whose connection is still saved; forgotten connections drop out. */
export function visibleRecentAgents(
  entries: readonly RecentAgentEntry[],
  savedConnectionIds: ReadonlySet<string>,
): RecentAgentEntry[] {
  return entries.filter((entry) => savedConnectionIds.has(entry.connectionId));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Reads a stored or received entry; null when it is not a whole entry. */
function parseRecentAgentEntry(value: unknown): RecentAgentEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    !nonEmptyString(raw.connectionId) ||
    !nonEmptyString(raw.workspaceId) ||
    !nonEmptyString(raw.agentId) ||
    typeof raw.agentName !== 'string' ||
    !(raw.workspaceTitle === null || typeof raw.workspaceTitle === 'string') ||
    typeof raw.visitedAt !== 'number' ||
    !Number.isFinite(raw.visitedAt)
  )
    return null;
  return {
    connectionId: raw.connectionId,
    workspaceId: raw.workspaceId,
    workspaceTitle: raw.workspaceTitle,
    agentId: raw.agentId,
    agentName: raw.agentName,
    visitedAt: raw.visitedAt,
  };
}

/** The stored list: whole entries only, one per key, at most `RECENT_AGENTS_LIMIT`. */
export function parseRecentAgents(value: unknown): RecentAgentEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: RecentAgentEntry[] = [];
  for (const item of value) {
    const entry = parseRecentAgentEntry(item);
    if (!entry || seen.has(recentAgentKey(entry))) continue;
    seen.add(recentAgentKey(entry));
    entries.push(entry);
    if (entries.length === RECENT_AGENTS_LIMIT) break;
  }
  return entries;
}
