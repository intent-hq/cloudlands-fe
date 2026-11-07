import type { PairLinkErrorCode } from '$shared/types/pair-link';

/** Why adding from a link failed. Never carries the link or its token. */
export interface NodeAddError {
  code: PairLinkErrorCode | 'expired' | 'backend-unsupported' | 'labs-off';
  /** Routes tried, for `unreachable`. */
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
