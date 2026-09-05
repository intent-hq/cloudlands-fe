import { describe, expect, it, vi } from 'vitest';

import { createInitialControllerState, type ControllerState } from '../controller';
import { createDraftTransactionRunner, createWorkspaceAdoption } from '.';

describe('draft transaction integration seams', () => {
  it('owns controller transitions, subscriptions, and cancellation', () => {
    let effectDispatch:
      ((event: { type: 'backend.connected'; generation: number }) => void) | null = null;
    const cancel = vi.fn();
    const executeEffect = vi.fn((_state, dependencies, settled) => {
      effectDispatch = dependencies.dispatch;
      queueMicrotask(settled);
      return cancel;
    });
    const observed: ControllerState[] = [];
    const runner = createDraftTransactionRunner({ executeEffect });
    runner.subscribe((state) => observed.push(state));

    runner.start(createInitialControllerState(7));
    effectDispatch?.({ type: 'backend.connected', generation: 7 });

    expect(observed.map(({ phase }) => phase)).toEqual(['boot', 'pristine']);
    expect(executeEffect).toHaveBeenCalledTimes(1);
    runner.stop();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('hands the complete adoption action set to one synchronous batch', async () => {
    const dispatch = vi.fn();
    const navigate = vi.fn();
    const adopt = createWorkspaceAdoption({ dispatch, navigate });

    await adopt({
      workspace: {
        id: 'amber-forest',
        title: 'Untitled',
        status: 'active',
        contextLinks: [],
        createdAt: '2026-09-04T20:00:00.000Z',
        updatedAt: '2026-09-04T20:00:00.000Z',
      },
      initialAgent: {
        id: 'agent-1',
        workspaceId: 'amber-forest',
        name: 'Coordinator',
        status: 'idle',
      },
      operationKey: 'operation-1',
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ type: 'renderer/batchActions' });
    expect(
      (dispatch.mock.calls[0]?.[0].payload as Array<{ type: string }>).map((action) => action.type),
    ).toEqual([
      'workspace/setWorkspaceEntity',
      'workspaceAgents/setInitialAgentId',
      'agentSessions/bulkUpsertSessions',
      'panelLayout/bootstrapNewWorkspaceLayout',
      'workspaceNavigation/hydrateWorkspaceNavigation',
      'tabState/openWorkspaceTab',
      'workspaceCreateProgress/clear',
    ]);
    expect(navigate).toHaveBeenCalledWith('/workspace/amber-forest');
  });
});
