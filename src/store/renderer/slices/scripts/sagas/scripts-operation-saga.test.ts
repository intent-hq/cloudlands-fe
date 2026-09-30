import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  supportsLifecycle: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { scripts: mocks } }));

vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: mocks }));

import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  scriptArchiveRequested,
  scriptArchiveFinished,
  refreshScripts,
  restartScriptRequested,
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

function start() {
  const channel = stdChannel();
  const actions: any[] = [];
  const state = withLegacyPrincipal({
    workspace: {
      workspaces: createCollection('id', [
        { id: WS, myRole: 'owner' },
        { id: 'ws-2', myRole: 'owner' },
      ]),
    },
  });
  const task = runSaga(
    {
      channel,
      getState: () => state,
      dispatch: (action) => (actions.push(action), channel.put(action), action),
    },
    scriptsOperationSaga,
  );
  return { actions, channel, task, state };
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

describe('script archive operations', () => {
  it('reconciles partial success and persistence errors without claiming rollback', async () => {
    mocks.supportsLifecycle.mockResolvedValue(true);
    mocks.archive.mockResolvedValue({
      archived: ['one'],
      skipped: [{ scriptId: 'two', reason: 'live' }],
    });
    const run = start();
    run.channel.put(scriptArchiveRequested(WS, ['one', 'two'], 'archive'));
    await settle();
    await settle();
    expect(mocks.archive).toHaveBeenCalledWith(WS, ['one', 'two'], { capabilityVerified: true });
    expect(run.actions).toContainEqual(scriptArchiveFinished(WS, { changed: 1, skipped: 1 }));
    expect(run.actions).toContainEqual(refreshScripts(WS, true));
    run.actions.length = 0;
    mocks.archive.mockRejectedValue(new Error('durable write failed'));
    run.channel.put(scriptArchiveRequested(WS, ['one', 'two'], 'archive'));
    await settle();
    await settle();
    expect(run.actions).toContainEqual(
      scriptArchiveFinished(WS, { error: 'durable write failed' }),
    );
    expect(run.actions).toContainEqual(refreshScripts(WS, true));
    await stop(run.task);
  });
  it('restores without launch and drops late mutation results on workspace cleanup', async () => {
    mocks.supportsLifecycle.mockResolvedValue(true);
    mocks.start.mockClear();
    mocks.restore.mockResolvedValue({ restored: ['one'], skipped: [] });
    const run = start();
    run.channel.put(scriptArchiveRequested(WS, ['one'], 'restore'));
    await settle();
    await settle();
    expect(run.actions).toContainEqual(scriptArchiveFinished(WS, { changed: 1, skipped: 0 }));
    expect(mocks.start).not.toHaveBeenCalled();
    const pending = deferred<{ archived: string[]; skipped: [] }>();
    mocks.archive.mockReturnValue(pending.promise);
    run.channel.put(scriptArchiveRequested(WS, ['one'], 'archive'));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    run.actions.length = 0;
    pending.resolve({ archived: ['one'], skipped: [] });
    await settle();
    await settle();
    expect(run.actions.filter((a) => a.type === scriptArchiveFinished.type)).toEqual([]);
    await stop(run.task);
  });
  it('does not send archive mutations without daemon capability', async () => {
    mocks.supportsLifecycle.mockResolvedValue(false);
    mocks.archive.mockClear();
    const run = start();
    run.channel.put(scriptArchiveRequested(WS, ['one'], 'archive'));
    await settle();
    await settle();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(
      run.actions.some((a) => a.type === scriptArchiveFinished.type && a.payload[1].error),
    ).toBe(true);
    await stop(run.task);
  });
  it('does not mutate after unmount during a pending capability read', async () => {
    const capability = deferred<boolean>();
    mocks.supportsLifecycle.mockReturnValue(capability.promise);
    mocks.archive.mockClear();
    const run = start();
    run.channel.put(scriptArchiveRequested(WS, ['one'], 'archive'));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    capability.resolve(true);
    await settle();
    await settle();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(run.actions.some((a) => a.type === refreshScripts.type)).toBe(false);
    await stop(run.task);
  });
});

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
import { backendRequest as lifecycleRequest } from '$lib/client/live/backend-transport';
import { LiveScriptsClient } from '$lib/client/live/live-scripts-client';

describe('live script mutation admission', () => {
  beforeEach(() => {
    const client = new LiveScriptsClient();
    mocks.supportsLifecycle.mockImplementation(client.supportsLifecycle.bind(client));
    mocks.archive.mockImplementation(client.archive.bind(client));
    mocks.restore.mockImplementation(client.restore.bind(client));
    vi.mocked(lifecycleRequest).mockReset();
  });
  it.each(['archive', 'restore'] as const)(
    'negotiates once before dispatching %s',
    async (operation) => {
      vi.mocked(lifecycleRequest).mockImplementation(async (method) => {
        if (method === 'client.hello')
          return { server: { capabilities: { scriptLifecycle: 1 } } } as never;
        return { archived: ['one'], restored: ['one'], skipped: [] } as never;
      });
      const run = start();
      try {
        run.channel.put(scriptArchiveRequested(WS, ['one'], operation));
        await vi.waitFor(() =>
          expect(lifecycleRequest).toHaveBeenCalledWith('script.' + operation, {
            workspaceId: WS,
            scriptIds: ['one'],
          }),
        );
        expect(
          vi.mocked(lifecycleRequest).mock.calls.filter(([method]) => method === 'client.hello'),
        ).toHaveLength(1);
      } finally {
        await stop(run.task);
      }
    },
  );
  it.each(['archive', 'restore'] as const)(
    'does not dispatch %s after cleanup or changed authority during negotiation',
    async (operation) => {
      for (const change of ['cleanup', 'authority', 'connection'] as const) {
        const hello = deferred<unknown>();
        vi.mocked(lifecycleRequest)
          .mockReset()
          .mockImplementation(async (method) => {
            if (method === 'client.hello') return hello.promise as never;
            return { archived: ['one'], restored: ['one'], skipped: [] } as never;
          });
        const run = start();
        try {
          run.channel.put(scriptArchiveRequested(WS, ['one'], operation));
          await vi.waitFor(() => expect(lifecycleRequest).toHaveBeenCalledWith('client.hello', {}));
          if (change === 'cleanup') run.channel.put(workspaceUnmounted(WS));
          else if (change === 'authority') run.state.principal.status = 'loading';
          else run.state.connections.windowBackendId = 'changed-backend';
          hello.resolve({ server: { capabilities: { scriptLifecycle: 1 } } });
          for (let i = 0; i < 10; i++) await settle();
          expect(
            vi
              .mocked(lifecycleRequest)
              .mock.calls.filter(([method]) => method.startsWith('script.')),
          ).toEqual([]);
        } finally {
          await stop(run.task);
        }
      }
    },
  );
});
