import type { AgentMessage } from '$shared/types';
import type { ContentBlock } from '$shared/types/content-block';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import {
  getSecretRequestFromResourceBlock,
  isSecretRequestResourceBlock,
  type AgentSecretListing,
  type SecretRequest,
} from '$shared/types/secret-request-resource';
import { getSecretRequestNotice } from './secret-request-notice';

/** A request carried by an assistant card that no notice row answers. */
interface TranscriptSecretRequest extends SecretRequest {
  /** A real user message came after the card (the user has moved on). */
  supersededByUser: boolean;
}

/** What the loaded transcript says about secret requests (PROTOCOL §5.56). */
export interface SecretRequestTranscript {
  /** Unanswered requests, de-duplicated by id, latest card last. */
  open: TranscriptSecretRequest[];
  /** Request ids that a provided/declined notice row answered. */
  answered: ReadonlySet<string>;
}

const EMPTY_TRANSCRIPT: SecretRequestTranscript = { open: [], answered: new Set() };

function hasSecretRequestBlock(blocks: readonly ContentBlock[] | undefined): boolean {
  return !!blocks && blocks.some(isSecretRequestResourceBlock);
}

function isRealUserMessage(message: AgentMessage): boolean {
  if (message.role !== 'user') return false;
  const source = (message.metadata as { source?: unknown } | null | undefined)?.source;
  return source !== 'system';
}

/**
 * Read secret-request cards and notices from the loaded transcript. A repeat
 * request re-shows its card with the same `requestId`, so requests are
 * de-duplicated by id, keeping the latest card. Messages without a
 * secret-request block are skipped cheaply; this runs on every transcript change.
 */
export function deriveSecretRequestTranscript(
  messages: readonly AgentMessage[],
): SecretRequestTranscript {
  const answered = new Set<string>();
  const open = new Map<string, { request: SecretRequest; index: number }>();
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') {
      const notice = getSecretRequestNotice(message);
      if (notice) answered.add(notice.requestId);
      else if (isRealUserMessage(message)) lastUserIndex = index;
      return;
    }
    if (!hasSecretRequestBlock(message.contentBlocks)) return;
    for (const block of dedupeResourceBlocks(message.contentBlocks ?? [])) {
      const request = getSecretRequestFromResourceBlock(block);
      if (!request) continue;
      open.delete(request.requestId);
      open.set(request.requestId, { request, index });
    }
  });
  if (open.size === 0 && answered.size === 0) return EMPTY_TRANSCRIPT;
  return {
    open: [...open.values()]
      .filter(({ request }) => !answered.has(request.requestId))
      .map(({ request, index }) => ({ ...request, supersededByUser: lastUserIndex > index })),
    answered,
  };
}

/** What a card shows for one request. */
export type SecretRequestCardState = 'checking' | 'pending' | 'provided' | 'declined' | 'expired';

/**
 * The card state (§5.56 order): an answered entry wins, then pending. A
 * request missing from a listing that covered it is expired (lost, for
 * example on a daemon restart). A request the listing could predate is still
 * `checking`. When refreshes fail, the card stays answerable: `secret.provide`
 * itself reports a lost request.
 */
export function secretRequestCardState(
  requestId: string,
  entry: AgentSecretListing | null | undefined,
): SecretRequestCardState {
  const listing = entry?.listing;
  if (listing) {
    const answered = listing.answeredRequests.find((item) => item.requestId === requestId);
    if (answered) return answered.outcome;
    if (listing.pendingRequests.some((item) => item.requestId === requestId)) return 'pending';
    if (entry.covered.includes(requestId)) return 'expired';
  }
  return entry?.failed ? 'pending' : 'checking';
}

export interface VisibleSecretRequest {
  request: SecretRequest;
  state: SecretRequestCardState;
}

/**
 * The cards to show. Transcript cards show unless the user hid them, or they
 * expired after the user moved on (an expired request gets no notice, so it
 * would otherwise stay forever). Requests the listing reports as pending but
 * whose card is outside the loaded transcript page also get a card (with no
 * reason), so the user can always answer what keeps the workspace waiting.
 */
export function visibleSecretRequests(
  transcript: SecretRequestTranscript,
  agentId: string,
  entry: AgentSecretListing | null | undefined,
  hidden: Readonly<Record<string, true>>,
): VisibleSecretRequest[] {
  const visible: VisibleSecretRequest[] = [];
  const shown = new Set<string>();
  for (const request of transcript.open) {
    shown.add(request.requestId);
    if (hidden[request.requestId]) continue;
    const state = secretRequestCardState(request.requestId, entry);
    if (state === 'expired' && request.supersededByUser) continue;
    const { requestId, agentId: owner, name, reason } = request;
    visible.push({ request: { requestId, agentId: owner, name, reason }, state });
  }
  for (const pending of entry?.listing?.pendingRequests ?? []) {
    if (shown.has(pending.requestId) || transcript.answered.has(pending.requestId)) continue;
    visible.push({
      request: { requestId: pending.requestId, agentId, name: pending.name, reason: '' },
      state: 'pending',
    });
  }
  return visible;
}
