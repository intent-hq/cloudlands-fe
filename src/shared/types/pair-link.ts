/**
 * Add a machine or node from an `intent://pair` link (Settings → Machines →
 * Add machine → Paste an intent:// link, and links opened from outside the
 * app). Main tests the link and keeps its credential in a short-lived pending
 * slot; the renderer only ever sees the pending id, never the token.
 */

import type { ConnectionRecord } from './connections';

/** A full daemon goes to Machines; a node goes to Nodes. */
export type PairLinkKind = 'machine' | 'node';

export type PairLinkErrorCode =
  /** The text is not an `intent://pair` link. */
  | 'not-a-link'
  /** The link lacks a host (or tunnel), port, fingerprint or token. */
  | 'incomplete'
  /** No route answered. */
  | 'unreachable'
  /** The daemon refused the token (wrong or rotated). */
  | 'rejected'
  /** The daemon presented a different certificate than the link's fingerprint. */
  | 'certificate'
  /** The token is an invitation (member or guest), not the owner's. */
  | 'not-owner'
  /** The daemon is too old to identify the credential. */
  | 'incompatible'
  | 'failed';

export interface PairLinkInspected {
  ok: true;
  /** Main-only pending credential; commit or discard it. */
  pendingId: string;
  kind: PairLinkKind;
  /** Display name for the new row and the prompt. */
  label: string;
  /** The saved connection this link matches, if any. */
  existingId: string | null;
}

interface PairLinkFailure {
  ok: false;
  code: PairLinkErrorCode;
  /** Routes tried (`host:port`, tunnel address), for `unreachable`. Never the token. */
  routes?: string[];
  /** Localized detail for `incompatible`. */
  message?: string;
}

export type PairLinkInspectResult = PairLinkInspected | PairLinkFailure;

export type PairLinkCommitResult =
  { ok: true; connection: ConnectionRecord } | { ok: false; code: 'expired' | 'failed' };
