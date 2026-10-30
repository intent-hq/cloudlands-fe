import type { AgentMessage } from '$shared/types';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import {
  getSecretRequestFromResourceBlock,
  type SecretListing,
  type SecretRequest,
} from '$shared/types/secret-request-resource';
import { getSecretRequestNotice } from './secret-request-notice';

/**
 * Secret requests (PROTOCOL §5.56) still waiting on a card: every request
 * carried by an assistant message that no later notice row answers. A repeat
 * request re-shows its card with the same `requestId`, so requests are
 * de-duplicated by id, keeping the latest card. Dependency-light on purpose.
 */
export function deriveOpenSecretRequests(messages: readonly AgentMessage[]): SecretRequest[] {
  const answered = new Set<string>();
  for (const message of messages) {
    const notice = getSecretRequestNotice(message);
    if (notice) answered.add(notice.requestId);
  }
  const open = new Map<string, SecretRequest>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of dedupeResourceBlocks(message.contentBlocks ?? [])) {
      const request = getSecretRequestFromResourceBlock(block);
      if (!request || answered.has(request.requestId)) continue;
      open.delete(request.requestId);
      open.set(request.requestId, request);
    }
  }
  return [...open.values()];
}

/** What a card shows for one request. */
export type SecretRequestCardState = 'checking' | 'pending' | 'provided' | 'declined' | 'expired';

/**
 * The card state from the daemon's names-only `secret.list` (§5.56 order):
 * an answered entry wins, then pending, otherwise the request was lost (for
 * example on a daemon restart). `null` listing means it is still loading.
 */
export function secretRequestCardState(
  requestId: string,
  listing: SecretListing | null,
): SecretRequestCardState {
  if (!listing) return 'checking';
  const answered = listing.answeredRequests.find((entry) => entry.requestId === requestId);
  if (answered) return answered.outcome;
  if (listing.pendingRequests.some((entry) => entry.requestId === requestId)) return 'pending';
  return 'expired';
}
