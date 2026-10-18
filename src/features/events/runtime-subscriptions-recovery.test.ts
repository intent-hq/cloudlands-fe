import { BackendError } from '$lib/client/live/backend-transport-types';
import {
  subscribeScriptMonitors,
  type ScriptMonitorSnapshot,
} from '$features/script-monitor/script-monitor-service';
import {
  monitorSummaryFixture,
  monitorFixture,
  scriptFixture,
} from '$features/script-monitor/script-monitor.fixture';
import { runSaga, stdChannel } from 'redux-saga';
import { backgroundHooksSaga } from '$store/renderer/slices/background-hooks/sagas/background-hooks-saga';
import {
  backgroundHooksReducer,
  backgroundHooksSubscribeRequested,
  backgroundHooksRefetchRequested,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';
import { tabStateReducer } from '$store/renderer/slices/tab-state/tab-state-slice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';
import { rendererEventRecovery } from './renderer-event-recovery';
import { trackRuntimeRead } from './runtime-read-lane';
import { subscribeGitRoots, type GitRootRow } from '$features/git-roots/git-roots-service';
import { subscribePrMonitors, type PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';

const legacy = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: legacy.request,
  backendSubscribe: legacy.subscribe,
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
const root: GitRootRow = {
  id: 'root',
  workspaceId: 'ws',
  path: '/repo',
  source: 'agent',
  branch: 'main',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const monitor: PrMonitorRow = {
  monitorId: 'monitor',
  workspaceId: 'ws',
  agentId: 'agent',
  repo: 'owner/repo',
  prNumber: 1,
  state: 'active',
  pendingChanges: [],
  hasPendingChanges: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const hook = {
  hookId: 'hook',
  workspaceId: 'ws',
  agentId: 'agent',
  name: 'watch',
  state: 'scheduled',
  createdAt: '2026-10-01T00:00:00Z',
  runCount: 1,
  code: 'return true',
  lastLogs: 'ok',
};
function subscribeHooks(emit: (rows: unknown[]) => void) {
  let state = {
    backgroundHooks: backgroundHooksReducer(undefined, { type: '@@INIT' }),
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
  };
  const channel = stdChannel();
  const dispatch = (action: { type: string; payload?: unknown }) => {
    state = { ...state, backgroundHooks: backgroundHooksReducer(state.backgroundHooks, action) };
    channel.put(action);
    emit(Object.values(state.backgroundHooks.byWorkspaceId.ws?.hooks.map ?? {}));
    return action;
  };
  const reduxStore = { getState: () => state, dispatch, subscribe: () => () => {} };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    backgroundHooksSaga,
  );
  dispatch(backgroundHooksSubscribeRequested('ws'));
  return {
    dispose: () => task.cancel(),
    refetch: () => dispatch(backgroundHooksRefetchRequested('ws')),
  };
}
const cases = [
  {
    name: 'background hooks',
    key: 'background-hooks:' + JSON.stringify(['ws']),
    method: 'hook.list',
    field: 'hooks',
    row: hook,
    event: 'hook:cancelled',
    data: { hookId: 'hook' },
    subscribe: subscribeHooks,
  },
  {
    name: 'git roots',
    key: 'git-roots:' + JSON.stringify(['ws']),
    method: 'gitRoot.list',
    field: 'gitRoots',
    row: root,
    event: 'gitRoot:unregistered',
    data: { gitRootId: 'root' },
    subscribe: (emit: (rows: unknown[]) => void) => subscribeGitRoots('ws', emit),
  },
  {
    name: 'PR monitors',
    key: 'pr-monitors:' + JSON.stringify(['ws']),
    method: 'prMonitor.list',
    field: 'monitors',
    row: monitor,
    event: 'prMonitor:cancelled',
    data: { monitorId: 'monitor' },
    subscribe: (emit: (rows: unknown[]) => void) => subscribePrMonitors('ws', emit),
  },
];
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function session() {
  const handlers = new Set<(n: RecoveryNotification) => void | Promise<void>>();
  const retirees = new Set<() => void>();
  let current = true;
  let serial = 0;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> =>
    method === 'events.subscribe' ? { subscriptionId: `lease-${++serial}`, lossRecovery: 1 } : {},
  );
  const fence = vi.fn(async (_ids, observe: () => void) => observe());
  const captured: EventRecoverySession = {
    supported: true,
    isCurrent: () => current,
    onNotification: (fn) => {
      handlers.add(fn);
      return () => {
        handlers.delete(fn);
      };
    },
    onRetired: (fn) => {
      retirees.add(fn);
      return () => {
        retirees.delete(fn);
      };
    },
    request: request as EventRecoverySession['request'],
    fence,
    dispose: () => {},
  };
  const scope = rendererEventRecovery.attach(captured);
  return {
    scope,
    request,
    fence,
    emit: (n: RecoveryNotification) => {
      for (const fn of handlers) void fn(n);
    },
    retire: () => {
      current = false;
      for (const fn of [...retirees]) fn();
    },
  };
}
const loss = (generation = '1') => ({
  method: 'events.lost',
  params: { subscriptionId: 'lease-1', generation, scope: { workspaceId: 'ws' } },
});
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  rendererEventRecovery.dispose();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe.each(cases)('$name generic loss recovery', (c) => {
  it('replaces a lost final event from authority and rejects delayed unversioned deletion', async () => {
    vi.useFakeTimers();
    const h = session();
    let authoritative = [c.row];
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-1', lossRecovery: 1 }
        : { [c.field]: authoritative },
    );
    legacy.request.mockResolvedValue({ [c.field]: [c.row] });
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    let state: unknown[] = [];
    dispose = c.subscribe((rows) => {
      state = rows;
    }).dispose;
    await settle();
    expect(state).toEqual([c.row]);
    authoritative = [];
    h.emit(loss());
    await settle();
    expect(state).toEqual([]);
    expect(h.fence).toHaveBeenCalledTimes(2);
    const before = h.request.mock.calls.filter(([m]) => m === c.method).length;
    h.emit(loss());
    await vi.advanceTimersByTimeAsync(250);
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(before);
    authoritative = [c.row];
    h.emit(loss('2'));
    await vi.advanceTimersByTimeAsync(250);
    expect(state).toEqual([c.row]);
    h.emit({
      method: 'events.event',
      params: {
        subscriptionId: 'lease-1',
        event: { workspaceId: 'ws', type: c.event, data: c.data },
      },
    });
    expect(state).toEqual([c.row]);
    await vi.advanceTimersByTimeAsync(250);
    expect(state).toEqual([c.row]);
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(before + 2);
  });
  it('coalesces repeated loss and explicit refresh behind a held ordinary read', async () => {
    vi.useFakeTimers();
    const h = session();
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-1', lossRecovery: 1 }
        : { [c.field]: [c.row] },
    );
    legacy.request.mockResolvedValue({ [c.field]: [c.row] });
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    let state: unknown[] = [];
    const subscription = c.subscribe((rows) => {
      state = rows;
    });
    dispose = subscription.dispose;
    await settle();
    let release!: (value: unknown) => void;
    h.request.mockClear();
    h.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    subscription.refetch();
    await settle();
    h.emit(loss());
    h.emit(loss('2'));
    subscription.refetch();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(1);
    release({ [c.field]: [] });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(state).toEqual([c.row]);
    expect(h.request.mock.calls.filter(([m]) => m === c.method).length).toBeLessThanOrEqual(3);
  });
  it('clears protected rows on retirement and rejects a held recovery reply', async () => {
    vi.useFakeTimers();
    const h = session();
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-1', lossRecovery: 1 }
        : { [c.field]: [c.row] },
    );
    legacy.request.mockResolvedValue({ [c.field]: [c.row] });
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    let state: unknown[] = [];
    dispose = c.subscribe((rows) => {
      state = rows;
    }).dispose;
    await settle();
    let release!: (value: unknown) => void;
    h.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    h.emit(loss());
    await settle();
    h.retire();
    expect(state).toEqual([]);
    release({ [c.field]: [c.row] });
    await settle();
    expect(state).toEqual([]);
  });
});

