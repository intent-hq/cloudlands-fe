import { trackWorktreeSnapshotRead } from './worktree-read-lane';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  fileTrackingReducer,
  setChangesData,
  setCommitsData,
} from '$store/renderer/slices/changes/changes-slice';
import { registerChangesRecovery, changesRecoveryKey } from './changes-event-recovery';

const gitStatus = {
  branch: 'main',
  isGitRepo: true,
  files: [{ path: 'new.ts', status: 'modified', staged: false }],
  ahead: 0,
  behind: 0,
};
function setup(identity: string | undefined, loaded = 'old') {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (n: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'accept-changes.getStatus') return { historyIdentity: identity, gitStatus };
    if (method === 'git.status') return gitStatus;
    if (method === 'file-tracking.getChanges') return { changes: [] };
    if (method === 'file-tracking.loadCommits')
      return {
        commits: [{ hash: 'new', message: 'recovered' }],
        boundarySha: 'boundary',
        historyIdentity: identity,
      };
    throw new Error(method);
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (callback) => {
      emit = callback;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {},
  });
  let state = fileTrackingReducer(undefined, setChangesData('ws', [], false, 0));
  state = fileTrackingReducer(
    state,
    setCommitsData(
      'ws',
      [{ hash: 'old', message: 'old', author: '', timestamp: 0, stage: 'local', isPushed: false }],
      null,
    ),
  );
  const registry = new RendererEventRecovery(),
    scope = registry.attach(session);
  let active = true,
    current = true;
  const handle = registerChangesRecovery(scope, 'ws', {
    isCurrent: () => current,
    demand: () => ({ files: active, history: active }),
    loadedHistoryIdentity: () => loaded,
    retired: () => {
      loaded = '';
    },
    invalidate: () => {},
    applied: (snapshot) => {
      loaded = snapshot.history?.historyIdentity ?? snapshot.historyIdentity ?? '';
    },
    dispatch: (action) => {
      state = fileTrackingReducer(state, action);
    },
  });
  return {
    registry,
    scope,
    request,
    handle,
    identity: () => loaded,
    state: () => state,
    emit: (n: RecoveryNotification) => emit(n),
    setActive: (value: boolean) => {
      active = value;
      handle.setActive(value);
    },
    retire: () => {
      current = false;
      registry.capture(changesRecoveryKey('ws')).commit(() => undefined);
    },
  };
}
async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
const lost = {
  method: 'events.lost',
  params: { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } },
};
afterEach(() => vi.useRealTimers());
describe('Changes store final-event recovery', () => {
  it('waits for an older ordinary Changes read before requesting the recovery snapshot', async () => {
    const h = setup('new');
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    let release!: () => void;
    const ordinary = trackWorktreeSnapshotRead(
      changesRecoveryKey('ws'),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    h.emit(lost);
    await settle();
    expect(h.request.mock.calls.filter(([method]) => !method.startsWith('events.'))).toHaveLength(
      0,
    );
    release();
    await ordinary;
    await settle();
    expect(h.state().byWorkspaceId.ws.changes.map((row) => row.relativePath)).toEqual(['new.ts']);
    expect(
      h.request.mock.calls.filter(([method]) => method === 'file-tracking.getChanges'),
    ).toHaveLength(1);
    h.registry.dispose();
  });

  it.each(['new', undefined])(
    'recovers final file membership and changed/absent history identity %s without another event',
    async (identity) => {
      const h = setup(identity);
      await h.scope.subscribe(
        { workspaceId: 'ws', eventTypes: ['file:*', 'git:*'] },
        { recover: true },
      );
      const old = h.registry.capture(changesRecoveryKey('ws'));
      h.emit(lost);
      await settle();
      expect(h.state().byWorkspaceId.ws.changes.map((row) => row.relativePath)).toEqual(['new.ts']);
      expect(h.state().byWorkspaceId.ws.commits.map((row) => row.hash)).toEqual(['new']);
      expect(
        old.commit(() => {
          throw new Error('stale commit');
        }),
      ).toBe(false);
      expect(h.request.mock.calls.map(([method]) => method)).toEqual([
        'events.subscribe',
        'events.fence',
        'accept-changes.getStatus',
        'file-tracking.getChanges',
        'file-tracking.loadCommits',
        'events.fence',
      ]);
      h.retire();
      expect(h.state().byWorkspaceId.ws).toBeUndefined();
      expect(h.identity()).toBe('');
      h.registry.dispose();
    },
  );
  it('keeps proven immutable history and reads no commits for unchanged identity', async () => {
    const h = setup('old');
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.emit(lost);
    await settle();
    expect(h.state().byWorkspaceId.ws.commits.map((row) => row.hash)).toEqual(['old']);
    expect(h.request.mock.calls.map(([method]) => method)).toEqual([
      'events.subscribe',
      'events.fence',
      'accept-changes.getStatus',
      'file-tracking.getChanges',
      'events.fence',
    ]);
    h.registry.dispose();
  });
  it('defers inactive reads and rejects delayed published payloads after recovery', async () => {
    const h = setup('new');
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.setActive(false);
    h.emit(lost);
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
    h.setActive(true);
    await settle();
    expect(h.state().byWorkspaceId.ws.commits[0].hash).toBe('new');
    expect(h.registry.push(changesRecoveryKey('ws'))).toBe(false);
    expect(
      h.registry.capture(changesRecoveryKey('ws')).commit(() => {
        throw new Error('delayed old payload');
      }),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.request.mock.calls.filter(([m]) => m === 'file-tracking.getChanges')).toHaveLength(2);
    expect(h.request.mock.calls.filter(([m]) => m === 'file-tracking.loadCommits')).toHaveLength(1);
    h.registry.dispose();
  });
});
