import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withLegacyPrincipal } from '../../test/fixtures/principal-state';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: transport.request }));
vi.mock('$lib/client', async () => {
  const { LiveScriptsClient } = await import('$lib/client/live/live-scripts-client');
  return { appClient: { scripts: new LiveScriptsClient() } };
});
import { store } from '$store/renderer/store';
import {
  backendReconnected,
  workspaceUnmounted,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { scriptsOperationSaga } from '$store/renderer/slices/scripts/sagas/scripts-operation-saga';
import {
  scriptsReducer,
  refreshScripts,
  setScriptsData,
  appendScriptOutput,
  startScriptRequested,
  stopScriptRequested,
  restartScriptRequested,
  scriptOutputRequested,
  scriptOutputReleased,
} from '$store/renderer/slices/scripts/scripts-slice';
import { selectScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from './daemon-events-bridge.client';
import type { ScriptWithState } from '$features/scripts/types';
const WS = 'scripts-wire';
const ID = 'one-off';
const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const row = (extra: Partial<ScriptWithState> = {}): ScriptWithState => ({
  id: ID,
  workspaceId: WS,
  name: 'Check',
  command: 'true',
  mode: 'command',
  purpose: 'oneOff',
  source: 'user',
  createdAt: '2026-10-02T00:00:00Z',
  runtime: { status: 'running', restartCount: 0, pid: 123 },
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let eventId = 0;
function emit(type: string, data: unknown, id = `event-${++eventId}`) {
  routeDaemonEventsNotification('events.event', {
    event: {
      id,
      type,
      workspaceId: WS,
      timestamp: '2026-10-02T00:01:00Z',
      actor: { type: 'system' },
      data,
    },
  });
}
function start() {
  const channel = stdChannel();
  const state = withLegacyPrincipal({
    tabState: { currentTabId: WS },
    workspaceShare: { open: false, byWorkspaceId: {} },
    scripts: scriptsReducer(undefined, { type: '@@init' }),
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
  });
  const dispatch = (a: any) => {
    state.scripts = scriptsReducer(state.scripts, a);
    channel.put(a);
    return a;
  };
  vi.spyOn(store, 'dispatch').mockImplementation(dispatch);
  vi.spyOn(store, 'state', 'get').mockImplementation(() => state);
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, lifecycleReadSaga));
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, scriptsOperationSaga));
  return {
    state,
    dispatch,
    scripts: () => state.scripts.byWorkspaceId[WS],
    active: () => selectScriptEntries.select(state as never, WS),
  };
}
beforeEach(() => {
  store.dispose();
  store.init();
  __resetDaemonEventsBridgeForTests();
  transport.request.mockReset();
  transport.request.mockImplementation(async (method) => {
    if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
    if (method === 'script.list') return { scripts: [row()] };
    if (method === 'script.output') return 'retained output';
    return { ok: true };
  });
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.restoreAllMocks();
  store.dispose();
});
const listCalls = () => transport.request.mock.calls.filter(([method]) => method === 'script.list');
describe('script lifecycle event to transport', () => {
  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'applies %s completion without reading lists and retains output',
    async (outcome) => {
      const run = start();
      run.dispatch(refreshScripts(WS));
      await settle();
      expect(listCalls()).toEqual([['script.list', { workspaceId: WS, archive: 'active' }]]);
      run.dispatch(appendScriptOutput(WS, ID, { text: 'kept', timestamp: 'now' }));
      const completed = row({
        archivedAt: 'now',
        lastRun: { outcome, stoppedAt: 'now' },
        runtime: { status: 'exited', restartCount: 0, exitCode: outcome === 'succeeded' ? 0 : 1 },
      });
      emit('script:changed', { scriptId: ID, action: 'updated', script: completed });
      await settle();
      expect(run.scripts().scripts[ID]).toEqual(completed);
      expect(run.active()).toEqual([]);
      expect(run.scripts().outputBuffers[ID].chunks[0].text).toBe('kept');
      expect(listCalls()).toHaveLength(1);
    },
  );
  it('replays retirement, deletion and unknown runtime over delayed initial hydration', async () => {
    const pending = deferred<{ scripts: ScriptWithState[] }>();
    transport.request.mockImplementation(async (method) =>
      method === 'client.hello'
        ? { server: { capabilities: { scriptLifecycle: 1 } } }
        : pending.promise,
    );
    const run = start();
    run.dispatch(refreshScripts(WS));
    await settle();
    const retired = row({
      archivedAt: 'now',
      runtime: { status: 'exited', exitCode: 0, restartCount: 0 },
    });
    emit('script:changed', { scriptId: ID, action: 'updated', script: retired });
    emit('script:changed', { scriptId: 'deleted', action: 'removed' });
    emit('script:state', { scriptId: 'unknown', status: 'exited', exitCode: 7, restartCount: 0 });
    pending.resolve({ scripts: [row(), row({ id: 'deleted' }), row({ id: 'unknown' })] });
    await settle();
    expect(run.scripts().scripts[ID]).toEqual(retired);
    expect(run.scripts().scripts.deleted).toBeUndefined();
    expect(run.scripts().scripts.unknown.runtime.exitCode).toBe(7);
    expect(run.active().map((s) => s.id)).toEqual(['unknown']);
    expect(listCalls()).toHaveLength(1);
  });
  it('replaces snapshots, clears optionals and deduplicates old delivery after rerun', async () => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row()]));
    const retired = row({
      archivedAt: 'now',
      lastRun: { outcome: 'failed', stoppedAt: 'now' },
      runtime: { status: 'exited', restartCount: 0, exitCode: 1, error: 'old' },
    });
    emit('script:changed', { scriptId: ID, action: 'updated', script: retired }, 'completed');
    const replacement = row({
      purpose: 'saved',
      runtime: { status: 'starting' as never, restartCount: 0 },
    });
    emit('script:changed', { scriptId: ID, action: 'updated', script: replacement });
    emit('script:changed', { scriptId: ID, action: 'updated', script: retired }, 'completed');
    await settle();
    expect(run.scripts().scripts[ID]).toEqual(replacement);
    expect(run.active()).toEqual([replacement]);
    expect(listCalls()).toHaveLength(0);
  });
  it.each([
    ['start', startScriptRequested],
    ['stop', stopScriptRequested],
    ['restart', restartScriptRequested],
  ] as const)('does not list after successful %s', async (method, action) => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row()]));
    run.dispatch(action(WS, ID));
    await settle();
    expect(transport.request).toHaveBeenCalledWith(`script.${method}`, {
      workspaceId: WS,
      scriptId: ID,
    });
    expect(run.scripts().operations[ID]).toBeUndefined();
    expect(listCalls()).toHaveLength(0);
  });
  it('removes by ID without refetch; malformed or legacy changes still reconcile', async () => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row()]));
    emit('script:changed', { scriptId: ID, action: 'removed' });
    await settle();
    expect(run.active()).toEqual([]);
    expect(listCalls()).toHaveLength(0);
    emit('script:changed', { scriptId: ID, action: 'updated' });
    await settle();
    expect(listCalls()).toHaveLength(1);
    emit('script:changed', { scriptId: ID, action: 'updated', script: { id: ID } });
    await settle();
    expect(listCalls()).toHaveLength(2);
  });

  it('reconciles a legacy silent finished-stop with status only', async () => {
    const run = start();
    const completed = row({
      archivedAt: 'now',
      lastRun: { outcome: 'succeeded', stoppedAt: 'now' },
      runtime: { status: 'exited', exitCode: 0, restartCount: 0 },
    });
    run.dispatch(setScriptsData(WS, [completed]));
    transport.request.mockImplementation(async (method) =>
      method === 'script.status' ? { status: 'idle', exitCode: 0, restartCount: 0 } : { ok: true },
    );
    run.dispatch(stopScriptRequested(WS, ID));
    await settle();
    expect(run.scripts().scripts[ID].runtime.status).toBe('idle');
    expect(run.scripts().scripts[ID].lastRun).toEqual(completed.lastRun);
    expect(run.scripts().scripts[ID].archivedAt).toBe('now');
    expect(transport.request.mock.calls.map(([method]) => method)).toEqual([
      'script.stop',
      'script.status',
    ]);
  });

  it('uses the authoritative finished-stop event without a status or list read', async () => {
    const run = start();
    run.dispatch(
      setScriptsData(WS, [row({ runtime: { status: 'exited', exitCode: 0, restartCount: 0 } })]),
    );
    transport.request.mockImplementation(async (method) => {
      if (method === 'script.stop')
        emit('script:state', { scriptId: ID, status: 'idle', exitCode: 0, restartCount: 0 });
      return { ok: true };
    });
    run.dispatch(stopScriptRequested(WS, ID));
    await settle();
    expect(run.scripts().scripts[ID].runtime.status).toBe('idle');
    expect(transport.request.mock.calls.map(([method]) => method)).toEqual(['script.stop']);
  });

  it.each(['rerun', 'removed', 'connection', 'authority', 'workspace'] as const)(
    'rejects a delayed legacy stop status after %s',
    async (change) => {
      const status = deferred<unknown>();
      const run = start();
      run.dispatch(
        setScriptsData(WS, [row({ runtime: { status: 'exited', exitCode: 0, restartCount: 0 } })]),
      );
      transport.request.mockImplementation(async (method) =>
        method === 'script.status' ? status.promise : { ok: true },
      );
      run.dispatch(stopScriptRequested(WS, ID));
      await settle();
      expect(transport.request).toHaveBeenCalledWith('script.status', {
        workspaceId: WS,
        scriptId: ID,
      });
      if (change === 'rerun')
        emit('script:state', {
          scriptId: ID,
          status: 'running',
          restartCount: 0,
          startedAt: 'new run',
        });
      if (change === 'removed') emit('script:changed', { scriptId: ID, action: 'removed' });
      if (change === 'connection') run.dispatch(backendReconnected());
      if (change === 'authority') run.state.workspace.workspaces.map[WS].myRole = 'collaborator';
      if (change === 'workspace') run.dispatch(workspaceUnmounted(WS));
      const before = run.scripts()?.scripts[ID];
      status.resolve({ status: 'idle', restartCount: 0 });
      await settle();
      expect(run.scripts()?.scripts[ID]).toEqual(before);
      expect(listCalls()).toHaveLength(0);
    },
  );
});

