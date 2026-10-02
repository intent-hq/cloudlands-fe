import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: transport.request }));
vi.mock('$lib/client', async () => {
  const { LiveScriptsClient } = await import('$lib/client/live/live-scripts-client');
  return { appClient: { scripts: new LiveScriptsClient() } };
});
vi.mock('$features/scripts/scripts.client', () => ({ scriptsClient: {} }));
import { store } from '../../../store';
import { scriptsOperationSaga } from './scripts-operation-saga';
import { lifecycleReadSaga } from '../../workspace-lifecycle/sagas/lifecycle-read-saga';
import { selectScriptEntries, selectWorkspaceScriptEntries } from '../scripts-selectors';
import {
  scriptsReducer,
  setScriptsData,
  refreshScripts,
  appendScriptOutput,
  removeScript,
  updateRuntimeState,
  scriptOutputSnapshotReceived,
} from '../scripts-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { createDefaultRuntimeState } from '$features/scripts/types';
const WS = 'history-ws';
const ID = 'retired-failure';
const request = (token = 'viewer-1') => ({
  type: 'scripts/outputRequested',
  payload: [WS, ID, token],
});
const release = (token = 'viewer-1') => ({
  type: 'scripts/outputReleased',
  payload: [WS, ID, token],
});
const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function start(seedDefinition = true, includeLifecycle = false) {
  const channel = stdChannel();
  const state = withLegacyPrincipal({
    tabState: { currentTabId: WS },
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
    scripts: scriptsReducer(undefined, { type: '@@init' }),
  });
  state.scripts = scriptsReducer(
    state.scripts,
    setScriptsData(WS, [
      {
        id: ID,
        workspaceId: WS,
        name: 'Failed command',
        command: 'false',
        mode: 'command',
        source: 'user',
        createdAt: '2026-09-30T00:00:00Z',
        archivedAt: '2026-09-30T00:01:00Z',
        runtime: { ...createDefaultRuntimeState(), status: 'exited', exitCode: 1 },
      },
    ]),
  );
  if (!seedDefinition) state.scripts = scriptsReducer(undefined, { type: '@@init' });
  const actions: any[] = [];
  const dispatch = (a: any) => {
    state.scripts = scriptsReducer(state.scripts, a);
    actions.push(a);
    channel.put(a);
  };
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, scriptsOperationSaga));
  if (includeLifecycle)
    tasks.push(runSaga({ channel, dispatch, getState: () => state }, lifecycleReadSaga));
  const text = () =>
    state.scripts.byWorkspaceId[WS]?.outputBuffers[ID]?.chunks.map((c) => c.text).join('') ?? '';
  const retained = (viewerId = 'viewer-1') =>
    state.scripts.byWorkspaceId[WS]?.retainedOutputs?.[viewerId];
  return { state, dispatch, text, retained, actions };
}
beforeEach(() => {
  store.dispose();
  store.init();
  transport.request.mockReset();
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  store.dispose();
});
describe('retained script output hydration', () => {
  it.each([ID, 'second-script'])(
    'retains runtime for %s when the first viewer releases a shared definition read',
    async (targetId) => {
      const list = deferred<{ scripts: unknown[] }>();
      const runtime = { status: 'exited' as const, exitCode: 1, restartCount: 0 };
      transport.request.mockImplementation(async (method) => {
        if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
        if (method === 'script.list') return list.promise;
        return 'failure output';
      });
      const run = start(false);
      run.dispatch(request('first'));
      await settle();
      run.dispatch(updateRuntimeState(WS, targetId, runtime));
      run.dispatch({ ...request('second'), payload: [WS, targetId, 'second'] });
      await settle();
      run.dispatch(release('first'));
      list.resolve({
        scripts: [{ id: targetId, runtime: { status: 'running', restartCount: 0 } }],
      });
      await settle();
      expect(
        transport.request.mock.calls.filter(([method]) => method === 'script.list'),
      ).toHaveLength(1);
      expect(run.retained('first')).toBeUndefined();
      expect(run.retained('second')?.text).toBe('failure output');
      expect(run.state.scripts.byWorkspaceId[WS].scripts[targetId].runtime).toMatchObject(runtime);
    },
  );

  it('starts a fresh definition read after all viewers release the old read', async () => {
    const stale = deferred<{ scripts: unknown[] }>();
    const fresh = deferred<{ scripts: unknown[] }>();
    let lists = 0;
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list') return ++lists === 1 ? stale.promise : fresh.promise;
      return 'new output';
    });
    const run = start(false);
    run.dispatch(request('old'));
    await settle();
    run.dispatch(release('old'));
    run.dispatch(updateRuntimeState(WS, ID, { status: 'exited', exitCode: 1 }));
    run.dispatch(request('fresh'));
    await settle();
    expect(lists).toBe(2);
    fresh.resolve({
      scripts: [{ id: ID, runtime: { status: 'exited', exitCode: 1, restartCount: 0 } }],
    });
    await settle();
    stale.resolve({ scripts: [{ id: ID, runtime: { status: 'running', restartCount: 0 } }] });
    await settle();
    expect(run.retained('fresh')?.text).toBe('new output');
    expect(run.state.scripts.byWorkspaceId[WS].scripts[ID].runtime.status).toBe('exited');
  });

  it.each([
    {
      status: 'exited' as const,
      startedAt: 'earlier',
      stoppedAt: 'now',
      exitCode: 1,
      restartCount: 0,
    },
    { status: 'running' as const, startedAt: 'new run', restartCount: 1 },
  ])('preserves a $status event arriving before a demand-loaded definition', async (runtime) => {
    const all = deferred<{ scripts: unknown[] }>();
    const run = start(false, true);
    transport.request.mockImplementation(async (method, params) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list')
        return (params as { archive: string }).archive === 'all' ? all.promise : { scripts: [] };
      if (method === 'script.status') return runtime;
      if (method === 'script.output') return 'current output';
      throw new Error('Unexpected method ' + method);
    });
    run.dispatch(request());
    await settle();
    run.dispatch(updateRuntimeState(WS, ID, runtime));
    run.dispatch(refreshScripts(WS));
    await settle();
    expect(run.state.scripts.byWorkspaceId[WS].activeScriptIds).toEqual([]);
    all.resolve({
      scripts: [
        {
          id: ID,
          workspaceId: WS,
          name: 'One-off output',
          command: 'false',
          mode: 'command',
          purpose: 'oneOff',
          source: 'user',
          createdAt: '2026-09-30T00:00:00Z',
          runtime: { status: 'running', startedAt: 'earlier', restartCount: 0 },
        },
      ],
    });
    await settle();
    expect(run.state.scripts.byWorkspaceId[WS].scripts[ID].runtime).toMatchObject(runtime);
    expect(run.retained()?.text).toBe('current output');
    expect(transport.request.mock.calls.filter(([method]) => method === 'script.list')).toEqual([
      ['script.list', { workspaceId: WS, archive: 'all' }],
      ['script.list', { workspaceId: WS, archive: 'active' }],
    ]);
  });

  it('keeps recovered output out of initial membership until an authoritative list includes it', async () => {
    const definition = {
      id: ID,
      workspaceId: WS,
      name: 'Retired command',
      command: 'false',
      mode: 'command' as const,
      source: 'user' as const,
      createdAt: '2026-09-30T00:00:00Z',
      archivedAt: '2026-09-30T00:01:00Z',
      runtime: { status: 'exited' as const, exitCode: 1, restartCount: 0 },
    };
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list') return { scripts: [definition] };
      return 'retained output';
    });
    const run = start(false);
    run.dispatch(request());
    await settle();
    expect(run.retained()?.text).toBe('retained output');
    expect(selectWorkspaceScriptEntries.select(run.state as never, WS)).toEqual([]);
    expect(selectScriptEntries.select(run.state as never, WS)).toEqual([]);
    const saved = { ...definition, id: 'saved', archivedAt: undefined };
    run.dispatch(setScriptsData(WS, [saved]));
    expect(selectWorkspaceScriptEntries.select(run.state as never, WS)).toEqual([saved]);
    expect(selectScriptEntries.select(run.state as never, WS)).toEqual([saved]);
  });

  it('recovers only mounted archived output definitions and coalesces concurrent reads', async () => {
    const list = deferred<{ scripts: unknown[] }>();
    const run = start(false);
    const archived = {
      id: ID,
      workspaceId: WS,
      name: 'Retired command',
      command: 'false',
      mode: 'command',
      source: 'user',
      createdAt: '2026-09-30T00:00:00Z',
      archivedAt: '2026-09-30T00:01:00Z',
      runtime: { status: 'exited', exitCode: 1, restartCount: 0 },
    };
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list') return list.promise;
      if (method === 'script.output') return 'retained failure';
      throw new Error('Unexpected mutation');
    });
    run.dispatch(request('a'));
    run.dispatch(request('b'));
    await settle();
    expect(transport.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['script.list', { workspaceId: WS, archive: 'all' }],
    ]);
    list.resolve({ scripts: [archived, { ...archived, id: 'unopened' }] });
    await settle();
    expect(Object.keys(run.state.scripts.byWorkspaceId[WS].scripts)).toEqual([ID]);
    expect(run.retained('a')?.text).toBe('retained failure');
    expect(run.retained('b')?.text).toBe('retained failure');
    run.dispatch(request('reopen'));
    await settle();
    expect(
      transport.request.mock.calls.filter(([method]) => method === 'script.list'),
    ).toHaveLength(1);
    expect(run.retained('reopen')?.text).toBe('retained failure');
  });

  it.each(['viewer', 'workspace', 'removed', 'authority', 'backend', 'store'] as const)(
    'does not recover a definition after %s invalidation',
    async (kind) => {
      const pending = deferred<{ scripts: unknown[] }>();
      transport.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? { server: { capabilities: { scriptLifecycle: 1 } } }
          : pending.promise,
      );
      const run = start(false);
      run.dispatch(request());
      await settle();
      run.dispatch(updateRuntimeState(WS, ID, { status: 'exited', exitCode: 1 }));
      if (kind === 'viewer') run.dispatch(release());
      if (kind === 'workspace') run.dispatch(workspaceUnmounted(WS));
      if (kind === 'removed') run.dispatch(removeScript(WS, ID));
      if (kind === 'authority') run.state.principal.status = 'loading';
      if (kind === 'backend') run.state.connections.windowBackendId = 'replacement';
      if (kind === 'store') {
        store.dispose();
        store.init();
      }
      pending.resolve({ scripts: [{ id: ID, runtime: { status: 'idle', restartCount: 0 } }] });
      await settle();
      expect(run.state.scripts.byWorkspaceId[WS]?.scripts[ID]).toBeUndefined();
      expect(transport.request.mock.calls.map(([method]) => method)).toEqual([
        'client.hello',
        'script.list',
      ]);
      expect(run.retained()?.status).not.toBe('available');
    },
  );

  it('keeps a missing or failed recovery unavailable and permits a later retry', async () => {
    const run = start(false);
    transport.request.mockRejectedValueOnce(new Error('offline'));
    run.dispatch(request());
    await settle();
    expect(run.retained()?.status).toBe('unavailable');
    transport.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      if (method === 'script.list') return { scripts: [] };
      return 'No output yet.';
    });
    run.dispatch(request('retry'));
    await settle();
    expect(run.retained('retry')?.status).toBe('unavailable');
    expect(run.state.scripts.byWorkspaceId[WS].scripts).toEqual({});
  });

  it('reads an archived command after reload without restoring or rerunning it', async () => {
    transport.request.mockResolvedValue('[2 lines]\nFAILURE-RETAINED-OUTPUT\r\n');
    const run = start();
    run.dispatch(request());
    await settle();
    expect(transport.request.mock.calls).toEqual([
      ['script.output', { workspaceId: WS, scriptId: ID, maxLines: 10_000 }],
    ]);
    expect(run.text()).toBe('');
    expect(run.retained()).toMatchObject({
      status: 'available',
      text: '[2 lines]\nFAILURE-RETAINED-OUTPUT\r\n',
    });
    expect(run.state.scripts.byWorkspaceId[WS].scripts[ID].archivedAt).toBeTruthy();
  });
  it('keeps the formatted snapshot separate when stream events race the read', async () => {
    const first = deferred<string>();
    transport.request.mockReturnValueOnce(first.promise);
    const run = start();
    run.dispatch(request());
    await settle();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'new\r\n', timestamp: 'now' }));
    first.resolve('[2 lines]\nold\r\n');
    await settle();
    expect(run.text()).toBe('new\r\n');
    expect(run.retained()?.text).toBe('[2 lines]\nold\r\n');
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
  it('preserves existing buffers when retained output is empty or unavailable', async () => {
    const run = start();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'already visible', timestamp: 'now' }));
    transport.request.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('offline'));
    run.dispatch(request());
    await settle();
    expect(run.text()).toBe('already visible');
    run.dispatch(request('retry'));
    await settle();
    expect(run.text()).toBe('already visible');
  });
  it.each(['viewer', 'workspace', 'removed', 'authority', 'backend', 'store', 'run'] as const)(
    'drops late output after %s invalidation',
    async (kind) => {
      const pending = deferred<string>();
      transport.request.mockReturnValue(pending.promise);
      const run = start();
      run.dispatch(request());
      await settle();
      if (kind === 'viewer') run.dispatch(release());
      if (kind === 'workspace') run.dispatch(workspaceUnmounted(WS));
      if (kind === 'removed') run.dispatch(removeScript(WS, ID));
      if (kind === 'run')
        run.dispatch(updateRuntimeState(WS, ID, { status: 'starting', startedAt: 'replacement' }));
      if (kind === 'authority') run.state.principal.status = 'loading';
      if (kind === 'backend') run.state.connections.windowBackendId = 'replacement';
      if (kind === 'store') {
        store.dispose();
        store.init();
      }
      pending.resolve('stale secret');
      await settle();
      expect(run.text()).toBe('');
      expect(run.retained()?.status).not.toBe('available');
      expect(run.actions.some((a) => a.type === 'scripts/outputSnapshotReceived')).toBe(false);
      expect(transport.request).toHaveBeenCalledTimes(1);
    },
  );
  it('a released old viewer cannot cancel or overwrite a replacement viewer', async () => {
    const old = deferred<string>(),
      fresh = deferred<string>();
    transport.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const run = start();
    run.dispatch(request());
    await settle();
    run.dispatch(release());
    run.dispatch(request('viewer-2'));
    await settle();
    fresh.resolve('current');
    await settle();
    old.resolve('obsolete');
    await settle();
    expect(run.text()).toBe('');
    expect(run.retained('viewer-2')?.text).toBe('current');
    expect(run.retained()).toBeUndefined();
  });
  it('isolates concurrent viewers and never merges snapshots with stream bytes', async () => {
    const first = deferred<string>(),
      second = deferred<string>();
    transport.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const run = start();
    run.dispatch(request('a'));
    run.dispatch(request('b'));
    await settle();
    first.resolve('[1 lines]\nretained-a');
    second.resolve('[1 lines]\nretained-b');
    await settle();
    expect(run.retained('a')?.text).toBe('[1 lines]\nretained-a');
    expect(run.retained('b')?.text).toBe('[1 lines]\nretained-b');
    run.dispatch(release('a'));
    expect(run.retained('a')).toBeUndefined();
    expect(run.retained('b')?.text).toBe('[1 lines]\nretained-b');
    run.dispatch(appendScriptOutput(WS, ID, { text: ' live', timestamp: 'now' }));
    expect(run.text()).toBe(' live');
  });
  it('rejects late snapshot publication for a released viewer without touching its replacement', () => {
    const run = start();
    run.dispatch(request('old'));
    run.dispatch(release('old'));
    run.dispatch(request('new'));
    run.dispatch(scriptOutputSnapshotReceived(WS, ID, 'old', 'stale'));
    expect(run.retained('old')).toBeUndefined();
    expect(run.retained('new')?.status).toBe('loading');
    expect(run.text()).toBe('');
  });
  it('preserves a richer local buffer when the daemon returns a formatted tail', async () => {
    const raw = Array.from({ length: 160 }, (_, i) => `line-${i}`).join('\n');
    transport.request.mockResolvedValue(
      '[showing last 100 of 160 lines]\n' + raw.split('\n').slice(-100).join('\n'),
    );
    const run = start();
    run.dispatch(appendScriptOutput(WS, ID, { text: raw, timestamp: 'now' }));
    run.dispatch(request());
    await settle();
    expect(run.text()).toBe(raw);
    expect(run.retained()?.text).toContain('[showing last 100 of 160 lines]');
  });
  it('preserves local bytes when daemon scrollback has expired', async () => {
    transport.request.mockResolvedValue('No output yet.');
    const run = start();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'local bytes', timestamp: 'now' }));
    run.dispatch(request());
    await settle();
    expect(run.text()).toBe('local bytes');
    expect(run.retained()).toEqual({ scriptId: ID, status: 'unavailable' });
  });
  it('keeps delayed fanout separate from a snapshot containing those bytes', async () => {
    transport.request.mockResolvedValue('[2 lines]\nlast-chunk\n');
    const run = start();
    run.dispatch(request());
    await settle();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'last-chunk\n', timestamp: 'late' }));
    expect(run.text()).toBe('last-chunk\n');
    run.dispatch(appendScriptOutput(WS, ID, { text: 'last-chunk\n', timestamp: 'repeat' }));
    expect(run.text()).toBe('last-chunk\nlast-chunk\n');
  });
  it('treats a sentinel inside real formatted output as genuine script text', async () => {
    transport.request.mockResolvedValue('[1 lines]\nNo output yet.');
    const run = start();
    run.dispatch(request());
    await settle();
    expect(run.retained()).toMatchObject({
      status: 'available',
      text: '[1 lines]\nNo output yet.',
    });
    expect(run.text()).toBe('');
  });
  it('does not request output without current workspace authority', async () => {
    const run = start();
    run.state.principal.status = 'loading';
    run.dispatch(request());
    await settle();
    expect(transport.request).not.toHaveBeenCalled();
  });
});
