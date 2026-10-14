import { store as appStore } from '../../store/renderer/store';
import { appClient } from '$lib/client';
import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { claimAgentReadOwnership } from './agent-read-ownership';
import { readAgentSession } from './agent-read-service';
import { beginSubmissionRead } from './submission-evidence';
import { createChatReadService } from './chat-read-service-factory';
// Source facade binding until renderer cutover. Preserve call-time transport lookup for test replacement.
export const { loadChatTranscript } = createChatReadService({
  appStore,
  agents: { getConversation: (...args) => appClient.agents.getConversation(...args) },
  claimAgentReadOwnership,
  onBackendReconnected: (...args) => onBackendReconnected(...args),
  readAgentSession: (...args) => readAgentSession(...args),
  beginSubmissionRead,
});
