import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  navigateToRoute: vi.fn(async () => {}),
  resolveKeySlot: vi.fn((workspaceId: string | undefined) => (workspaceId === 'ws-1' ? 3 : null)),
}));
vi.mock('$lib/client', () => ({ appClient: { agents: { retry: mocks.retry } } }));
vi.mock('svelte-sonner', () => ({
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('$lib/components/ui/toast/AgentFailureToast.svelte', () => ({
  default: 'AgentFailureToast',
}));
vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: mocks.navigateToRoute,
}));
vi.mock('$features/hardware-console/assignment/connected-key-slot', () => ({
  resolveConnectedWorkspaceKeySlot: mocks.resolveKeySlot,
}));

import {
  clearAgentFailureRegistry,
  getAgentFailureEntry,
  recordAgentFailure,
} from '$features/agent/agent-failure-registry';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { openPanel, setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
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
  const chief = { ...first, id: 'agent-chief', workspaceId: CHIEF_WORKSPACE_ID, name: 'Chief' };
  const firstWorkspace = { id: 'ws-1', title: 'Fix login' } as Workspace;
  const secondWorkspace = { id: 'ws-2', title: 'Dark mode' } as Workspace;
  return {
    agentSessions: {
      byAgentId: { 'agent-1': first, 'agent-2': second, 'agent-chief': chief },
    },
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

  it('renders one stable per-agent toast with per-agent props — no grouping', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'spawn failed: EPERM' });
    await settle();

    const first = lastToast('agent-failure:agent-1');
    expect(first?.componentProps).toEqual(
      expect.objectContaining({
        title: 'Implementor failed',
        errorSummary: 'spawn failed: EPERM',
        contextLine: 'Implementor — Fix login',
        retryLabel: 'Retry Implementor',
        retrying: false,
        keySlot: 3,
        onRetry: expect.any(Function),
        onSwitchTo: expect.any(Function),
        onClose: expect.any(Function),
      }),
    );
    expect(first?.componentProps).not.toHaveProperty('detailLines');
    // Same error text still renders a SECOND toast — one per agent.
    expect(lastToast('agent-failure:agent-2')?.componentProps).toEqual(
      expect.objectContaining({
        title: 'Verifier failed',
        contextLine: 'Verifier — Dark mode',
        retryLabel: 'Retry Verifier',
        keySlot: null,
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('Switch To navigates to the workspace and opens the agent tab WITHOUT retrying', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onSwitchTo();
    await settle();

    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatch).toHaveBeenCalledWith(openAgentTabRequested('ws-1', { agentId: 'agent-1' }));
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(getAgentFailureEntry('agent-1')).toBeDefined();
    task.cancel();
    await task.toPromise();
  });

  it('Switch To on a chief-of-staff failure opens the sidebar Assistant panel', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({
      agentId: 'agent-chief',
      workspaceId: CHIEF_WORKSPACE_ID,
      error: 'boom',
    });
    await settle();

    lastToast('agent-failure:agent-chief').componentProps.onSwitchTo();
    await settle();

    expect(dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('agent-chief'));
    expect(dispatch).toHaveBeenCalledWith(openPanel('chief'));
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('Retry retries the one agent, navigates, and removes the entry on ok:true', async () => {
    mocks.retry.mockResolvedValue({ ok: true });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();

    expect(mocks.retry.mock.calls).toEqual([['agent-1', 'ws-1']]);
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatch).toHaveBeenCalledWith(openAgentTabRequested('ws-1', { agentId: 'agent-1' }));
    expect(getAgentFailureEntry('agent-1')).toBeUndefined();
    expect(getAgentFailureEntry('agent-2')).toBeDefined();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    task.cancel();
    await task.toPromise();
  });

  it('Retry ok:false keeps the entry, still navigates, and shows the failure note', async () => {
    mocks.retry.mockResolvedValue({ ok: false });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();

    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(getAgentFailureEntry('agent-1')).toBeDefined();
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ retrying: false, retryNote: 'Retry failed' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('stale ok:true does not erase a re-failure that landed during the retry', async () => {
    let resolveRetry!: (value: { ok: boolean }) => void;
    mocks.retry.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => (resolveRetry = resolve)),
    );
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'new boom', at: 2000 });
    resolveRetry({ ok: true });
    await settle();

    expect(getAgentFailureEntry('agent-1')?.error).toBe('new boom');
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'new boom', retrying: false }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('manual close hides the toast until a NEWER failure lands for that agent', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onClose();
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    expect(getAgentFailureEntry('agent-1')).toBeDefined();

    const callsAfterClose = mocks.custom.mock.calls.length;
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();
    expect(mocks.custom).toHaveBeenCalledTimes(callsAfterClose);

    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom again', at: 2000 });
    await settle();
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'boom again' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes and dismisses owned toasts on cancellation', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();
    const callsBeforeCancel = mocks.custom.mock.calls.length;
    task.cancel();
    await task.toPromise();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');

    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'different' });
    await settle();
    expect(mocks.custom).toHaveBeenCalledTimes(callsBeforeCancel);
  });
});