describe('script monitor recovery', () => {
  it('coalesces loss behind a held seed and rejects a response after retirement', async () => {
    vi.useFakeTimers();
    const h = session();
    const ws = monitorFixture.workspaceId;
    let finish!: (value: unknown) => void;
    let listReads = 0;
    h.request.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return { server: { protocolVersion: '14.0', capabilities: { scriptMonitors: 2 } } };
      if (method === 'events.subscribe') return { subscriptionId: 'lease-1', lossRecovery: 1 };
      if (method === 'scriptMonitor.list') {
        listReads++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return {};
    });
    let state!: ScriptMonitorSnapshot;
    dispose = subscribeScriptMonitors(ws, (value) => {
      state = value;
    }).dispose;
    await settle();
    expect(listReads).toBe(1);
    const lost = {
      method: 'events.lost',
      params: { subscriptionId: 'lease-1', generation: '1', scope: { workspaceId: ws } },
    };
    h.emit(lost);
    h.emit(lost);
    await settle();
    expect(listReads).toBe(1);
    finish({ view: 'summary', monitors: [monitorSummaryFixture] });
    await settle();
    expect(listReads).toBe(2);
    expect(state.monitors).toEqual([]);
    h.retire();
    expect(state.status).toBe('loading');
    finish({ view: 'summary', monitors: [monitorSummaryFixture] });
    await settle();
    expect(state.monitors).toEqual([]);
    expect(listReads).toBe(2);
  });

  it('restores only loaded pages and requested details without output replay', async () => {
    vi.useFakeTimers();
    const h = session();
    const ws = monitorFixture.workspaceId;
    const second = { ...monitorSummaryFixture, monitorId: 'second', scriptId: 'other' };
    let revision = 1;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'client.hello')
        return {
          server: {
            protocolVersion: '14.0',
            capabilities: { scriptMonitors: 2, scriptActiveLists: 1 },
          },
        };
      if (method === 'events.subscribe') return { subscriptionId: 'lease-1', lossRecovery: 1 };
      if (method === 'scriptMonitor.list')
        return (params as { cursor?: string }).cursor
          ? { view: 'summary', monitors: [second] }
          : {
              view: 'summary',
              monitors: [{ ...monitorSummaryFixture, lineCount: revision }],
              nextCursor: 'next',
            };
      if (method === 'scriptMonitor.get') return { ...monitorFixture, lineCount: revision };
      if (method === 'script.get') return { ...scriptFixture, command: `command-${revision}` };
      return {};
    });
    legacy.request.mockImplementation(h.request);
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    let state!: ScriptMonitorSnapshot;
    const subscription = subscribeScriptMonitors(ws, (value) => {
      state = value;
    });
    dispose = subscription.dispose;
    await settle();
    await subscription.loadMore();
    await subscription.details(monitorFixture.monitorId);
    expect(state.monitors).toHaveLength(2);
    h.request.mockClear();
    revision = 2;
    h.emit({
      method: 'events.lost',
      params: { subscriptionId: 'lease-1', generation: '1', scope: { workspaceId: ws } },
    });
    await settle();
    expect(state.monitors[0].lineCount).toBe(2);
    expect(state.details?.[monitorFixture.monitorId]?.lineCount).toBe(2);
    expect(state.scripts[0].command).toBe('command-2');
    h.emit({
      method: 'events.event',
      params: {
        subscriptionId: 'lease-1',
        event: {
          type: 'scriptMonitor:removed',
          workspaceId: ws,
          data: { monitorId: monitorFixture.monitorId },
        },
      },
    });
    expect(state.monitors).toHaveLength(2);

    expect(h.request.mock.calls).toEqual([
      ['scriptMonitor.list', { workspaceId: ws, state: 'active', view: 'summary', limit: 100 }],
      [
        'scriptMonitor.list',
        { workspaceId: ws, state: 'active', view: 'summary', limit: 100, cursor: 'next' },
      ],
      ['scriptMonitor.get', { workspaceId: ws, monitorId: monitorFixture.monitorId }],
      ['script.get', { workspaceId: ws, scriptId: monitorFixture.scriptId }],
    ]);
  });
});

