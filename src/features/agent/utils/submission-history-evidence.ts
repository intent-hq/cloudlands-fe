import type { AgentMessage } from '$shared/types';
import type { SubmissionEvidence } from '../../../store/renderer/slices/pending-submissions/pending-submissions-types';

export function submissionHistoryEvidence(messages: AgentMessage[]): SubmissionEvidence[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id,
      author: message.author,
      submissionIds: message.metadata?.submissionIds,
      recoverySources: message.metadata?.recoverySources,
    }));
}
