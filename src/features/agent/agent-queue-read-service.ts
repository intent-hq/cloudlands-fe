import { store as appStore } from '../../store/renderer/store';
import { appClient } from '$lib/client';
import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { claimAgentReadOwnership } from './agent-read-ownership';
import { beginSubmissionRead } from './submission-evidence';
import { createAgentQueueReadService } from './agent-queue-read-service-factory';
// Source facade resolves on use for test/runtime transport replacement until renderer cutover.
export const {
  noteAgentQueueEventSnapshotApplied,
  getAgentQueueEventSnapshotSeq,
  hydrateAgentQueue,
  __resetAgentQueueReadServiceForTests,
} = createAgentQueueReadService({
  appStore,
  agents: { getQueue: (...args) => appClient.agents.getQueue(...args) },
  claimAgentReadOwnership,
  onBackendReconnected: (...args) => onBackendReconnected(...args),
  beginSubmissionRead,
});