import { RecoveryRequestTimeoutError as VerifierTimeout } from '$shared/event-recovery/session';
describe.each(cases)('$name physical read lane', (c) => {
  it('physical read: retains ordinary timeout drain before recovery', async () => {
    vi.useFakeTimers();
    const h = session();
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-1', lossRecovery: 1 }
        : { [c.field]: [c.row] },
    );
    legacy.request.mockResolvedValue({ [c.field]: [c.row] });
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    const s = c.subscribe(() => {});
    dispose = s.dispose;
    await settle();
    let finish!: (v: any) => void;
    const error = new VerifierTimeout(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    h.request.mockClear();
    h.request.mockRejectedValueOnce(error);
    s.refetch();
    await settle();
    h.emit(loss());
    await settle();
    const before = h.request.mock.calls.filter(([m]) => m === c.method).length;
    finish({ retired: false, errors: [] });
    await settle();
    expect(before).toBe(1);
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(2);
  });
});

it('physical read: script monitor recovery waits for a timed out seed to drain', async () => {
  const h = session();
  let finish!: (value: any) => void;
  const timeout = new VerifierTimeout(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let reads = 0;
  h.request.mockImplementation(async (method) => {
    if (method === 'client.hello')
      return { server: { protocolVersion: '14.0', capabilities: { scriptMonitors: 2 } } };
    if (method === 'events.subscribe') return { subscriptionId: 'lease-1', lossRecovery: 1 };
    if (method === 'scriptMonitor.list') {
      if (++reads === 1) throw timeout;
      return { view: 'summary', monitors: [monitorSummaryFixture] };
    }
    return {};
  });
  legacy.request.mockImplementation(h.request);
  legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
  let state!: ScriptMonitorSnapshot;
  dispose = subscribeScriptMonitors(monitorFixture.workspaceId, (value) => {
    state = value;
  }).dispose;
  await settle();
  h.emit({
    method: 'events.lost',
    params: {
      subscriptionId: 'lease-1',
      generation: '1',
      scope: { workspaceId: monitorFixture.workspaceId },
    },
  });
  await settle();
  expect(reads).toBe(1);
  expect(state.monitors).toEqual([]);
  finish({ retired: false, errors: [] });
  await settle();
  expect(reads).toBe(2);
  expect(state.monitors).toEqual([monitorSummaryFixture]);
});

describe.each(cases)('$name remounted physical read lane', (c) => {
  it('physical read: keeps a held read through same-session resubscription', async () => {
    const h = session();
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-1', lossRecovery: 1 }
        : { [c.field]: [c.row] },
    );
    legacy.request.mockResolvedValue({ [c.field]: [c.row] });
    legacy.subscribe.mockResolvedValue({ subscriptionId: 'legacy' });
    const old = c.subscribe(() => {});
    dispose = old.dispose;
    await settle();
    let finish!: (value: unknown) => void;
    h.request.mockClear();
    h.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    old.refetch();
    await settle();
    old.dispose();
    const next = c.subscribe(() => {});
    dispose = next.dispose;
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(1);
    finish({ [c.field]: [] });
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === c.method)).toHaveLength(2);
  });
});
// All three owners use trackRuntimeRead(..., true). Keep their timeout/remount/denial
// wiring above and below; exercise the shared session and classification matrix once.
describe('shared runtime read lane', () => {
  it.each([
    ['recovery', 'authority'],
    ['ordinary', 'authority'],
    ['recovery', 'transport'],
    ['ordinary', 'transport'],
  ] as const)('keeps %s timeout occupancy across only the same %s', async (kind, change) => {
    session();
    const key = 'shared-runtime';
    let finish!: (
      value: import('$shared/event-recovery/session').RecoveryRequestCompletion,
    ) => void;
    const completion = new Promise<
      import('$shared/event-recovery/session').RecoveryRequestCompletion
    >((resolve) => {
      finish = resolve;
    });
    const timeout =
      kind === 'recovery'
        ? new VerifierTimeout(completion)
        : new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(trackRuntimeRead(key, () => Promise.reject(timeout), true)).rejects.toBe(timeout);
    if (change === 'authority') rendererEventRecovery.refreshAuthority();
    else session();
    const read = vi.fn(async () => 'replacement');
    const pending = trackRuntimeRead(key, read, true);
    try {
      await settle();
      expect(read).toHaveBeenCalledTimes(change === 'transport' ? 1 : 0);
    } finally {
      finish({ retired: false, errors: [] });
      await expect(pending).resolves.toBe('replacement');
    }
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['denied', 'workspace missing', 'invalid params', 'retired', 'replacement'])(
    'classifies late %s against the captured owner before releasing capacity',
    async (transition) => {
      const h = session();
      const key = 'shared-runtime';
      const retire = vi.fn();
      const register = () =>
        h.scope.registerResource({
          key,
          workspaceId: 'ws',
          eventTypes: ['hook:*'],
          isCurrent: () => true,
          read: async () => [],
          apply: () => {},
          invalidate: () => {},
          retire,
        });
      register();
      let finish!: (
        value: import('$shared/event-recovery/session').RecoveryRequestCompletion,
      ) => void;
      const completion = new Promise<
        import('$shared/event-recovery/session').RecoveryRequestCompletion
      >((resolve) => {
        finish = resolve;
      });
      const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
      await expect(trackRuntimeRead(key, () => Promise.reject(timeout), true)).rejects.toBe(
        timeout,
      );
      // A push changes the snapshot receipt without changing its retirement authority.
      rendererEventRecovery.push(key);
      if (transition === 'replacement') {
        rendererEventRecovery.refreshAuthority();
        register();
        retire.mockClear();
      }
      const receipt = rendererEventRecovery.capture(key);
      const successor = vi.fn(async () => ({
        retired: retire.mock.calls.length,
        current: receipt.isCurrent(),
      }));
      const pending = trackRuntimeRead(key, successor, true);
      await settle();
      expect(successor).not.toHaveBeenCalled();
      finish({
        retired: transition === 'retired',
        errors: [
          transition === 'workspace missing' || transition === 'invalid params'
            ? {
                rpcCode: -32602,
                ...(transition === 'workspace missing' ? { data: { code: 'not-found' } } : {}),
              }
            : { rpcCode: -32003 },
        ],
      });
      const denied = transition === 'denied' || transition === 'workspace missing';
      await expect(pending).resolves.toEqual({ retired: denied ? 1 : 0, current: !denied });
      expect(successor).toHaveBeenCalledTimes(1);
    },
  );
});

describe.each(cases)('$name ordinary late authority denial', (c) => {
  it('clears a missing workspace after loss without a replacement read', async () => {
    const h = session();
    h.request.mockImplementation(async (method) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'authority-lease', lossRecovery: 1 }
        : { [c.field]: [c.row] },
    );
    let rows: unknown[] = [];
    const subscription = c.subscribe((value) => {
      rows = value;
    });
    dispose = subscription.dispose;
    await settle();
    expect(rows).toEqual([c.row]);
    let finish!: (
      value: import('$shared/event-recovery/session').RecoveryRequestCompletion,
    ) => void;
    const completion = new Promise<
      import('$shared/event-recovery/session').RecoveryRequestCompletion
    >((resolve) => {
      finish = resolve;
    });
    h.request.mockRejectedValueOnce(
      new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion),
    );
    subscription.refetch();
    await settle();
    const receipt = rendererEventRecovery.capture(c.key);
    expect(receipt.commit(() => undefined)).toBe(true);
    h.emit({
      method: 'events.lost',
      params: { subscriptionId: 'authority-lease', generation: '1', scope: { workspaceId: 'ws' } },
    });
    await settle();
    expect(receipt.commit(() => undefined)).toBe(false);
    expect(rows).toEqual([c.row]);
    expect(h.request.mock.calls.filter(([method]) => method === c.method)).toHaveLength(2);
    finish({
      retired: false,
      errors: [
        new BackendError({
          code: 'INVALID_PARAMS',
          message: 'Missing',
          rpcCode: -32602,
          data: { code: 'not-found' },
        }),
      ],
    });
    await settle();
    expect(rows).toEqual([]);
    expect(h.request.mock.calls.filter(([method]) => method === c.method)).toHaveLength(2);
  });
});
