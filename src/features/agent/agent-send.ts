import { loadChatTranscript } from './chat-read-service';

import { captureAgentMutationOwnership } from '$features/agent/agent-read-ownership';
import { backendRequest } from '$lib/client/live/backend-transport';
import { errorBoundary } from './browser';
import { getAgentQueueEventSnapshotSeq, hydrateAgentQueue } from './agent-queue-read-service';
import { store as appStore } from '$store/renderer/store';
import { createAgentSender } from './agent-send-factory';
// Source Store/transport binding until renderer cutover; retains existing public send API.
export const sendMessage = createAgentSender({
  appStore,
  backendRequest: (...args) => backendRequest(...args),
  captureAgentMutationOwnership,
  loadChatTranscript: (...args) => loadChatTranscript(...args),
  hydrateAgentQueue: (...args) => hydrateAgentQueue(...args),
  getAgentQueueEventSnapshotSeq,
  errorBoundary,
});
