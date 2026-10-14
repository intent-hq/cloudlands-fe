import { store } from '../../store/renderer/store';
import { admitChatMessage, submitChatMessage } from './chat-submission';
import { hydrateAgentQueue } from './agent-queue-read-service';
import { loadChatTranscript } from './chat-read-service';
import { createSubmissionRetry } from './chat-submission-retry-factory';
// Source notification/Store binding until renderer cutover.
export const { prepareSubmissionRetry, requestChatMessageRetry } = createSubmissionRetry({
  store,
  admitChatMessage,
  submitChatMessage,
  hydrateAgentQueue: (...args) => hydrateAgentQueue(...args),
  loadChatTranscript: (...args) => loadChatTranscript(...args),
  getNotify: async () => (await import('$lib/components/patterns/notify')).notify,
});
