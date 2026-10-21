import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withLegacyPrincipal, withHostPrincipal } from '../../test/fixtures/principal-state';
import { CURRENT_PROTOCOL_VERSION } from '../../test/current-protocol-version';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
const notifyError = vi.hoisted(() => vi.fn());
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: notifyError } }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: transport.request }));
vi.mock('$lib/client', async () => {
  const { LiveScriptsClient } = await import('$lib/client/live/live-scripts-client');
  return { appClient: { scripts: new LiveScriptsClient() } };
});
import { store } from '$store/renderer/store';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { principalReadStarted } from '$store/renderer/slices/principal/principal-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { workspaceTasksReducer } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
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
import {
  selectScriptEntries,
  selectScriptById,
  selectScriptOutput,
  selectScriptRetainedOutput,
} from '$store/renderer/slices/scripts/scripts-selectors';
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
    workspaceTasks: workspaceTasksReducer(undefined, { type: '@@init' }),
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
  });
  const dispatch = (a: any) => {
    state.scripts = scriptsReducer(state.scripts, a);
    state.workspaceTasks = workspaceTasksReducer(state.workspaceTasks, a);
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
  notifyError.mockClear();
  transport.request.mockImplementation(async (method) => {
    if (method === 'client.hello')
      return {
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
        },
      };
    if (method === 'script.list') return { view: 'summary', scripts: [row()] };
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
  it.each(['removed', 'guest-access-revoked'])(
    'journals %s before hydration so a stale list cannot restore a private script',
    async (action) => {
      const run = start();
      run.state.principal.snapshot!.principal.isAdministrator = false;
      run.state.principal.snapshot!.capabilities.workspaceGuestRoles = true;
      run.state.workspace.workspaces.map[WS].myRole = 'manager';
      const pending = deferred<unknown>();
      const originalRequest = transport.request.getMockImplementation();
      transport.request.mockImplementation((method, ...args) =>
        method === 'script.list' ? pending.promise : originalRequest?.(method, ...args),
      );
      run.dispatch(refreshScripts(WS));
      await settle();
      expect(listCalls()).toHaveLength(1);
      emit('script:changed', {
        scriptId: 'retired',
        action,
        ...(action === 'removed' ? { purpose: 'saved' } : {}),
      });
      emit('script:changed', {
        scriptId: 'retired',
        action: 'updated',
        script: row({ id: 'retired', purpose: 'oneOff' }),
      });
      pending.resolve({ view: 'summary', scripts: [row({ id: 'retired', purpose: 'saved' })] });
      await settle();
      expect(run.active()).toEqual([]);
      expect(run.scripts().scripts.retired).toBeUndefined();
    },
  );

  it.each(['owner', 'member', 'guest-owner', 'manager'] as const)(
    '%s handles guest revocation without crossing the output authority boundary',
    async (role) => {
      const run = start();
      Object.assign(
        run.state,
        withHostPrincipal(run.state, role === 'manager' || role === 'guest-owner' ? 'guest' : role),
      );
      run.state.principal.snapshot!.capabilities.workspaceGuestRoles = true;
      Object.assign(run.state.workspace, {
        hasLoaded: true,
        loadedBackendId: run.state.connections.windowBackendId,
        capabilityContext: selectPrincipalActionContext.select(run.state),
      });
      Object.assign(run.state.workspace.workspaces.map[WS], {
        myRole: role === 'manager' ? 'manager' : role === 'guest-owner' ? 'owner' : 'collaborator',
        canManage: role !== 'manager',
      });
      run.dispatch(
        setScriptsData(WS, [row({ purpose: 'saved' }), row({ id: 'private', purpose: 'oneOff' })]),
      );
      expect(run.active().map((script) => script.id)).toEqual(
        role === 'manager' ? [ID] : [ID, 'private'],
      );
      if (role === 'guest-owner') {
        emit('script:output', { scriptId: 'private', chunk: btoa('private owner output') });
        expect(selectScriptOutput.select(run.state, WS, 'private').chunks[0].text).toBe(
          'private owner output',
        );
      }
      run.dispatch(appendScriptOutput(WS, ID, { text: 'live buffer', timestamp: 'now' }));
      run.dispatch(scriptOutputRequested(WS, ID, 'existing-viewer'));
      await settle();
      expect(selectScriptRetainedOutput.select(run.state, WS, ID, 'existing-viewer')?.text).toBe(
        'retained output',
      );
      const pending = deferred<string>();
      const originalRequest = transport.request.getMockImplementation();
      transport.request.mockImplementation((method, ...args) =>
        method === 'script.output' ? pending.promise : originalRequest?.(method, ...args),
      );
      run.dispatch(scriptOutputRequested(WS, ID, 'pending-viewer'));
      await settle();
      emit('script:changed', { scriptId: ID, action: 'guest-access-revoked' });
      emit('script:changed', {
        scriptId: ID,
        action: 'updated',
        script: row({ purpose: 'oneOff' }),
      });
      if (role === 'manager') {
        expect(run.scripts().scripts[ID]).toBeUndefined();
        expect(run.scripts().outputBuffers[ID]).toBeUndefined();
        expect(run.scripts().retainedOutputs).toEqual({});
      } else {
        expect(run.scripts().scripts[ID]).toBeDefined();
        expect(run.scripts().outputBuffers[ID].chunks[0].text).toBe('live buffer');
        expect(selectScriptRetainedOutput.select(run.state, WS, ID, 'existing-viewer')?.text).toBe(
          'retained output',
        );
      }
      pending.resolve('pending output survives only for host readers');
      await settle();
      expect(selectScriptRetainedOutput.select(run.state, WS, ID, 'pending-viewer')?.text).toBe(
        role === 'manager' ? undefined : 'pending output survives only for host readers',
      );
    },
  );

  it('limits Manager reads, cached output and live events to saved scripts and clears access on downgrade', async () => {
    const run = start();
    run.state.principal.snapshot!.principal.isAdministrator = false;
    run.state.principal.snapshot!.capabilities.workspaceGuestRoles = true;
    run.state.workspace.workspaces.map[WS].myRole = 'manager';
    const saved = row({ id: 'saved', purpose: 'saved' });
    const oneOff = row();
    run.dispatch(setScriptsData(WS, [saved, oneOff]));
    run.dispatch(appendScriptOutput(WS, ID, { text: 'private cached bytes', timestamp: 'now' }));
    expect(run.active().map((entry) => entry.id)).toEqual(['saved']);
    expect(selectScriptById.select(run.state, WS, ID)).toBeNull();
    expect(selectScriptOutput.select(run.state, WS, ID).chunks).toEqual([]);
    emit('script:output', { scriptId: ID, chunk: btoa('forbidden live bytes') });
    emit('script:changed', {
      scriptId: 'new-one-off',
      action: 'created',
      script: row({ id: 'new-one-off' }),
    });
    expect(run.scripts().scripts['new-one-off']).toBeUndefined();
    expect(run.scripts().outputBuffers[ID].chunks).toHaveLength(1);
    emit('script:output', { scriptId: 'saved', chunk: btoa('saved bytes') });
    expect(selectScriptOutput.select(run.state, WS, 'saved').chunks).toHaveLength(1);
    run.dispatch(scriptOutputRequested(WS, 'saved', 'viewer'));
    await settle();
    expect(selectScriptRetainedOutput.select(run.state, WS, 'saved', 'viewer')?.text).toBe(
      'retained output',
    );
    run.state.workspace.workspaces.map[WS].myRole = 'collaborator';
    expect(run.active()).toEqual([]);
    expect(selectScriptOutput.select(run.state, WS, 'saved').chunks).toEqual([]);
    expect(selectScriptRetainedOutput.select(run.state, WS, 'saved', 'viewer')).toBeUndefined();
    emit('script:output', { scriptId: 'saved', chunk: btoa('late bytes') });
    expect(run.scripts().outputBuffers.saved.chunks).toHaveLength(1);
    transport.request.mockClear();
    run.dispatch(scriptOutputRequested(WS, 'saved', 'late-viewer'));
    await settle();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'applies %s completion without reading lists and retains output',
    async (outcome) => {
      const run = start();
      run.dispatch(refreshScripts(WS));
      await settle();
      expect(listCalls()).toEqual([
        ['script.list', { workspaceId: WS, archive: 'active', view: 'summary', limit: 100 }],
      ]);
      run.dispatch(appendScriptOutput(WS, ID, { text: 'kept', timestamp: 'now' }));
      const completed = row({
        archivedAt: 'now',
        lastRun: { outcome, stoppedAt: 'now' },
        runtime: { status: 'exited', restartCount: 0, exitCode: outcome === 'succeeded' ? 0 : 1 },
      });
      emit('script:changed', { scriptId: ID, action: 'updated', script: completed });
      await settle();
      expect(run.scripts().scripts[ID]).toBeUndefined();
      expect(run.active()).toEqual([]);
      expect(run.scripts().outputBuffers[ID].chunks[0].text).toBe('kept');
      expect(listCalls()).toHaveLength(1);
    },
  );
  it('replays retirement, deletion and unknown runtime over delayed initial hydration', async () => {
    const pending = deferred<{ view: string; scripts: ScriptWithState[] }>();
    transport.request.mockImplementation(async (method) =>
      method === 'client.hello'
        ? {
            server: {
              protocolVersion: CURRENT_PROTOCOL_VERSION,
              capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
            },
          }
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
    pending.resolve({
      view: 'summary',
      scripts: [row(), row({ id: 'deleted' }), row({ id: 'unknown' })],
    });
    await settle();
    expect(run.scripts().scripts[ID]).toBeUndefined();
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

  it('stops mixed finished/live rows independently and preserves failed rows and output', async () => {
    const run = start();
    run.dispatch(
      setScriptsData(WS, [
        row({
          id: 'finished',
          purpose: 'saved',
          runtime: { status: 'exited', exitCode: 0, restartCount: 0 },
        }),
        row({ id: 'live', purpose: 'saved' }),
        row({ id: 'failed', purpose: 'saved' }),
      ]),
    );
    run.dispatch(appendScriptOutput(WS, 'finished', { text: 'kept output', timestamp: 'now' }));
    transport.request.mockImplementation(async (method, args) => {
      if (method === 'script.status') return { status: 'idle', restartCount: 0 };
      if (method === 'script.stop' && args.scriptId === 'failed') throw new Error('Stop denied');
      if (method === 'script.stop' && args.scriptId === 'live')
        emit('script:state', { scriptId: 'live', status: 'idle', restartCount: 0 });
      return { ok: true };
    });
    for (const id of ['finished', 'live', 'failed'])
      run.dispatch(stopScriptRequested(WS, id, 'Stop failed'));
    await settle();
    expect(run.scripts().scripts.finished.runtime.status).toBe('idle');
    expect(run.scripts().scripts.live.runtime.status).toBe('idle');
    expect(run.scripts().scripts.failed.runtime.status).toBe('running');
    expect(run.scripts().operations.failed.error).toBe('Stop denied');
    expect(notifyError).toHaveBeenCalledWith('Stop denied');
    expect(run.scripts().outputBuffers.finished.chunks[0].text).toBe('kept output');
    expect(run.active()).toHaveLength(3);
    expect(listCalls()).toHaveLength(0);
    expect(transport.request.mock.calls.filter(([method]) => method === 'script.status')).toEqual([
      ['script.status', { workspaceId: WS, scriptId: 'finished' }],
    ]);
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

  it.each(['connection', 'authority'] as const)(
    'retires a legacy stop on %s change and allows retry before its stale reply',
    async (change) => {
      const staleStatus = deferred<unknown>();
      const retryStop = deferred<unknown>();
      const run = start();
      run.dispatch(
        setScriptsData(WS, [
          row({ purpose: 'saved', runtime: { status: 'exited', exitCode: 0, restartCount: 0 } }),
        ]),
      );
      transport.request.mockImplementation(async (method) =>
        method === 'script.status' ? staleStatus.promise : { ok: true },
      );
      run.dispatch(stopScriptRequested(WS, ID));
      await settle();
      expect(run.scripts().operations[ID]?.pending).toBe(true);
      if (change === 'connection') run.dispatch(backendReconnected());
      else {
        run.state.principal.status = 'loading';
        run.dispatch(principalReadStarted());
      }
      await settle();
      expect(run.scripts().scripts[ID].runtime.status).toBe('exited');
      expect(run.scripts().operations[ID]?.pending).not.toBe(true);
      if (change === 'authority') run.state.principal.status = 'ready';
      transport.request.mockImplementation(async (method) =>
        method === 'script.stop' ? retryStop.promise : { status: 'idle', restartCount: 0 },
      );
      run.dispatch(stopScriptRequested(WS, ID));
      await settle();
      expect(
        transport.request.mock.calls.filter(([method]) => method === 'script.stop'),
      ).toHaveLength(2);
      const newerOperation = run.scripts().operations[ID];
      expect(newerOperation?.pending).toBe(true);
      staleStatus.resolve({ status: 'idle', restartCount: 0 });
      await settle();
      expect(run.scripts().scripts[ID].runtime.status).toBe('exited');
      expect(run.scripts().operations[ID]).toBe(newerOperation);
      retryStop.resolve({ ok: true });
      await settle();
      expect(run.scripts().operations[ID]?.pending).not.toBe(true);
      expect(run.scripts().scripts[ID].runtime.status).toBe('idle');
      expect(listCalls()).toHaveLength(0);
    },
  );

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
  it('refreshes only active summaries and reads selected output without archive enumeration', async () => {
    const run = start();
    run.dispatch(setScriptsData(WS, [row(), row({ id: 'deleted' })]));
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return {
          server: {
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
          },
        };
      if (method === 'script.list') return { view: 'summary', scripts: [] };
      if (method === 'script.output') return 'failure output';
      throw new Error('Unexpected method ' + method);
    });
    run.dispatch(refreshScripts(WS));
    await settle();
    expect(run.scripts().scripts).toEqual({});
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    expect(run.scripts().retainedOutputs?.viewer.text).toBe('failure output');
    expect(listCalls()).toEqual([
      ['script.list', { workspaceId: WS, archive: 'active', view: 'summary', limit: 100 }],
    ]);
  });

  it('replays restore and runtime events over a delayed active page', async () => {
    const pending = deferred<{ view: string; scripts: ScriptWithState[] }>();
    const run = start();
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return {
          server: {
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
          },
        };
      return pending.promise;
    });
    run.dispatch(refreshScripts(WS));
    await settle();
    const restored = row({ runtime: { status: 'idle', restartCount: 0 } });
    emit('script:changed', { scriptId: ID, action: 'updated', script: restored });
    emit('script:state', {
      scriptId: ID,
      status: 'starting',
      restartCount: 0,
      startedAt: 'new-run',
    });
    pending.resolve({ view: 'summary', scripts: [] });
    await settle();
    expect(run.active().map((s) => s.id)).toEqual([ID]);
    expect(run.scripts().scripts[ID].runtime).toMatchObject({
      status: 'starting',
      startedAt: 'new-run',
    });
    expect(listCalls()).toHaveLength(1);
  });

  it.each(['changed', 'removed'] as const)(
    'keeps %s events authoritative while direct output loads',
    async (kind) => {
      const pending = deferred<string>();
      transport.request.mockImplementation(async (method) => {
        if (method === 'script.output') return pending.promise;
        throw new Error('Unexpected method ' + method);
      });
      const run = start();
      run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
      await settle();
      emit('script:changed', {
        scriptId: ID,
        action: kind === 'removed' ? 'removed' : 'updated',
        ...(kind === 'changed'
          ? {
              script: row({
                archivedAt: 'now',
                runtime: { status: 'exited', exitCode: 7, restartCount: 0 },
              }),
            }
          : {}),
      });
      pending.resolve('current output');
      await settle();
      expect(run.scripts().scripts[ID]).toBeUndefined();
      expect(run.active()).toEqual([]);
      expect(listCalls()).toEqual([]);
      if (kind === 'changed')
        expect(run.scripts().retainedOutputs?.viewer.text).toBe('current output');
      else expect(run.scripts().retainedOutputs?.viewer).toBeUndefined();
    },
  );

  it.each(['connection', 'authority', 'workspace'] as const)(
    'drops active hydration after %s invalidation',
    async (kind) => {
      const pending = deferred<{ view: string; scripts: ScriptWithState[] }>();
      transport.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? {
              server: {
                protocolVersion: CURRENT_PROTOCOL_VERSION,
                capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
              },
            }
          : pending.promise,
      );
      const run = start();
      run.dispatch(refreshScripts(WS));
      await settle();
      if (kind === 'connection') run.dispatch(backendReconnected());
      if (kind === 'authority') run.state.principal.status = 'loading';
      if (kind === 'workspace') run.dispatch(workspaceUnmounted(WS));
      pending.resolve({ view: 'summary', scripts: [row()] });
      await settle();
      expect(run.scripts().scripts[ID]).toBeUndefined();
    },
  );

  it('drops pre-reconnect output replies even when the backend ID is unchanged', async () => {
    const pending = deferred<string>();
    transport.request.mockReturnValue(pending.promise);
    const run = start();
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    run.dispatch(backendReconnected());
    pending.resolve('old connection output');
    await settle();
    expect(run.scripts().scripts[ID]).toBeUndefined();
    expect(run.scripts().retainedOutputs?.viewer.text).toBeUndefined();
    expect(listCalls()).toEqual([]);
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

it.each([true, false])(
  'does not reinsert an archived row when its page finishes last: %s',
  async (pageFinishesLast) => {
    const page = deferred<{ view: string; scripts: ScriptWithState[] }>();
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return {
          server: {
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            capabilities: { scriptActiveLists: 1 },
          },
        };
      if (method === 'script.list') return page.promise;
      if (method === 'script.output') return 'selected output';
      throw new Error('Unexpected method ' + method);
    });
    const run = start();
    run.dispatch(refreshScripts(WS));
    await settle();
    run.dispatch(scriptOutputRequested(WS, ID, 'viewer'));
    await settle();
    const finishPage = async () => {
      page.resolve({ view: 'summary', scripts: [row()] });
      await settle();
    };
    if (!pageFinishesLast) await finishPage();
    emit('script:changed', {
      scriptId: ID,
      action: 'updated',
      script: row({
        archivedAt: 'now',
        runtime: { status: 'exited', restartCount: 0, exitCode: 0 },
      }),
    });
    if (pageFinishesLast) await finishPage();
    await settle();
    expect(run.active()).toEqual([]);
    expect(run.scripts().scripts[ID]).toBeUndefined();
    expect(run.scripts().retainedOutputs?.viewer.text).toBe('selected output');
    expect(listCalls()).toHaveLength(1);
  },
);
