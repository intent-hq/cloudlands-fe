import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { ScriptMonitorSnapshot } from '$features/script-monitor/script-monitor-service';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';

export interface MonitorOperation {
  pending: boolean;
  message?: string;
  error?: boolean;
}
export interface ScriptMonitorWorkspace extends ScriptMonitorSnapshot {
  operations: Record<string, MonitorOperation>;
}
export interface ScriptMonitorState {
  byWorkspaceId: Record<string, ScriptMonitorWorkspace>;
}
export const emptyScriptMonitors: ScriptMonitorWorkspace = {
  monitors: [],
  scripts: [],
  status: 'loading',
  operations: {},
};
export const scriptMonitorsSubscribeRequested =
  createAction<[workspaceId: string]>('scriptMonitor/subscribe');
export const scriptMonitorsUnsubscribeRequested = createAction<[workspaceId: string]>(
  'scriptMonitor/unsubscribe',
);
export const scriptMonitorsUpdated =
  createAction<[workspaceId: string, snapshot: ScriptMonitorSnapshot]>('scriptMonitor/updated');
export const scriptMonitorActionRequested =
  createAction<
    [workspaceId: string, monitorId: string, action: 'cancel' | 'cancelRun' | 'pane' | 'bottom']
  >('scriptMonitor/action');
export const scriptMonitorOperationUpdated =
  createAction<[workspaceId: string, monitorId: string, operation: MonitorOperation]>(
    'scriptMonitor/operation',
  );
export const scriptMonitorReducer = createReducer<ScriptMonitorState>({ byWorkspaceId: {} });
scriptMonitorReducer.with(scriptMonitorsUpdated, (state, { payload: [workspaceId, snapshot] }) => ({
  ...state,
  byWorkspaceId: {
    ...state.byWorkspaceId,
    [workspaceId]: {
      ...snapshot,
      operations:
        snapshot.status === 'loading' || snapshot.status === 'unsupported'
          ? {}
          : (state.byWorkspaceId[workspaceId]?.operations ?? {}),
    },
  },
}));
scriptMonitorReducer.with(
  scriptMonitorOperationUpdated,
  (state, { payload: [workspaceId, monitorId, operation] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws) return state;
    return {
      ...state,
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: { ...ws, operations: { ...ws.operations, [monitorId]: operation } },
      },
    };
  },
);
scriptMonitorReducer.with(removeWorkspaceEntity, (state, { payload: [workspaceId] }) => {
  const { [workspaceId]: _removed, ...byWorkspaceId } = state.byWorkspaceId;
  return { ...state, byWorkspaceId };
});
