import type { AgentSecretListing } from '$shared/types/secret-request-resource';

/** Where a card's answer stands, locally (PROTOCOL §5.56). */
export type SecretAnswerStatus = 'sending' | 'provided' | 'declined' | 'expired' | 'failed';

/**
 * A local answer and the answer epoch it completed at. A `secret.list`
 * started after that epoch is authoritative and replaces a finished outcome,
 * so a daemon restart that loses the request shows it as expired.
 */
interface SecretAnswer {
  status: SecretAnswerStatus;
  epoch: number;
}

/**
 * Names-only secret-request state. Secret values never enter the store: the
 * card hands a value to the provide saga through `secret-value-handoff`.
 */
export interface SecretRequestsState {
  /** Changes whenever caller-relative presentation is retired, including an ABA re-admission. */
  admissionRevision?: number;
  /** Latest `secret.list` per agent id. */
  listings: Record<string, AgentSecretListing>;
  /** Local answer per request id, until a later listing replaces it. */
  answers: Record<string, SecretAnswer>;
  /** Expired cards the user hid, per request id (this session only). */
  hidden: Record<string, true>;
  /**
   * Per agent: the card keys showing when the user hid the card stack. The
   * stack stays collapsed until a card outside this set appears.
   */
  collapsed: Record<string, string[]>;
}
