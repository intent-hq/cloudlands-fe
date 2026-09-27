import { runSaga, stdChannel, type Task } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), restart: vi.fn() }));

vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: mocks }));

import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  refreshScripts,
  restartScriptRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  startScriptRequested,
  stopScriptRequested,
} from '../scripts-slice';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import {
  initialState as workspace,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import type { Workspace } from '$shared/types';
import { selectPrincipalAdmissionContext } from '../../principal/principal-selectors';
import { scriptsOperationSaga } from './scripts-operation-saga';

const WS = 'ws-1';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function start() {
  const channel = stdChannel();
  const actions: any[] = [];
  let state = withLegacyPrincipal({ workspace });
  const task = runSaga(
    {
      getState: () => state,
      channel,
      dispatch: (action) => (actions.push(action), channel.put(action), action),
    },
    scriptsOperationSaga,
  );
  return {
    actions,
    channel,
    task,
    setState: (next: typeof state) => {
      state = next;
    },
    state: () => state,
  };
}

async function stop(task: Task) {
  task.cancel();
  await task.toPromise();
}

describe('scriptsOperationSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ success: true });
    mocks.stop.mockResolvedValue({ success: true });
    mocks.restart.mockResolvedValue({ success: true });
  });

  it('runs start, stop, and restart then refreshes canonical state', async () => {
    const run = start();
    run.channel.put(startScriptRequested(WS, 'start-me'));
    await settle();
    run.channel.put(stopScriptRequested(WS, 'stop-me'));
    await settle();
    run.channel.put(restartScriptRequested(WS, 'restart-me'));
    await settle();

    expect(mocks.start).toHaveBeenCalledWith(WS, 'start-me');
    expect(mocks.stop).toHaveBeenCalledWith(WS, 'stop-me');
    expect(mocks.restart).toHaveBeenCalledWith(WS, 'restart-me');
    expect(run.actions).toEqual([
      scriptOperationSucceeded(WS, 'start-me', 'start'),
      refreshScripts(WS),
      scriptOperationSucceeded(WS, 'stop-me', 'stop'),
      refreshScripts(WS),
      scriptOperationSucceeded(WS, 'restart-me', 'restart'),
      refreshScripts(WS),
    ]);
    await stop(run.task);
  });

  it('stores daemon and thrown failures without refreshing', async () => {
    mocks.stop.mockResolvedValueOnce({ success: false, error: 'not running' });
    mocks.restart.mockRejectedValueOnce(new Error('offline'));
    const run = start();
    run.channel.put(stopScriptRequested(WS, 'a'));
    await settle();
    run.channel.put(restartScriptRequested(WS, 'b'));
    await settle();
    expect(run.actions).toEqual([
      scriptOperationFailed(WS, 'a', 'stop', 'not running'),
      scriptOperationFailed(WS, 'b', 'restart', 'offline'),
    ]);
    await stop(run.task);
  });

  it('suppresses duplicate operations per script while preserving workspace isolation', async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.start.mockImplementation(() => pending.promise);
    const run = start();
    run.channel.put(startScriptRequested(WS, 'same'));
    run.channel.put(restartScriptRequested(WS, 'same'));
    run.channel.put(startScriptRequested('ws-2', 'same'));
    await settle();
    expect(mocks.start.mock.calls).toEqual([
      [WS, 'same'],
      ['ws-2', 'same'],
    ]);
    expect(mocks.restart).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    await settle();
    await stop(run.task);
  });

  it.each([
    ['unmount', workspaceUnmounted(WS)],
    ['delete', workspaceDeleted(WS, [])],
  ])('cancels pending work and clears operations on workspace %s', async (_name, cleanup) => {
    const pending = deferred<{ success: boolean }>();
    mocks.start.mockReturnValue(pending.promise);
    const run = start();
    run.channel.put(startScriptRequested(WS, 'script-1'));
    await settle();
    run.channel.put(cleanup);
    await settle();
    expect(run.actions).toContainEqual(clearScriptOperations(WS));
    pending.resolve({ success: true });
    await settle();
    expect(run.actions.some(({ type }) => type === refreshScripts.type)).toBe(false);
    await stop(run.task);
  });
});

describe('script control authority changes', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    'keeps script transport admission separate from workspace management: %s',
    async (role) => {
      vi.clearAllMocks();
      mocks.start.mockResolvedValue({ success: true });
      mocks.stop.mockResolvedValue({ success: true });
      mocks.restart.mockResolvedValue({ success: true });
      const run = start();
      const state = run.state();
      state.principal.snapshot!.capabilities.hostMembership = true;
      state.principal.snapshot!.principal.hostRole = role;
      state.principal.snapshot!.principal.isAdministrator = role === 'owner';
      state.workspace = workspaceReducer(
        workspaceReducer(
          workspace,
          setWorkspaceEntity({ id: WS, myRole: 'owner', canManage: true } as Workspace),
        ),
        setWorkspaceHasLoaded(true, 'local', selectPrincipalAdmissionContext.select(state)),
      );
      try {
        for (const request of [startScriptRequested, stopScriptRequested, restartScriptRequested]) {
          run.channel.put(request(WS, 'script'));
          await settle();
        }
        for (const operation of Object.values(mocks)) {
          if (role === 'guest') expect(operation).not.toHaveBeenCalled();
          else expect(operation).toHaveBeenCalledWith(WS, 'script');
        }
        expect(run.actions.filter((action) => action.type === refreshScripts.type)).toHaveLength(
          role === 'guest' ? 0 : 3,
        );
      } finally {
        await stop(run.task);
      }
    },
  );

  it.each([startScriptRequested, stopScriptRequested, restartScriptRequested])(
    'refuses a stale operation after authority is unresolved',
    async (request) => {
      vi.clearAllMocks();
      const run = start();
      run.setState({ ...run.state(), principal: { ...run.state().principal, status: 'unknown' } });
      run.channel.put(request(WS, 'script'));
      await settle();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
      expect(mocks.restart).not.toHaveBeenCalled();
      await stop(run.task);
    },
  );

  it('ignores a previous host result without refreshing the current host scripts', async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.start.mockReturnValue(pending.promise);
    const run = start();
    run.channel.put(startScriptRequested(WS, 'script'));
    await settle();
    run.setState({
      ...run.state(),
      connections: { ...run.state().connections, windowBackendId: 'other-host' },
    });
    pending.resolve({ success: true });
    await settle();
    expect(run.actions).not.toContainEqual(refreshScripts(WS));
    expect(run.actions).not.toContainEqual(scriptOperationSucceeded(WS, 'script', 'start'));
    await stop(run.task);
  });
});
