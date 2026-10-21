import { store } from '../../store';
import { agentWorkersKey, emptyAgentWorkers } from './agent-workers-slice';

export const selectAgentWorkers = store.createSelector(
  (state, workspaceId: string, agentId: string) =>
    state.agentWorkers?.byKey[agentWorkersKey(workspaceId, agentId)] ?? emptyAgentWorkers,
);
/** The workers a chat lists: still running, or running when the connection was lost. */
export const selectAgentWorkerRows = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const entry = selectAgentWorkers.select(state, workspaceId, agentId);
    if (entry.status === 'unsupported') return [];
    return (entry.snapshot?.workers ?? []).filter(
      (row) => row.status === 'running' || row.status === 'unknown',
    );
  },
);
/** §5.5b: a failed, truncated or unavailable view cannot claim an exhaustive count. An
 * agent with no session (or an unsupported provider) that lists nothing claims nothing. */
export const selectAgentWorkersIncomplete = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const entry = selectAgentWorkers.select(state, workspaceId, agentId);
    if (entry.status === 'failed') return true;
    if (entry.status !== 'ready' || !entry.snapshot) return false;
    if (entry.snapshot.truncated) return true;
    return (
      entry.snapshot.support.status !== 'supported' &&
      selectAgentWorkerRows.select(state, workspaceId, agentId).length > 0
    );
  },
);
