import { store } from '../../store/renderer/store';
import { createSubmissionEvidence } from './submission-evidence-factory';
// Source Store binding until renderer cutover; historical service API stays shared.
export { submissionHistoryEvidence } from './utils/submission-history-evidence';
export const {
  observeSubmissionEvidence,
  announceSubmissionDelivery,
  observeSubmissionLifecycle,
  beginSubmissionRead,
} = createSubmissionEvidence(store);
