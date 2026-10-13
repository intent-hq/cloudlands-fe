import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (s: { authority: string }) => s.authority },
}));
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  workspaceReducer,
  replaceWorkspaceList,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  agentSessionReducer,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { normalizeWorkspace } from '$lib/client/live/live-workspaces-client';
import { RendererEventRecovery } from './renderer-event-recovery';
import {
  installWorkspaceListRecovery,
  WORKSPACE_LIST_RECOVERY_KEY,
} from './workspace-list-recovery';
import type { StoreState } from '$store/renderer/types';
async function settle() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('workspace catalog recovery', () => {
  it('recovers a final removal through canonical workspace and agent reducers with one list and two fences', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let receive!: (n: RecoveryNotification) => void;
    const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
      if (method === 'events.subscribe') return { subscriptionId: 'global', lossRecovery: 1 };
      if (method === 'events.fence') return params;
      if (method === 'workspace.list') return [{ id: 'kept-space', title: 'Current' }];
      throw new Error(method);
    });
    let state = {
      authority: 'a',
      connections: { windowBackendId: 'local' },
      workspace: workspaceReducer(
        undefined,
        replaceWorkspaceList(
          ['gone-space', 'kept-space'].map((id) => normalizeWorkspace({ id })),
          { complete: true, deletionTokens: {} },
        ),
      ),
      agentSessions: agentSessionReducer(
        undefined,
        upsertSession({ id: 'agent', workspaceId: 'gone-space', messages: [] } as never),
      ),
    };
    const registry = new RendererEventRecovery();
    const scope = registry.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        request: async (method, params, observe) => {
          const result = await request(method, params);
          observe?.(result);
          return result;
        },
        onNotification: (fn) => {
          receive = fn;
          return () => {};
        },
        onRetired: () => () => {},
        dispose: () => {},
      }),
    );
    const stop = installWorkspaceListRecovery(scope, {
      getState: () => state as unknown as StoreState,
      dispatch: (action) => {
        state = {
          ...state,
          workspace: workspaceReducer(state.workspace, action),
          agentSessions: agentSessionReducer(state.agentSessions, action),
        };
      },
    });
    await scope.subscribe({ eventTypes: ['*'] }, { recover: true });
    const old = registry.capture(WORKSPACE_LIST_RECOVERY_KEY);
    receive({
      method: 'events.lost',
      params: { subscriptionId: 'foreign', generation: '1', scope: { workspaceId: null } },
    });
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    receive({
      method: 'events.lost',
      params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
    });
    await settle();
    expect(state.workspace.workspaces.ids).toEqual(['kept-space']);
    expect(state.workspace.workspaces.map['kept-space'].title).toBe('Current');
    expect(state.agentSessions.byAgentId.agent).toBeUndefined();
    expect(request.mock.calls.filter(([m]) => m === 'workspace.list')).toHaveLength(1);
    expect(request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
    expect(
      old.commit(() => {
        throw new Error('obsolete list');
      }),
    ).toBe(false);
    stop();
    registry.dispose();
  });
});
