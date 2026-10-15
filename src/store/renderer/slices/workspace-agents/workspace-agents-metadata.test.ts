import { describe, expect, it } from 'vitest';
import {
  initialState,
  workspaceAgentsReducer,
  workspaceAgentMetadataStatusChanged,
} from './workspace-agents-slice';
import { getWorkspaceAgentMetadataStatus } from './workspace-agents-projections';

describe('workspace agent metadata status', () => {
  it('preserves no-op identity and scopes serializable status without changing cached membership', () => {
    expect(
      workspaceAgentsReducer(initialState, workspaceAgentMetadataStatusChanged('ws', null)),
    ).toBe(initialState);
    const loading = workspaceAgentsReducer(
      initialState,
      workspaceAgentMetadataStatusChanged('ws', {
        context: 'context-a',
        status: 'loading',
      }),
    );
    expect(
      workspaceAgentsReducer(
        loading,
        workspaceAgentMetadataStatusChanged('ws', {
          context: 'context-a',
          status: 'loading',
        }),
      ),
    ).toBe(loading);
    const failed = workspaceAgentsReducer(
      loading,
      workspaceAgentMetadataStatusChanged('ws', {
        context: 'context-a',
        status: 'error',
        error: 'offline',
      }),
    );
    expect(
      workspaceAgentsReducer(
        failed,
        workspaceAgentMetadataStatusChanged('ws', {
          context: 'context-a',
          status: 'error',
          error: 'offline',
        }),
      ),
    ).toBe(failed);
    const ready = workspaceAgentsReducer(
      failed,
      workspaceAgentMetadataStatusChanged('ws', {
        context: 'context-b',
        status: 'ready',
      }),
    );
    expect(JSON.parse(JSON.stringify(ready))).toEqual(ready);
    expect(ready.byWorkspaceId.ws.agentIds).toBe(loading.byWorkspaceId.ws.agentIds);
    expect(
      getWorkspaceAgentMetadataStatus({ workspaceAgents: ready }, 'ws', 'context-a'),
    ).toBeNull();
    expect(getWorkspaceAgentMetadataStatus({ workspaceAgents: ready }, 'ws', null)).toBeNull();
    expect(
      getWorkspaceAgentMetadataStatus({ workspaceAgents: ready }, 'other', 'context-b'),
    ).toBeNull();
    expect(getWorkspaceAgentMetadataStatus({ workspaceAgents: ready }, 'ws', 'context-b')).toEqual({
      context: 'context-b',
      status: 'ready',
    });
    const cleared = workspaceAgentsReducer(ready, workspaceAgentMetadataStatusChanged('ws', null));
    expect(
      getWorkspaceAgentMetadataStatus({ workspaceAgents: cleared }, 'ws', 'context-b'),
    ).toBeNull();
    expect(workspaceAgentsReducer(cleared, workspaceAgentMetadataStatusChanged('ws', null))).toBe(
      cleared,
    );
  });
});
