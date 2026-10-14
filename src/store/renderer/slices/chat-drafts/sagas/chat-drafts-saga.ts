import { appClient } from '$lib/client';
import type { DraftsClient } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { captureAgentMutationOwnership } from '$features/agent/agent-read-ownership';
import { createChatDraftOwnership } from '$features/agent/chat-draft-ownership';
import { runChatDrafts, type CaptureDraftOwnership } from './chat-drafts-worker';
export { CHAT_DRAFT_SAVE_DEBOUNCE_MS } from './chat-drafts-worker';
const captureOwnership = createChatDraftOwnership(store, captureAgentMutationOwnership);
// Source app startup binding until renderer cutover; optional transport is retained for existing isolated tests.
export function* chatDraftsSaga(
  drafts: Pick<DraftsClient, 'get' | 'set' | 'clear'> = appClient.drafts,
  ownership: CaptureDraftOwnership = captureOwnership,
) {
  yield* runChatDrafts(drafts, ownership);
}
