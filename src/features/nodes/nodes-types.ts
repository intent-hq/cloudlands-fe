import type { NodeInviteInspectErrorCode } from '$shared/types/node-invite';
import type { PairLinkErrorCode } from '$shared/types/pair-link';

/** Why an `intent://node` claim failed (the backend's reason, or a refusal). */
type NodeInviteAddErrorCode =
  | NodeInviteInspectErrorCode
  | 'node-invite-invalid'
  | 'node-invite-expired'
  | 'node-invite-used'
  | 'node-invite-revoked'
  | 'node-invite-self'
  | 'machine-unreachable'
  | 'machine-update-required'
  /** Every route failed the link's certificate pin. */
  | 'certificate-mismatch'
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
  /** A node link's claim may have used the invite: only a new link helps. */
  inviteSpent?: boolean;
  /** The node's name, for the refusal messages. */
  node?: string;
}

type PastePhase = 'closed' | 'field' | 'testing';

/** Where the paste field shows: under the Machines list, or in the Set up a new machine wizard. */
export type PasteSurface = 'inline' | 'wizard';

export interface NodesState {
  /** Settings → Machines → Add machine → Paste an intent:// link. */
  paste: {
    phase: PastePhase;
    /** The link being tested, token masked. */
    masked: string | null;
    error: NodeAddError | null;
    surface: PasteSurface;
  };
  /** Row briefly highlighted after it was added. */
  highlightId: string | null;
}
