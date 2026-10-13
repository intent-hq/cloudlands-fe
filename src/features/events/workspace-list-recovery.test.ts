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
  bulkUpsertSessions,
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
  it.each([
    {
      label: 'canonical envelope',
      response: { workspaces: [{ id: 'kept-space', title: 'Current' }] },
      expected: ['kept-space'],
      valid: true,
    },
    {
      label: 'authoritative empty envelope',
      response: { workspaces: [] },
      expected: [],
      valid: true,
    },
    {
      label: 'invalid envelope',
      response: { workspaces: null },
      expected: ['gone-space', 'kept-space'],
      valid: false,
    },
    {
      label: 'invalid row',
      response: { workspaces: [{ title: 'Missing identity' }] },
      expected: ['gone-space', 'kept-space'],
      valid: false,
    },
    {
      label: 'noncanonical bare array',
      response: [{ id: 'kept-space' }],
      expected: ['gone-space', 'kept-space'],
      valid: false,
    },
  ])(
    'handles $label after final loss without stale deletion or extra reads',
    async ({ response, expected, valid }) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let receive!: (n: RecoveryNotification) => void;
      const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
        if (method === 'events.subscribe') return { subscriptionId: 'global', lossRecovery: 1 };
        if (method === 'events.fence') return params;
        if (method === 'workspace.list') return response;
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
          bulkUpsertSessions([{ id: 'agent', workspaceId: 'gone-space', messages: [] } as never]),
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
      const listeners = new Set<() => void>();
      const stop = installWorkspaceListRecovery(scope, {
        subscribe: (fn) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        getState: () => state as unknown as StoreState,
        dispatch: (action) => {
          state = {
            ...state,
            workspace: workspaceReducer(state.workspace, action),
            agentSessions: agentSessionReducer(state.agentSessions, action),
          };
          for (const fn of listeners) fn();
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
      expect(state.workspace.workspaces.ids).toEqual(expected);
      if (valid && expected.length)
        expect(state.workspace.workspaces.map['kept-space'].title).toBe('Current');
      if (valid) expect(state.agentSessions.byAgentId.agent).toBeUndefined();
      else expect(state.agentSessions.byAgentId.agent?.workspaceId).toBe('gone-space');
      expect(request.mock.calls.filter(([m]) => m === 'workspace.list')).toHaveLength(1);
      expect(request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(valid ? 2 : 1);
      expect(
        old.commit(() => {
          throw new Error('obsolete list');
        }),
      ).toBe(false);
      stop();
      registry.dispose();
    },
  );
});

describe('workspace point read denial scope', () => {
  it.each(
    [-32003, -32001, -32602].flatMap((code) =>
      ['immediate', 'late', 'push', 'replaced'].map((change) => ({ code, change })),
    ),
  )('keeps sibling workspace on $change failure $code', async ({ code, change }) => {
    const { rendererEventRecovery } = await import('./renderer-event-recovery');
    const { runWorkspaceProjectionRead } = await import('./workspace-list-recovery');
    const { workspaceDeleted } =
      await import('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice');
    rendererEventRecovery.dispose();
    let state = {
      authority: 'a',
      connections: { windowBackendId: 'local' },
      workspace: workspaceReducer(
        undefined,
        replaceWorkspaceList(
          ['one-space', 'two-space'].map((id) => normalizeWorkspace({ id, title: id })),
          { complete: true, deletionTokens: {} },
        ),
      ),
      agentSessions: agentSessionReducer.initialState,
    };
    const listeners = new Set<() => void>();
    const dispatch = (action: { type: string }) => {
      state = {
        ...state,
        workspace: workspaceReducer(state.workspace, action),
        agentSessions: agentSessionReducer(state.agentSessions, action),
      };
      for (const fn of listeners) fn();
    };
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onNotification: () => () => {},
        onRetired: () => () => {},
        dispose: () => {},
        request: async () => ({}),
      }),
    );
    const stop = installWorkspaceListRecovery(scope, {
      getState: () => state as unknown as StoreState,
      dispatch,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    });
    const denial = Object.assign(new Error('denied'), {
      rpcCode: code,
      data: { code: 'not-found' },
    });
    let finish!: (outcome: { errors: unknown[]; retired: boolean }) => void;
    const completion = new Promise<{ errors: unknown[]; retired: boolean }>((resolve) => {
      finish = resolve;
    });
    const error =
      change === 'immediate' ? denial : Object.assign(new Error('timeout'), { completion });
    try {
      const result = runWorkspaceProjectionRead(
        rendererEventRecovery.capture(WORKSPACE_LIST_RECOVERY_KEY),
        'one-space',
        () => Promise.reject(error),
      );
      await expect(result).rejects.toBe(error);
      if (change === 'push') rendererEventRecovery.push(WORKSPACE_LIST_RECOVERY_KEY);
      if (change === 'replaced') {
        dispatch(workspaceDeleted('one-space', [], 'unshared'));
        dispatch(
          replaceWorkspaceList(
            ['one-space', 'two-space'].map((id) =>
              normalizeWorkspace({ id, title: 'replacement' }),
            ),
            { complete: true, deletionTokens: {} },
          ),
        );
      }
      const next = vi.fn(async () => undefined);
      const { runRecoveryRead } = await import('$lib/client/live/recovery-read-queue');
      const pending = runRecoveryRead(
        WORKSPACE_LIST_RECOVERY_KEY,
        rendererEventRecovery.capture(WORKSPACE_LIST_RECOVERY_KEY),
        'recovery',
        'list',
        next,
      );
      if (change !== 'immediate') {
        await settle();
        expect(next).not.toHaveBeenCalled();
        finish({ errors: [denial], retired: false });
      }
      await pending;
      expect(state.workspace.workspaces.ids).toEqual(
        change === 'replaced' ? ['one-space', 'two-space'] : ['two-space'],
      );
      expect(rendererEventRecovery.captureAuthority(WORKSPACE_LIST_RECOVERY_KEY).isCurrent()).toBe(
        true,
      );
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      finish?.({ errors: [], retired: true });
      stop();
      rendererEventRecovery.dispose();
    }
  });
});
