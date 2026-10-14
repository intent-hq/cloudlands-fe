import { admitAgentSubmission } from '../../store/renderer/slices/pending-submissions/pending-submissions-admission';
import { createChatSubmission } from './chat-submission-factory';
// Source Store admission binding until renderer cutover.
export const { admitChatMessage, submitChatMessage } = createChatSubmission(admitAgentSubmission);
