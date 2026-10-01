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
