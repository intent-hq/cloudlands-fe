import type { NodeInviteInspectErrorCode } from '$shared/types/node-invite';
import type { PairLinkErrorCode } from '$shared/types/pair-link';

/** Why an `intent://node` claim failed (the backend's reason, or a refusal). */
export type NodeInviteAddErrorCode =
  | NodeInviteInspectErrorCode
  | 'invite-invalid'
  | 'invite-expired'
  | 'invite-used'
  | 'invite-revoked'
  | 'machine-unreachable'
  | 'machine-update-required'
  /** The backend can't claim node links (no capability, or `-32601`). */
  | 'invites-unsupported'
  /** The window's connection is not the backend's owner. */
  | 'invite-not-owner';

/** Why adding from a link failed. Never carries the link, its token or invite secret. */
export interface NodeAddError {
  code: PairLinkErrorCode | NodeInviteAddErrorCode | 'expired' | 'backend-unsupported' | 'labs-off';
  /** Routes tried, for `unreachable` and `machine-unreachable`. */
  routes?: string[];
  /** Localized detail for `incompatible`. */
  message?: string;
  /** The node's name, for the refusal messages. */
  node?: string;
}

type PastePhase = 'closed' | 'field' | 'testing';

export interface NodesState {
  /** Settings → Machines → Add machine → Paste an intent:// link. */
  paste: {
    phase: PastePhase;
    /** The link being tested, token masked. */
    masked: string | null;
    error: NodeAddError | null;
  };
  /** Row briefly highlighted after it was added. */
  highlightId: string | null;
}
