/**
 * Workspace presence state (multiplayer w5, PROTOCOL §5.46).
 *
 * Everything here is transient: the daemon's `presence:changed` rosters for
 * the workspaces this window can see, the receiver-local typing bookkeeping
 * (3 s expiry per `(source, pulse)` pair) and this window's own contribution
 * (typing target, visibility, connection identity).
 */
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { PresenceMember } from '$shared/types/presence';

/** A workspace's online members keyed by principal, in roster order. */
type PresenceMemberCollection = Collection<PresenceMember, 'principalId'>;

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

/** The identity part of a roster member — what an avatar or a name row needs. */
export interface PresencePerson {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}
