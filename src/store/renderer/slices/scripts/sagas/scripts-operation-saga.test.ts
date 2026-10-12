import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  remove: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { scripts: mocks } }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(
    async (method: string, params: { workspaceId: string; scriptId: string }) => {
      expect(method).toBe('script.remove');
      const result = await mocks.remove(params.workspaceId, params.scriptId);
      if (!result.success) throw new Error(result.error);
      return { ok: true };
    },
  ),
}));

vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: mocks }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));

import { notify } from '$lib/components/patterns/notify';

import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  scriptsReducer,
  setScriptsData,
  deleteScriptRequested,
  removeScript,
  clearScriptOperations,
  refreshScripts,
  restartScriptRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  startScriptRequested,
  stopScriptRequested,
} from '../scripts-slice';
import { scriptsOperationSaga } from './scripts-operation-saga';

import { store as appStore } from '../../../store';

beforeEach(() => {
  appStore.dispose();
  appStore.init();
});
afterEach(() => appStore.dispose());

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
  const state = withLegacyPrincipal({
    scripts: scriptsReducer(undefined, { type: '@@init' }),
    workspace: {
      workspaces: createCollection('id', [
        { id: WS, myRole: 'owner' },
        { id: 'ws-2', myRole: 'owner' },
      ]),
    },
  });
  const dispatch = (action: { type: string }) => {
    state.scripts = scriptsReducer(state.scripts, action);
    actions.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    {
      channel,
      getState: () => state,
      dispatch,
    },
    scriptsOperationSaga,
  );
  return { actions, channel, task, state, dispatch };
}

async function stop(task: Task) {
  task.cancel();
  await task.toPromise();
}

describe('scriptsOperationSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ success: true });
    mocks.start.mockResolvedValue({ success: true });
    mocks.stop.mockResolvedValue({ success: true });
    mocks.restart.mockResolvedValue({ success: true });
  });

  function seed(run: ReturnType<typeof start>, status = 'idle') {
    run.dispatch(
      setScriptsData(WS, [
        {
          id: 'script-1',
          workspaceId: WS,
          name: 'Check',
          command: 'make check',
          mode: 'command',
          source: 'user',
          createdAt: '2026-10-09',
          runtime: { status, restartCount: 0 },
        } as never,
      ]),
    );
  }

  it('retires a denied delete and permits retry after admission returns', async () => {
    const run = start();
    seed(run);
    const admitted = run.state.principal;
    run.state.principal = { ...admitted, status: 'loading' };
    run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
    await settle();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(expect.any(String));
    expect(run.state.scripts.byWorkspaceId[WS].operations['script-1']?.pending).not.toBe(true);
    expect(run.actions).toContainEqual(
      expect.objectContaining({ type: scriptOperationFailed.type }),
    );
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']).toBeDefined();
    run.state.principal = admitted;
    run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
    await settle();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']).toBeUndefined();
    await stop(run.task);
  });

  it('removes only after success and serializes deletion with other lifecycle mutations', async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.remove.mockReturnValue(pending.promise);
    const run = start();
    seed(run);
    run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
    run.dispatch(startScriptRequested(WS, 'script-1'));
    run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
    expect(mocks.remove.mock.calls).toEqual([[WS, 'script-1']]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']).toBeDefined();
    pending.resolve({ success: true });
    await settle();
    expect(run.actions).toContainEqual(removeScript(WS, 'script-1'));
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']).toBeUndefined();
    await stop(run.task);
  });

  it.each(['running', 'starting', 'restarting', 'unknown'])(
    'refuses deletion for %s even when dispatched directly',
    async (status) => {
      const run = start();
      seed(run, status);
      run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
      await settle();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(run.state.scripts.byWorkspaceId[WS].operations['script-1']).toBeUndefined();
      await stop(run.task);
    },
  );

  it.each(['response', 'throw'])(
    'preserves the script and records a visible %s failure',
    async (kind) => {
      if (kind === 'response') mocks.remove.mockResolvedValue({ success: false, error: 'offline' });
      else mocks.remove.mockRejectedValue(new Error('offline'));
      const run = start();
      seed(run);
      run.dispatch(deleteScriptRequested(WS, 'script-1', 'Delete failed'));
      await settle();
      expect(run.actions).toContainEqual(
        scriptOperationFailed(WS, 'script-1', 'delete', 'offline'),
      );
      expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']).toBeDefined();
      expect(run.actions).not.toContainEqual(removeScript(WS, 'script-1'));
      await stop(run.task);
    },
  );

  it('runs start, stop, and restart without redundant list refreshes', async () => {
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
      scriptOperationSucceeded(WS, 'stop-me', 'stop'),
      scriptOperationSucceeded(WS, 'restart-me', 'restart'),
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

  it('withholds a remembered action and drops completion after admission changes', async () => {
    const pending = deferred<{ success: boolean }>();
    mocks.start.mockReturnValue(pending.promise);
    const run = start();
    run.channel.put(startScriptRequested(WS, 'old-action'));
    await settle();
    run.state.principal.status = 'loading';
    pending.resolve({ success: true });
    await settle();
    run.channel.put(stopScriptRequested(WS, 'old-action'));
    await settle();
    expect(run.actions).toEqual([]);
    expect(mocks.stop).not.toHaveBeenCalled();
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
