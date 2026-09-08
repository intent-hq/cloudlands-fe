import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  on: vi.fn(),
  offById: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()),
  callbacks: {} as Record<string, (data?: any) => void>,
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
vi.mock('svelte-sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { setLastGitError, setLastGitOperation } from '../../git/git-slice';
import {
  openGitCredentialsModal,
  openGitHubAuthModal,
} from '../../global-modals/global-modals-slice';
import { loadWorkspaceTabsState, openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { gitEventsIpcSaga } from './git-events-ipc-saga';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};
const state = () => ({
  tabState: { currentTabId: 'ws-1' as string | null },
  workspace: {
    workspaces: {
      map: { 'ws-1': { id: 'ws-1', title: 'Alpha' }, 'ws-2': { id: 'ws-2', title: 'Beta' } },
    },
  },
  globalModals: { gitCredentials: { shownForWorkspaceIds: {} as Record<string, boolean> } },
});

function startSaga(dispatch: ReturnType<typeof vi.fn>, current = state()) {
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const reduxStore = {
    getState: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    gitEventsIpcSaga,
  );
  const setWorkspaceId = (workspaceId: string | null) => {
    current.tabState.currentTabId = workspaceId;
    channel.put(
      workspaceId
        ? openWorkspaceTab(workspaceId)
        : loadWorkspaceTabsState({
            openTabs: [],
            currentTabId: null,
            pinnedTabs: [],
            unsavedTabs: [],
            optimisticTabs: [],
            tabOrder: [],
          }),
    );
    listeners.forEach((listener) => listener());
  };
  return { channel, setWorkspaceId, task };
}

describe('gitEventsIpcSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isElectron.mockReturnValue(true);
    mocks.callbacks = {};
    mocks.on.mockImplementation((channel, callback) => {
      mocks.callbacks[channel] = callback;
      return `id:${channel}`;
    });
    Object.assign(window, { electronAPI: { on: mocks.on, offById: mocks.offById } });
    window.history.replaceState({}, '', '/workspace/ws-1');
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    delete (window as any).electronAPI;
  });

  it('dispatches exact operation events before success/failure toasts', async () => {
    const dispatch = vi.fn();
    const current = state();
    const { task } = startSaga(dispatch, current);
    await settle();
    const completed = {
      operationId: 'op-1',
      workspaceId: 'ws-2',
      operationType: 'create-pr',
      result: { prNumber: 42 },
      metadata: { prTitle: 'Ship' },
      wire_only: 'preserve',
    };
    const failed = {
      operationId: 'op-2',
      workspaceId: 'ws-2',
      operationType: 'push',
      error: 'boom',
      metadata: { source: 'manual' },
      wire_only: 'preserve',
    };
    mocks.callbacks['git:op-completed'](completed);
    mocks.callbacks['git:op-failed'](failed);
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLastGitOperation(completed as any),
      setLastGitError(failed as any),
    ]);
    const successOptions = mocks.success.mock.calls[0][1];
    expect(mocks.success.mock.calls[0]).toEqual([
      '✅ PR #42 created in "Beta"',
      {
        description: 'Ship',
        duration: 5_000,
        action: { label: 'Open', onClick: successOptions.action.onClick },
      },
    ]);
    const errorOptions = mocks.error.mock.calls[0][1];
    expect(mocks.error.mock.calls[0]).toEqual([
      '❌ Push failed in "Beta"',
      {
        description: 'boom',
        duration: 10_000,
        action: { label: 'Open', onClick: errorOptions.action.onClick },
      },
    ]);
    await successOptions.action.onClick();
    await errorOptions.action.onClick();
    expect(mocks.navigate.mock.calls).toEqual([['/workspace/ws-2'], ['/workspace/ws-2']]);
    task.cancel();
    await task.toPromise();
  });

  it('preserves suppression rules and remains alive when toast rendering fails', async () => {
    mocks.success.mockImplementationOnce(() => {
      throw new Error('toast unavailable');
    });
    const dispatch = vi.fn();
    const current = state();
    const { task } = startSaga(dispatch, current);
    await settle();
    mocks.callbacks['git:op-completed']({
      operationId: 'a',
      workspaceId: 'ws-1',
      operationType: 'commit',
      result: { noChanges: true },
    });
    mocks.callbacks['git:op-completed']({
      operationId: 'b',
      workspaceId: 'ws-1',
      operationType: 'push',
    });
    mocks.callbacks['git:op-failed']({
      operationId: 'c',
      workspaceId: 'ws-1',
      operationType: 'push',
      error: 'failed',
    });
    mocks.callbacks['git:op-failed']({
      operationId: 'd',
      workspaceId: 'ws-1',
      operationType: 'auto-commit',
      error: 'pre-commit hook failed',
    });
    await settle();
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls).toEqual([]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('captures typed active-workspace context before a later selection action', async () => {
    const dispatch = vi.fn();
    const current = state();
    const { setWorkspaceId, task } = startSaga(dispatch, current);
    await settle();
    mocks.callbacks['git:op-completed']({
      operationId: 'op-race',
      workspaceId: 'ws-1',
      operationType: 'push',
    });
    setWorkspaceId('ws-2');
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLastGitOperation({
        operationId: 'op-race',
        workspaceId: 'ws-1',
        operationType: 'push',
      } as any),
    ]);
    expect(mocks.success.mock.calls[0][1]).toEqual({ duration: 5_000 });
    task.cancel();
    await task.toPromise();
  });

  it('opens exact auth modals, dedupes git auth, and ignores missing payloads', async () => {
    const dispatch = vi.fn();
    const current = state();
    current.globalModals.gitCredentials.shownForWorkspaceIds['ws-seen'] = true;
    const { task } = startSaga(dispatch, current);
    mocks.callbacks['git:auth-required']({
      workspaceId: 'ws-2',
      message: 'auth',
      operation: 'push',
      command: 'git push',
      cwd: '/repo',
      rawError: 'fatal',
      remote: 'origin',
      wire_only: 'drop',
    });
    mocks.callbacks['git:auth-required']({
      workspaceId: 'ws-seen',
      message: 'again',
      operation: 'push',
    });
    mocks.callbacks['github:auth-required']({
      workspaceId: 'ws-2',
      operation: 'create-pr',
      message: 'github',
      wire_only: 'preserve',
    });
    for (const callback of Object.values(mocks.callbacks)) callback(undefined);
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      openGitCredentialsModal({
        workspaceId: 'ws-2',
        message: 'auth',
        operation: 'push',
        command: 'git push',
        cwd: '/repo',
        rawError: 'fatal',
      }),
      openGitHubAuthModal({
        workspaceId: 'ws-2',
        operation: 'create-pr',
        message: 'github',
        wire_only: 'preserve',
      } as any),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cleans up every channel and is a no-op outside Electron', async () => {
    const { task } = startSaga(vi.fn());
    expect(mocks.on.mock.calls.map(([channel]) => channel)).toEqual([
      'git:op-completed',
      'git:op-failed',
      'git:auth-required',
      'github:auth-required',
    ]);
    task.cancel();
    await task.toPromise();
    expect(mocks.offById.mock.calls).toEqual([
      ['git:op-completed', 'id:git:op-completed'],
      ['git:op-failed', 'id:git:op-failed'],
      ['git:auth-required', 'id:git:auth-required'],
      ['github:auth-required', 'id:github:auth-required'],
    ]);
    vi.clearAllMocks();
    mocks.isElectron.mockReturnValue(false);
    await runSaga({ dispatch: vi.fn(), getState: state }, gitEventsIpcSaga).toPromise();
    expect(mocks.on.mock.calls).toEqual([]);
  });
});
