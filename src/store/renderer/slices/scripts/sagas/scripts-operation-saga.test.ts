import { runSaga, stdChannel, type Task } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
}));

vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: mocks }));

import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  refreshScripts,
  restartScriptRequested,
  restoreScriptsRequested,
  scriptCommandFailed,
  scriptOperationFailed,
  scriptOperationSucceeded,
  startScriptRequested,
  stopScriptRequested,
} from '../scripts-slice';
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

function start(state: any = {}) {
  const channel = stdChannel();
  const actions: any[] = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action) => (actions.push(action), channel.put(action), action),
      getState: () => state,
    },
    scriptsOperationSaga,
  );
  return { actions, channel, task };
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
    mocks.remove.mockResolvedValue({ success: true });
    mocks.create.mockResolvedValue({ success: true });
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

  it('stops restore after a failed remove and reports failure without creating scripts', async () => {
    mocks.remove.mockResolvedValueOnce({ success: false, error: 'remove rejected' });
    const run = start({
      scripts: {
        byWorkspaceId: {
          [WS]: {
            scripts: {
              first: {
                id: 'first',
                name: 'First',
                command: 'pnpm first',
                mode: 'command',
                runtime: { status: 'idle' },
              },
              second: {
                id: 'second',
                name: 'Second',
                command: 'pnpm second',
                mode: 'command',
                runtime: { status: 'idle' },
              },
            },
          },
        },
      },
    });

    run.channel.put(
      restoreScriptsRequested(WS, [{ name: 'Replacement', command: 'pnpm new', mode: 'command' }]),
    );
    await settle();

    expect(mocks.remove.mock.calls).toEqual([[WS, 'first']]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(run.actions).toEqual([
      scriptCommandFailed(WS, 'restore', 'remove rejected'),
      refreshScripts(WS),
    ]);
    await stop(run.task);
  });

  it('stops restore after a failed create and refreshes the partially restored state', async () => {
    mocks.create
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'create rejected' });
    const run = start({
      scripts: {
        byWorkspaceId: {
          [WS]: {
            scripts: {
              existing: {
                id: 'existing',
                name: 'Existing',
                command: 'pnpm old',
                mode: 'command',
                runtime: { status: 'idle' },
              },
            },
          },
        },
      },
    });
    const replacements = [
      { name: 'First', command: 'pnpm first', mode: 'command' as const },
      { name: 'Second', command: 'pnpm second', mode: 'command' as const },
      { name: 'Third', command: 'pnpm third', mode: 'command' as const },
    ];

    run.channel.put(restoreScriptsRequested(WS, replacements));
    await settle();

    expect(mocks.remove.mock.calls).toEqual([[WS, 'existing']]);
    expect(mocks.create.mock.calls).toEqual([
      [WS, replacements[0]],
      [WS, replacements[1]],
    ]);
    expect(run.actions).toEqual([
      scriptCommandFailed(WS, 'restore', 'create rejected'),
      refreshScripts(WS),
    ]);
    await stop(run.task);
  });
});
