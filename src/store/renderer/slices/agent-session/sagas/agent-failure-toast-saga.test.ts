import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { agents: { retry: mocks.retry } } }));
vi.mock('svelte-sonner', () => ({
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('$lib/components/ui/toast/AgentFailureToast.svelte', () => ({
  default: 'AgentFailureToast',
}));

import {
  clearAgentFailureRegistry,
  listAgentFailureGroups,
  recordAgentFailure,
} from '$features/agent/agent-failure-registry';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { agentFailureToastSaga } from './agent-failure-toast-saga';

const settle = async () => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function state() {
  const first = {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Implementor',
    status: AgentStatus.Error,
    messages: [],
  } as AgentSession;
  const second = { ...first, id: 'agent-2', workspaceId: 'ws-2', name: 'Verifier' };
  const firstWorkspace = { id: 'ws-1', title: 'Fix login' } as Workspace;
  const secondWorkspace = { id: 'ws-2', title: 'Dark mode' } as Workspace;
  return {
    agentSessions: { byAgentId: { 'agent-1': first, 'agent-2': second } },
    workspace: {
      workspaces: {
        ids: ['ws-1', 'ws-2'],
        map: { 'ws-1': firstWorkspace, 'ws-2': secondWorkspace },
      },
    },
  };
}

function lastToast(id: string) {
  return mocks.custom.mock.calls.filter(([, options]) => options.id === id).at(-1)?.[1];
}

describe('agentFailureToastSaga', () => {
  beforeEach(() => clearAgentFailureRegistry());
  afterEach(() => {
    clearAgentFailureRegistry();
    vi.clearAllMocks();
  });

  it('renders and updates one stable toast per normalized failure group', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    await settle();
    const groupKey = listAgentFailureGroups()[0].groupKey;
    const id = `agent-failure:${groupKey}`;
    expect(lastToast(id)?.componentProps).toEqual(
      expect.objectContaining({
        title: 'Implementor failed',
        retryLabel: 'Retry Implementor',
        detailLines: [{ key: 'agent-1', label: 'Implementor — Fix login' }],
      }),
    );

    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'spawn failed: EPERM' });
    await settle();
    expect(lastToast(id)?.componentProps).toEqual(
      expect.objectContaining({ title: '2 agents failed', retryLabel: 'Retry All 2 Agents' }),
    );
    expect(mocks.custom.mock.calls.every(([, options]) => options.id === id)).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('retries the whole group concurrently, removes only successes, and reports survivors', async () => {
    mocks.retry.mockImplementation(async (agentId: string) => ({ ok: agentId === 'agent-1' }));
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
    await settle();
    const groupKey = listAgentFailureGroups()[0].groupKey;
    const id = `agent-failure:${groupKey}`;
    lastToast(id).componentProps.onRetry();
    await settle();

    expect(mocks.retry.mock.calls).toEqual([
      ['agent-1', 'ws-1'],
      ['agent-2', 'ws-2'],
    ]);
    expect(listAgentFailureGroups()[0].entries.map((entry) => entry.agentId)).toEqual(['agent-2']);
    expect(lastToast(id).componentProps).toEqual(
      expect.objectContaining({ retrying: false, retryNote: 'Retry failed for 1 agent' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes and dismisses owned toasts on cancellation', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();
    const id = `agent-failure:${listAgentFailureGroups()[0].groupKey}`;
    const callsBeforeCancel = mocks.custom.mock.calls.length;
    task.cancel();
    await task.toPromise();
    expect(mocks.dismiss).toHaveBeenCalledWith(id);

    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'different' });
    await settle();
    expect(mocks.custom).toHaveBeenCalledTimes(callsBeforeCancel);
  });
});
