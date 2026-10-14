import { captureAgentMutationOwnership } from '../../../../features/agent/agent-read-ownership';
import { createAgentSubmissionAdmitter } from './pending-submissions-admission-factory';
// Source Store binding retained until the Svelte renderer is retired; tests and product callers use this boundary.
export { admitPendingSubmission } from './pending-submissions-admission-factory';
export const admitAgentSubmission = createAgentSubmissionAdmitter(captureAgentMutationOwnership);