describe('script list and retained output read fences', () => {
  it('recovers archive and last-result metadata missed while disconnected', async () => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row(), row({ id: 'deleted' })]));
    const completed = row({
      archivedAt: 'retired',
      lastRun: { outcome: 'failed', exitCode: 9, stoppedAt: 'retired' },
      runtime: { status: 'exited', exitCode: 9, restartCount: 0 },
    });
    transport.request.mockImplementation(async (method, params) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list')
        return {
          scripts:
            params.archive === 'active'
              ? []
              : [completed, row({ id: 'unopened-history', archivedAt: 'old' })],
        };
      if (method === 'script.output') return 'failure output';
      throw new Error('Unexpected method ' + method);
    });
    run.dispatch(refreshScripts(WS));
    await settle();
    expect(listCalls()).toEqual([
      ['script.list', { workspaceId: WS, archive: 'active' }],
      ['script.list', { workspaceId: WS, archive: 'all' }],
    ]);
    expect(run.scripts().scripts).toEqual({ [ID]: completed });
    expect(run.active()).toEqual([]);
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    expect(run.scripts().retainedOutputs?.viewer.text).toBe('failure output');
    expect(listCalls()).toHaveLength(2);
  });

  it('replays restore and runtime events over delayed retained metadata reconciliation', async () => {
    const pending = deferred<{ scripts: ScriptWithState[] }>();
    const run = start();
    run.dispatch(setScriptsData(WS, [row()]));
    transport.request.mockImplementation(async (method, params) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      return params.archive === 'active' ? { scripts: [] } : pending.promise;
    });
    run.dispatch(refreshScripts(WS));
    await settle();
    expect(listCalls()).toHaveLength(2);
    const restored = row({ runtime: { status: 'idle', restartCount: 0 } });
    emit('script:changed', { scriptId: ID, action: 'updated', script: restored });
    emit('script:state', {
      scriptId: ID,
      status: 'starting',
      restartCount: 0,
      startedAt: 'new-run',
    });
    pending.resolve({
      scripts: [
        row({ archivedAt: 'old', runtime: { status: 'exited', exitCode: 1, restartCount: 0 } }),
      ],
    });
    await settle();
    expect(run.active().map((s) => s.id)).toEqual([ID]);
    expect(run.scripts().scripts[ID].archivedAt).toBeUndefined();
    expect(run.scripts().scripts[ID].runtime).toMatchObject({
      status: 'starting',
      startedAt: 'new-run',
    });
    expect(listCalls()).toHaveLength(2);
  });

  it.each(['changed', 'removed'] as const)(
    'keeps %s events authoritative over a missing-definition read',
    async (kind) => {
      const pending = deferred<{ scripts: ScriptWithState[] }>();
      transport.request.mockImplementation(async (method) => {
        if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
        if (method === 'script.list') return pending.promise;
        return 'current output';
      });
      const run = start();
      run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
      await settle();
      const completed = row({
        archivedAt: 'now',
        runtime: { status: 'exited', exitCode: 7, restartCount: 0 },
      });
      emit('script:changed', {
        scriptId: ID,
        action: kind === 'removed' ? 'removed' : 'updated',
        ...(kind === 'changed' ? { script: completed } : {}),
      });
      pending.resolve({ scripts: [row()] });
      await settle();
      expect(run.scripts().scripts[ID]).toEqual(kind === 'changed' ? completed : undefined);
      expect(run.active()).toEqual([]);
      expect(listCalls()).toEqual([['script.list', { workspaceId: WS, archive: 'all' }]]);
      if (kind === 'changed')
        expect(run.scripts().retainedOutputs?.viewer.text).toBe('current output');
    },
  );

  it.each(['connection', 'authority', 'workspace'] as const)(
    'drops active hydration after %s invalidation',
    async (kind) => {
      const pending = deferred<{ scripts: ScriptWithState[] }>();
      transport.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? { server: { capabilities: { scriptLifecycle: 1 } } }
          : pending.promise,
      );
      const run = start();
      run.dispatch(refreshScripts(WS));
      await settle();
      if (kind === 'connection') run.dispatch(backendReconnected());
      if (kind === 'authority') run.state.principal.status = 'loading';
      if (kind === 'workspace') run.dispatch(workspaceUnmounted(WS));
      pending.resolve({ scripts: [row()] });
      await settle();
      expect(run.scripts().scripts[ID]).toBeUndefined();
    },
  );

  it('drops pre-reconnect missing-definition replies even when the backend ID is unchanged', async () => {
    const pending = deferred<{ scripts: ScriptWithState[] }>();
    transport.request.mockImplementation(async (method) =>
      method === 'client.hello'
        ? { server: { capabilities: { scriptLifecycle: 1 } } }
        : pending.promise,
    );
    const run = start();
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    run.dispatch(backendReconnected());
    pending.resolve({ scripts: [row()] });
    await settle();
    expect(run.scripts().scripts[ID]).toBeUndefined();
    expect(transport.request.mock.calls.some(([method]) => method === 'script.output')).toBe(false);
  });

  it('keeps the newer request when an output viewer is requested again before the old reply', async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    transport.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const run = start();
    run.dispatch(setScriptsData(WS, [row()]));
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    fresh.resolve('new');
    await settle();
    old.resolve('old');
    await settle();
    expect(run.scripts().retainedOutputs?.viewer.text).toBe('new');
    run.dispatch(scriptOutputReleased(WS, ID, 'viewer'));
  });

  it('a saved command result remains visible without refreshing the list', async () => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row({ purpose: 'saved' })]));
    const completed = row({
      purpose: 'saved',
      lastRun: { outcome: 'succeeded', stoppedAt: 'now' },
      runtime: { status: 'exited', restartCount: 0, exitCode: 0 },
    });
    emit('script:changed', { scriptId: ID, action: 'updated', script: completed });
    await settle();
    expect(run.active()).toEqual([completed]);
    expect(listCalls()).toHaveLength(0);
  });
});

