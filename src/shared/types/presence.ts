/**
 * Workspace presence wire types (multiplayer w5, PROTOCOL §5.46,
 * intent-hq/intentd#1887): `presence.update`, `presence.snapshot` and the
 * transient `presence:changed` event. Ephemeral who-is-here state of a shared
 * workspace — nothing here is persisted and a daemon restart forgets it all.
 *
 * The per-note viewer channel (`note.presence.*` / `note:presence`) is a
 * separate surface and deliberately NOT declared in this file.
 *
 * Safe to import from any process.
 */

/**
 * One item of a connection's focus set: what the client is looking at in a
 * workspace. `agentId` / `noteId` are present only when set (never `null` on
 * the roster); a bare `{ workspaceId }` marks the workspace itself as open.
 */
export interface PresenceFocusItem {
  workspaceId: string;
  agentId?: string;
  noteId?: string;
}

/**
 * One typing connection of a member. `source` is that connection's opaque
 * typing handle (`ts-…`, the `typingSource` its own `presence.update` returns);
 * two clients of one person stay two entries. Freshness is `(source, pulse)`:
 * `pulse` advances on every `presence.update` naming a typing agent, so a
 * receiver restarts its expiry timer on a pair it has not seen — wall clocks
 * (`since`, the RFC-3339 episode start) are never compared.
 */
export interface PresenceTypingEntry {
  source: string;
  agentId: string;
  since: string;
  pulse: number;
}

/**
 * One ONLINE member of the workspace as `presence:changed` / `presence.snapshot`
 * report it. Profile fields are always present and `null` when the principal
 * has no value; `focus` holds the member's focus items in this workspace only,
 * deduplicated across all of the principal's connections.
 */
export interface PresenceMember {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  focus: PresenceFocusItem[];
  typing: PresenceTypingEntry[];
}

/**
 * `presence.update` params — replaces the CONNECTION's whole focus set and
 * typing target (last write wins). `focus` is required and may be empty; an
 * omitted or `null` `typing` clears the typing target.
 */
export interface PresenceUpdateParams {
  focus: PresenceFocusItem[];
  typing?: { agentId: string } | null;
}

/** `presence.update` result: the connection's own opaque typing handle. */
export interface PresenceUpdateResult {
  ok: true;
  typingSource: string;
}

/** `presence.snapshot` result and the `presence:changed` event `data`. */
export interface PresenceRoster {
  workspaceId: string;
  members: PresenceMember[];
}

/**
 * `presence:report` IPC params — ONE window's contribution to its backend's
 * `presence.update`. The daemon connection is pooled per backend in main and
 * the update replaces the connection's whole state, so main merges every
 * window of that backend (focus union, last non-null typing target) into one
 * call. A hidden window reports an empty focus set and no typing.
 */
export type PresenceReportParams = PresenceUpdateParams;

/**
 * `presence:report` IPC result: the pooled connection's `typingSource` once
 * the merged `presence.update` the report joined has landed; `null` when the
 * daemon has no presence (older daemon, `-32601`) or the send failed.
 */
export interface PresenceReportResult {
  typingSource: string | null;
}

/** JSON-RPC code an older daemon answers `presence.*` with (method not found). */
export const PRESENCE_UNSUPPORTED_RPC_CODE = -32601;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFocusItem(value: unknown): value is PresenceFocusItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.workspaceId === 'string' &&
    (item.agentId === undefined || typeof item.agentId === 'string') &&
    (item.noteId === undefined || typeof item.noteId === 'string')
  );
}

function isTypingEntry(value: unknown): value is PresenceTypingEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.source === 'string' &&
    typeof entry.agentId === 'string' &&
    typeof entry.since === 'string' &&
    typeof entry.pulse === 'number'
  );
}

function isPresenceMember(value: unknown): value is PresenceMember {
  if (!value || typeof value !== 'object') return false;
  const member = value as Record<string, unknown>;
  return (
    typeof member.principalId === 'string' &&
    isNullableString(member.login) &&
    isNullableString(member.displayName) &&
    isNullableString(member.avatarUrl) &&
    Array.isArray(member.focus) &&
    member.focus.every(isFocusItem) &&
    Array.isArray(member.typing) &&
    member.typing.every(isTypingEntry)
  );
}

/** Structural guard for a `presence:changed` payload / `presence.snapshot` result. */
export function isPresenceRoster(value: unknown): value is PresenceRoster {
  if (!value || typeof value !== 'object') return false;
  const roster = value as Record<string, unknown>;
  return (
    typeof roster.workspaceId === 'string' &&
    Array.isArray(roster.members) &&
    roster.members.every(isPresenceMember)
  );
}
