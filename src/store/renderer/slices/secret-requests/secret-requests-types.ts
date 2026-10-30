import type { AgentSecretListing } from '$shared/types/secret-request-resource';

/** Where a card's answer stands, locally (PROTOCOL §5.56). */
export type SecretAnswerStatus = 'sending' | 'provided' | 'declined' | 'expired' | 'failed';

/**
 * Names-only secret-request state. Secret values never enter the store: the
 * card hands a value to the provide saga through `secret-value-handoff`.
 */
export interface SecretRequestsState {
  /** Latest `secret.list` per agent id. */
  listings: Record<string, AgentSecretListing>;
  /** Local answer status per request id. */
  answers: Record<string, SecretAnswerStatus>;
  /** Expired cards the user hid, per request id (this session only). */
  hidden: Record<string, true>;
}