it.each([
  [true, true],
  [false, true],
  [true, false],
  [false, false],
])(
  'keeps a newer all-list reply (row exists: %s, older active reply finishes last: %s)',
  async (exists, activeFinishesLast) => {
    const active = deferred<{ scripts: ScriptWithState[] }>();
    const all = deferred<{ scripts: ScriptWithState[] }>();
    transport.request.mockImplementation(async (method, params) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list')
        return params.archive === 'active' ? active.promise : all.promise;
      return 'new output';
    });
    const run = start();
    run.dispatch(refreshScripts(WS));
    await settle();
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    const completed = row({
      archivedAt: 'now',
      lastRun: { outcome: 'succeeded', stoppedAt: 'now' },
      runtime: { status: 'exited', exitCode: 0, restartCount: 0 },
    });
    const finishActive = async () => {
      active.resolve({ scripts: [row()] });
      await settle();
    };
    if (!activeFinishesLast) await finishActive();
    all.resolve({
      scripts: [...(exists ? [completed] : []), row({ id: 'unopened', archivedAt: 'now' })],
    });
    await settle();
    if (activeFinishesLast) await finishActive();
    expect(run.scripts().scripts[ID]).toEqual(exists ? completed : undefined);
    expect(run.scripts().scripts.unopened).toBeUndefined();
    expect(run.active()).toEqual([]);
    expect(run.scripts().retainedOutputs?.viewer.text).toBe('new output');
    expect(listCalls()).toHaveLength(2);
  },
);
