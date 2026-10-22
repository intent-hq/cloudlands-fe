import { store } from '../../store';
import { emptyScriptMonitors } from './script-monitor-slice';
export const selectScriptMonitors = store.createSelector(
  (state, workspaceId: string) =>
    state.scriptMonitor?.byWorkspaceId[workspaceId] ?? emptyScriptMonitors,
);
export const selectAgentScriptMonitors = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const ws = selectScriptMonitors.select(state, workspaceId);
    return ws.status === 'unsupported' ? [] : ws.monitors.filter((row) => row.agentId === agentId);
  },
);
