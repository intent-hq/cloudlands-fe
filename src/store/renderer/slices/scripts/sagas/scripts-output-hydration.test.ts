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
import {
  scriptsReducer,
  setScriptsData,
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
function start() {
  const channel = stdChannel();
  const state = withLegacyPrincipal({
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
  const actions: any[] = [];
  const dispatch = (a: any) => {
    state.scripts = scriptsReducer(state.scripts, a);
    actions.push(a);
    channel.put(a);
  };
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, scriptsOperationSaga));
  const text = () =>
    state.scripts.byWorkspaceId[WS]?.outputBuffers[ID]?.chunks.map((c) => c.text).join('') ?? '';
  return { state, dispatch, text, actions };
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
  it('reads an archived command after reload without restoring or rerunning it', async () => {
    transport.request.mockResolvedValue('FAILURE-RETAINED-OUTPUT\r\n');
    const run = start();
    run.dispatch(request());
    await settle();
    expect(transport.request.mock.calls).toEqual([
      ['script.output', { workspaceId: WS, scriptId: ID }],
    ]);
    expect(run.text()).toBe('FAILURE-RETAINED-OUTPUT\r\n');
    expect(run.state.scripts.byWorkspaceId[WS].scripts[ID].archivedAt).toBeTruthy();
  });
  it('discards a snapshot raced by stream data, then retries without duplicate text', async () => {
    const first = deferred<string>();
    transport.request.mockReturnValueOnce(first.promise).mockResolvedValue('old\r\nnew\r\n');
    const run = start();
    run.dispatch(request());
    await settle();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'new\r\n', timestamp: 'now' }));
    first.resolve('old\r\n');
    await settle();
    expect(run.text()).toBe('new\r\n');
    await vi.waitFor(() => expect(run.text()).toBe('old\r\nnew\r\n'));
    expect(transport.request).toHaveBeenCalledTimes(2);
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
    expect(run.text()).toBe('current');
  });
  it('deduplicates concurrent viewer snapshots and later streams append once', async () => {
    const first = deferred<string>(),
      second = deferred<string>();
    transport.request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue('retained');
    const run = start();
    run.dispatch(request('a'));
    run.dispatch(request('b'));
    await settle();
    first.resolve('retained');
    second.resolve('retained');
    await settle();
    await vi.waitFor(() => expect(run.text()).toBe('retained'));
    run.dispatch(appendScriptOutput(WS, ID, { text: ' live', timestamp: 'now' }));
    expect(run.text()).toBe('retained live');
  });
  it('rejects a stale snapshot at reducer publication after intervening stream output', () => {
    const run = start();
    run.dispatch(appendScriptOutput(WS, ID, { text: 'fresh', timestamp: 'now' }));
    run.dispatch(scriptOutputSnapshotReceived(WS, ID, 'stale', 0, 0, 'before'));
    expect(run.text()).toBe('fresh');
  });
  it('does not request output without current workspace authority', async () => {
    const run = start();
    run.state.principal.status = 'loading';
    run.dispatch(request());
    await settle();
    expect(transport.request).not.toHaveBeenCalled();
  });
});
