import { store } from '@/store';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';

/** Call after the root starts agentMetadataSaga; release when the consumer unmounts. */
export function acquireAgentMetadata(workspaceId: string, agentId?: string): () => void {
  const consumerId = crypto.randomUUID();
  store.dispatch(agentMetadataAcquired(consumerId, workspaceId, agentId));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.dispatch(agentMetadataReleased(consumerId));
  };
}
