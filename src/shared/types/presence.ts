import type { HostRole } from './principal';
import type { PrincipalIdentity } from '$features/workspace-sharing/types';
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
  /** Additive, server-authoritative effective role and qualified identity. */
  hostRole?: HostRole;
  identity?: PrincipalIdentity;
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

/** Within one trusted effective snapshot, a retained guest row cannot override host membership. */
export function effectivePresenceRows<T extends { principalId: string; hostRole?: HostRole }>(
  rows: readonly T[],
): T[] {
  const people = new Map<string, T>();
  const rank = (role: HostRole | undefined) =>
    role === 'owner' ? 3 : role === 'member' ? 2 : role === 'guest' ? 1 : 0;
  for (const row of rows) {
    const previous = people.get(row.principalId);
    if (!previous || rank(row.hostRole) > rank(previous.hostRole)) people.set(row.principalId, row);
  }
  return [...people.values()];
}

/** Validate the additive identity seam without deriving authority from profile text. */
export function isPresenceIdentity(
  value: unknown,
): value is Pick<
  PresenceMember,
  'principalId' | 'login' | 'displayName' | 'avatarUrl' | 'hostRole' | 'identity'
> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.principalId !== 'string' ||
    !row.principalId.trim() ||
    !isNullableString(row.login) ||
    !isNullableString(row.displayName) ||
    !isNullableString(row.avatarUrl)
  )
    return false;
  if (
    row.hostRole !== undefined &&
    row.hostRole !== 'owner' &&
    row.hostRole !== 'member' &&
    row.hostRole !== 'guest'
  )
    return false;
  if (row.identity === undefined) return true;
  if (!row.identity || typeof row.identity !== 'object' || Array.isArray(row.identity))
    return false;
  const identity = row.identity as Record<string, unknown>;
  return (
    (identity.provider === 'github' || identity.provider === 'gitlab') &&
    typeof identity.host === 'string' &&
    identity.host.trim().length > 0 &&
    typeof identity.externalUserId === 'string' &&
    identity.externalUserId.trim().length > 0
  );
}

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
    isPresenceIdentity(value) &&
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
