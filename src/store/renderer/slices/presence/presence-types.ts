/**
 * Workspace presence state (multiplayer w5, PROTOCOL §5.46).
 *
 * Everything here is transient: the daemon's `presence:changed` rosters for
 * the workspaces this window can see, the receiver-local typing bookkeeping
 * (3 s expiry per `(source, pulse)` pair) and this window's own contribution
 * (typing target, visibility, connection identity) — plus the accepted
 * membership (`workspace.members.list`) of the shared workspaces on display,
 * which is what turns an online-only roster into the brief's member circles
 * (offline members dimmed, the owner blue).
 */
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { PresenceMember } from '$shared/types/presence';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';

/** A workspace's online members keyed by principal, in roster order. */
type PresenceMemberCollection = Collection<PresenceMember, 'principalId'>;

/** A shared workspace's accepted members keyed by principal, in `workspace.members.list` order. */
type WorkspaceMemberCollection = Collection<WorkspaceMember, 'principalId'>;

/** Receiver-local expiry of typing (PROTOCOL §5.46): 3 s after the last unseen pulse. */
export const PRESENCE_TYPING_EXPIRY_MS = 3000;

/**
 * One typing connection as this receiver tracks it. `expired` flips when the
 * 3 s timer runs out without a NEW `(source, pulse)` pair; a roster that
 * re-projects the same pair (re-emitted for an unrelated reason) must not
 * revive it, so the flag survives until the pulse actually advances.
 */
export interface LiveTypingEntry {
  principalId: string;
  agentId: string;
  pulse: number;
  expired: boolean;
}

export interface PresenceState {
  /** Latest roster per workspace id — a full replacement each time. */
  rosters: Record<string, PresenceMemberCollection>;
  /** Accepted membership per shared workspace on display — a full replacement each time. */
  members: Record<string, WorkspaceMemberCollection>;
  /** Typing bookkeeping per workspace id, keyed by the connection's `source`. */
  liveTyping: Record<string, Record<string, LiveTypingEntry>>;
  /** `principal.me` of the window's backend; `null` until read or when unknown. */
  ownPrincipalId: string | null;
  /** The connection's own `typingSource`, so its typing rows are never shown to itself. */
  ownTypingSource: string | null;
  /** The agent this window is typing to right now. */
  ownTyping: { agentId: string } | null;
  /** `document.visibilityState === 'visible'`; a hidden window reports nothing. */
  windowVisible: boolean;
}

/** The identity part of a roster or membership row — what a name or a typing line needs. */
export interface PresenceIdentity {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * One circle of a presence stack or one row of the members list: an identity
 * plus the facts the brief colours by — the owner's ring is blue, an online
 * member's green, an offline member's grey with the avatar dimmed.
 */
export interface PresencePerson extends PresenceIdentity {
  /** The workspace's owner (`workspace.members.list` role / `ownerPrincipalId`). */
  owner: boolean;
  /** In the workspace's roster: at least one hello'd connection to the daemon. */
  online: boolean;
  /** Online with a focus item in the workspace (the tab, an agent or a note of it). */
  viewing: boolean;
  /** This window's own principal. */
  self: boolean;
}

/**
 * Where a person is looking right now inside one workspace, resolved from
 * their roster focus items: the agent chat they have open, else the note.
 * A person on the bare workspace tab (or offline) has no target.
 */
export type PresenceFocusTarget =
  { kind: 'agent'; agentId: string } | { kind: 'note'; noteId: string };
