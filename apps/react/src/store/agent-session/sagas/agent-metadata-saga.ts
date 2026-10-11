import { createAgentMetadataSaga } from '../../../../../../src/store/renderer/slices/agent-session/sagas/agent-metadata-saga-factory';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { agentClient } from '@/features/agent/agent-client';
import { agentReadService, agentReadOwnership } from '@/features/agent/agent-read-service';
/** Start before consumers with store.runSaga; cancel before Store disposal. */
export const agentMetadataSaga = createAgentMetadataSaga({
  contextSelector: selectPrincipalActionContext,
  client: agentClient,
  reads: agentReadService,
  ownership: agentReadOwnership,
});
