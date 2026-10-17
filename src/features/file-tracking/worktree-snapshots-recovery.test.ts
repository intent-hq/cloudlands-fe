import { trackWorktreeSnapshotRead } from './worktree-read-lane';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: { select: (s: any) => s.tabState.currentTabId },
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (s: any) => s.authority },
  selectHostRole: { select: (s: any) => s.role },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (s: any, id: string) => (s.exists && id === 'ws' ? { id } : undefined),
  },
  selectWorkspaceListLoadedForBackend: { select: () => true },
}));
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  agentLockReducer,
  setAgentLockState,
} from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { gitReducer } from '$store/renderer/slices/git/git-slice';
import { installWorktreeSnapshotsRecovery } from './worktree-snapshots-recovery';
import { agentLocksRecoveryKey } from './worktree-recovery-keys';

async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (event: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: 'global', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'file-tracking.getAgentLocks')
      return { lockedAgentIds: ['new'], lockedFilePaths: ['new.ts'] };
    if (method === 'git.status')
      return {
        branch: 'new',
        ahead: 0,
        behind: 0,
        files: [{ path: 'new.ts', status: 'modified', staged: true }],
      };
    throw new Error(method);
  });
  const registry = new RendererEventRecovery();
  const scope = registry.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      request: async (method, params, observe) => {
        const result = await request(method, params);
        observe?.(result);
        return result;
      },
      onNotification: (fn) => {
        emit = fn;
        return () => {};
      },
      onRetired: () => () => {},
      dispose: () => {},
    }),
  );
  let state: any = {
    authority: 'a',
    role: 'owner',
    exists: true,
    connections: { windowBackendId: 'local' },
    workspace: { capabilityContext: 'a', deletionTokens: {} },
    tabState: { currentTabId: 'ws' },
    agentLock: agentLockReducer(undefined, setAgentLockState('ws', { old: true }, {})),
    git: gitReducer.initialState,
  };
  let changed = () => {};
  const stop = installWorktreeSnapshotsRecovery(scope, {
    getState: () => state,
    subscribe: (fn) => {
      changed = fn;
      return () => {
        changed = () => {};
      };
    },
    dispatch: (action) => {
      state = {
        ...state,
        agentLock: agentLockReducer(state.agentLock, action),
        git: gitReducer(state.git, action),
      };
      changed();
    },
  });
  await scope.subscribe({ eventTypes: ['*'] }, { recover: true });
  return {
    registry,
    request,
    stop,
    state: () => state,
    emit: (event: RecoveryNotification) => emit(event),
    change: (patch: any) => {
      state = { ...state, ...patch };
      changed();
    },
  };
}
async function settle() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
const lost = {
  method: 'events.lost',
  params: { subscriptionId: 'global', generation: '1', scope: { workspaceId: null } },
};
afterEach(() => vi.useRealTimers());
describe('active worktree snapshots', () => {
  it('recovers final locks and Git status and retires state across caller ABA', async () => {
    const h = await setup();
    const old = h.registry.capture(agentLocksRecoveryKey('ws'));
    h.emit(lost);
    await settle();
    expect(h.state().agentLock.byWorkspaceId.ws.lockedAgentIds).toEqual({ new: true });
    expect(h.state().git.byWorkspaceId.ws.status.files[0].path).toBe('new.ts');
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(4);
    expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([m]) => m === 'file-tracking.getAgentLocks')).toHaveLength(
      1,
    );
    expect(
      old.commit(() => {
        throw new Error('old');
      }),
    ).toBe(false);
    h.change({ authority: 'b' });
    expect(h.state().agentLock.byWorkspaceId.ws.lockedAgentIds).toEqual({});
    expect(h.state().git.byWorkspaceId.ws.status).toBeNull();
    h.change({ authority: 'a' });
    expect(old.commit(() => undefined)).toBe(false);
    expect(h.registry.capture(agentLocksRecoveryKey('ws')).commit(() => undefined)).toBe(false);
    h.stop();
    h.registry.dispose();
  });
  it('waits for a held ordinary lock read before one loss recovery read', async () => {
    const h = await setup();
    let release!: () => void;
    const ordinary = trackWorktreeSnapshotRead(
      agentLocksRecoveryKey('ws'),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    h.emit(lost);
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'file-tracking.getAgentLocks')).toHaveLength(
      0,
    );
    release();
    await ordinary;
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'file-tracking.getAgentLocks')).toHaveLength(
      1,
    );
    expect(h.state().agentLock.byWorkspaceId.ws.lockedAgentIds).toEqual({ new: true });
    h.stop();
    h.registry.dispose();
  });
  it('defers an inactive workspace until selection and never reads after removal', async () => {
    const h = await setup();
    h.change({ tabState: { currentTabId: null } });
    h.emit(lost);
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
    h.change({ tabState: { currentTabId: 'ws' } });
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toHaveLength(1);
    h.change({ exists: false });
    h.emit({ ...lost, params: { ...lost.params, generation: '2' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toHaveLength(1);
    h.stop();
    h.registry.dispose();
  });
});
