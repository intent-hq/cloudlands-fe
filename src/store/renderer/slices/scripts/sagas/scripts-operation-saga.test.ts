import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  detect: vi.fn(),
  start: vi.fn(),
  remove: vi.fn(),
  restoreSnapshot: vi.fn(),
  saveToRepo: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  update: vi.fn(),
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
  applyScriptDefinitionChangesRequested,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  scriptsReducer,
  setScriptsData,
  deleteScriptRequested,
  removeScript,
  clearScriptOperations,
  refreshScripts,
  restartScriptRequested,
  scriptSnapshotReceived,
  scriptOperationFailed,
  scriptOperationSucceeded,
  restoreScriptDefinitionsRequested,
  saveScriptDefinitionsToRepoRequested,
  startScriptRequested,
  stopScriptRequested,
  updateScriptDefinitionRequested,
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
    mocks.create.mockResolvedValue({ success: false, error: 'unexpected create' });
    mocks.detect.mockResolvedValue({ success: false, error: 'unexpected detect' });
    mocks.remove.mockResolvedValue({ success: true });
    mocks.restoreSnapshot.mockResolvedValue({ success: false, error: 'unexpected restore' });
    mocks.saveToRepo.mockResolvedValue({ success: false, error: 'unexpected save' });
    mocks.start.mockResolvedValue({ success: true });
    mocks.stop.mockResolvedValue({ success: true });
    mocks.restart.mockResolvedValue({ success: true });
    mocks.update.mockResolvedValue({ success: false, error: 'unexpected update' });
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

  it('creates and updates definitions through correlated saga requests', async () => {
    const created = {
      id: 'script-created',
      workspaceId: WS,
      name: 'Build',
      command: 'pnpm build',
      mode: 'command',
      source: 'user',
      createdAt: '2026-10-09',
    };
    const updated = { ...created, name: 'Production build' };
    mocks.create.mockResolvedValueOnce({ success: true, data: created });
    mocks.update.mockResolvedValueOnce({ success: true, data: updated });
    const run = start();

    const create = createScriptDefinitionRequested(WS, {
      name: 'Build',
      command: 'pnpm build',
      mode: 'command',
      purpose: 'saved',
      source: 'user',
    });
    run.channel.put(create);
    await expect(create.promise).resolves.toEqual(created);
    expect(mocks.create).toHaveBeenCalledWith(WS, create.payload[1]);
    expect(run.actions).toContainEqual(refreshScripts(WS));

    const update = updateScriptDefinitionRequested(WS, created.id, {
      name: 'Production build',
    });
    run.channel.put(update);
    await expect(update.promise).resolves.toEqual(updated);
    expect(mocks.update).toHaveBeenCalledWith(WS, created.id, update.payload[2]);
    expect(run.actions.filter(({ type }) => type === refreshScripts.type)).toHaveLength(2);
    await stop(run.task);
  });

  it('preserves a newer script snapshot while an update response is pending', async () => {
    const pending = deferred<{ success: true; data: Record<string, unknown> }>();
    mocks.update.mockReturnValueOnce(pending.promise);
    const run = start();
    seed(run);
    const request = updateScriptDefinitionRequested(WS, 'script-1', { name: 'Saved name' });
    run.channel.put(request);
    await settle();

    const newer = {
      ...run.state.scripts.byWorkspaceId[WS].scripts['script-1'],
      name: 'Newer event name',
    };
    run.dispatch(scriptSnapshotReceived(WS, newer));
    pending.resolve({
      success: true,
      data: { ...newer, name: 'Saved name' },
    });

    await expect(request.promise).resolves.toEqual({ ...newer, name: 'Saved name' });
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']?.name).toBe('Newer event name');
    expect(run.actions).toContainEqual(refreshScripts(WS));
    await stop(run.task);
  });

  it('does not recreate a definition removed while a create response is pending', async () => {
    const pending = deferred<{ success: true; data: Record<string, unknown> }>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const run = start();
    seed(run);
    const request = createScriptDefinitionRequested(WS, {
      name: 'Build',
      command: 'pnpm build',
      mode: 'command',
      purpose: 'saved',
      source: 'user',
    });
    run.channel.put(request);
    await settle();

    run.dispatch(removeScript(WS, 'script-created'));
    const created = {
      ...run.state.scripts.byWorkspaceId[WS].scripts['script-1'],
      id: 'script-created',
      name: 'Build',
    };
    pending.resolve({ success: true, data: created });

    await expect(request.promise).resolves.toEqual(created);
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-created']).toBeUndefined();
    expect(run.actions).toContainEqual(refreshScripts(WS));
    await stop(run.task);
  });

  it('rejects a stale definition result after workspace authority changes', async () => {
    const pending = deferred<{ success: true; data: Record<string, unknown> }>();
    mocks.update.mockReturnValueOnce(pending.promise);
    const run = start();
    seed(run);
    const request = updateScriptDefinitionRequested(WS, 'script-1', { name: 'Stale name' });
    run.channel.put(request);
    await settle();

    run.state.principal.status = 'loading';
    pending.resolve({
      success: true,
      data: {
        ...run.state.scripts.byWorkspaceId[WS].scripts['script-1'],
        name: 'Stale name',
      },
    });

    await expect(request.promise).rejects.toThrow();
    expect(run.state.scripts.byWorkspaceId[WS].scripts['script-1']?.name).toBe('Check');
    await stop(run.task);
  });

  it('returns detection counts and requests one authoritative refresh', async () => {
    mocks.detect.mockResolvedValueOnce({
      success: true,
      detected: 3,
      added: 1,
      removed: 1,
      skippedRunning: ['Dev'],
      packageManager: 'pnpm',
    });
    const run = start();
    const request = detectScriptDefinitionsRequested(WS);
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual({
      detected: 3,
      added: 1,
      updated: 0,
      removed: 1,
      skippedRunning: ['Dev'],
      packageManager: 'pnpm',
    });
    expect(mocks.detect).toHaveBeenCalledWith(WS);
    expect(run.actions.filter(({ type }) => type === refreshScripts.type)).toEqual([
      refreshScripts(WS),
    ]);
    await stop(run.task);
  });

  it('applies agent definition changes sequentially and skips running auto-detected rows', async () => {
    const auto = {
      id: 'auto-idle',
      workspaceId: WS,
      name: 'Lint',
      command: 'pnpm lint',
      mode: 'command',
      source: 'auto-detected',
      createdAt: '2026-10-09',
      runtime: { status: 'idle', restartCount: 0 },
    } as const;
    const running = {
      ...auto,
      id: 'auto-running',
      name: 'Dev',
      command: 'pnpm dev',
      runtime: { status: 'running', restartCount: 0 },
    } as const;
    const created = { ...auto, id: 'new-id', name: 'Test', command: 'pnpm test' };
    mocks.remove.mockResolvedValueOnce({ success: true });
    mocks.create.mockResolvedValueOnce({ success: true, data: created });
    const run = start();
    run.dispatch(setScriptsData(WS, [auto, running] as never));
    const changes = {
      remove: [auto.id],
      update: [{ id: running.id, updates: { command: 'pnpm dev --host' } }],
      add: [
        {
          name: 'Test',
          command: 'pnpm test',
          mode: 'command' as const,
          purpose: 'saved' as const,
          source: 'auto-detected',
        },
      ],
    };
    const request = applyScriptDefinitionChangesRequested(WS, changes);
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual({
      detected: 1,
      added: 1,
      updated: 0,
      removed: 1,
      skippedRunning: ['Dev'],
    });
    expect(mocks.remove).toHaveBeenCalledWith(WS, auto.id);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(WS, changes.add[0]);
    await stop(run.task);
  });

  it('restores a snapshot and saves definitions to the repository through saga ownership', async () => {
    mocks.restoreSnapshot.mockResolvedValueOnce({ success: true });
    mocks.saveToRepo.mockResolvedValueOnce({ success: true });
    const run = start();
    const snapshot = [
      {
        id: 'script-1',
        workspaceId: WS,
        name: 'Check',
        command: 'make check',
        mode: 'command' as const,
        source: 'user',
        createdAt: '2026-10-09',
      },
    ];
    const restore = restoreScriptDefinitionsRequested(WS, snapshot);
    run.channel.put(restore);
    await expect(restore.promise).resolves.toBeUndefined();
    expect(mocks.restoreSnapshot).toHaveBeenCalledWith(WS, snapshot);

    const save = saveScriptDefinitionsToRepoRequested(WS);
    run.channel.put(save);
    await expect(save.promise).resolves.toBeUndefined();
    expect(mocks.saveToRepo).toHaveBeenCalledWith(WS);
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
