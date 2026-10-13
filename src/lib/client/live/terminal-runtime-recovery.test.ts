import { BackendError } from './backend-transport-types';
import { afterEach, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';
import { subscribeTerminalRuntime } from './terminal-runtime-recovery';
import type { TerminalEventHandlers } from '../app-client';
let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
  rendererEventRecovery.dispose();
  vi.useRealTimers();
});
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
function session(request: EventRecoverySession['request'], supported = true) {
  const handlers = new Set<(event: RecoveryNotification) => void | Promise<void>>();
  const scope = rendererEventRecovery.attach({
    supported,
    isCurrent: () => true,
    request,
    fence: async (_ids, observe) => {
      observe();
    },
    onNotification: (fn) => {
      handlers.add(fn);
      return () => {
        handlers.delete(fn);
      };
    },
    onRetired: () => () => {},
    dispose: () => {},
  });
  return {
    scope,
    emit: (method: string, params: unknown) => {
      for (const fn of handlers) void fn({ method, params });
    },
  };
}
it('shares one lease/read across terminals, replaces metadata, and leaves bytes and exits transient', async () => {
  const rows = [{ id: 'one', cwd: '/spawn', name: 'Spawn label', isExecutingCommand: true }];
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : { terminals: rows },
  );
  const h = session(request as EventRecoverySession['request']);
  let state: unknown;
  const handlers: TerminalEventHandlers = {
    onMetadata: (value) => {
      state = value;
    },
    onData: vi.fn(),
    onExit: vi.fn(),
    onCwd: vi.fn(),
  };
  cleanups.push(subscribeTerminalRuntime('ws', 'one', handlers, () => {}).dispose);
  cleanups.push(subscribeTerminalRuntime('ws', 'two', {}, () => {}).dispose);
  await settle();
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(state).toMatchObject({
    terminalId: 'one',
    isConnected: true,
  });
  expect(request.mock.calls.filter(([method]) => method === 'terminal.list')).toHaveLength(1);
  expect(request.mock.calls.filter(([method]) => method === 'events.subscribe')).toHaveLength(1);
  h.emit('events.event', {
    subscriptionId: 'lease',
    event: { type: 'terminal:cwd', workspaceId: 'ws', data: { terminalId: 'one', cwd: '/old' } },
  });
  expect(handlers.onCwd).toHaveBeenCalledExactlyOnceWith({ terminalId: 'one', cwd: '/old' });
  h.emit('events.event', {
    subscriptionId: 'lease',
    event: {
      type: 'terminal:data',
      workspaceId: 'ws',
      data: { terminalId: 'one', chunk: btoa('live') },
    },
  });
  h.emit('events.event', {
    subscriptionId: 'foreign',
    event: {
      type: 'terminal:data',
      workspaceId: 'ws',
      data: { terminalId: 'one', chunk: btoa('duplicate') },
    },
  });
  expect(handlers.onData).toHaveBeenCalledExactlyOnceWith({
    terminalId: 'one',
    chunk: 'live',
    metadataAllowed: false,
  });
  expect(handlers.onExit).not.toHaveBeenCalled();
  await settle();
  expect(request.mock.calls.filter(([method]) => method === 'terminal.list')).toHaveLength(1);
});
it('rejects a held recovery response after retirement without replaying exits', async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const h = session(request as EventRecoverySession['request']);
  let state: unknown;
  const onExit = vi.fn();
  const onCwd = vi.fn();
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
        onExit,
        onCwd,
      },
      () => {},
    ).dispose,
  );
  await settle();
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  rendererEventRecovery.retireWorkspace('ws');
  h.emit('events.event', {
    subscriptionId: 'lease',
    event: {
      type: 'terminal:cwd',
      workspaceId: 'ws',
      data: { terminalId: 'one', cwd: '/retired' },
    },
  });
  expect(onCwd).not.toHaveBeenCalled();
  expect(state).toEqual({ terminalId: 'one', isConnected: false, clearTransient: true });
  finish({ terminals: [{ id: 'one', cwd: '/stale' }] });
  await settle();
  expect(state).toEqual({ terminalId: 'one', isConnected: false, clearTransient: true });
  expect(onExit).not.toHaveBeenCalled();
});

it('coalesces repeated losses and output bursts and refreshes late unversioned metadata', async () => {
  vi.useFakeTimers();
  const pending: Array<(value: unknown) => void> = [];
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : new Promise((resolve) => {
          pending.push(resolve);
        }),
  );
  const h = session(request as EventRecoverySession['request']);
  let state: unknown;
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
      },
      () => {},
    ).dispose,
  );
  await settle();
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  for (let i = 2; i < 30; i++)
    h.emit('events.lost', {
      subscriptionId: 'lease',
      generation: String(i),
      scope: { workspaceId: 'ws' },
    });
  pending.shift()!({ terminals: [{ id: 'one', cwd: '/stale' }] });
  await settle();
  expect(state).toEqual({ terminalId: 'one', clearTransient: true });
  expect(pending).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(250);
  expect(pending).toHaveLength(1);
  pending.shift()!({ terminals: [{ id: 'one', cwd: '/current' }] });
  await settle();
  expect(state).toMatchObject({ isConnected: true });
  for (let i = 0; i < 30; i++)
    h.emit('events.event', {
      subscriptionId: 'lease',
      event: {
        type: 'terminal:exit',
        workspaceId: 'ws',
        data: { terminalId: 'one', exitCode: 0 },
      },
    });
  expect(pending).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(250);
  expect(pending).toHaveLength(1);
  pending.shift()!({ terminals: [] });
  await settle();
  expect(state).toEqual({ terminalId: 'one', isConnected: false, clearTransient: true });
  expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(3);
});

it('keeps legacy pushes live and never starts recovery reads for an unsupported lease', async () => {
  const request = vi.fn(async () => ({ subscriptionId: 'lease' }));
  const h = session(request as EventRecoverySession['request'], false);
  const onCwd = vi.fn();
  const onData = vi.fn();
  cleanups.push(subscribeTerminalRuntime('ws', 'one', { onCwd, onData }, () => {}).dispose);
  await settle();
  h.emit('events.event', {
    subscriptionId: 'lease',
    event: { type: 'terminal:cwd', workspaceId: 'ws', data: { terminalId: 'one', cwd: '/legacy' } },
  });
  h.emit('events.event', {
    subscriptionId: 'lease',
    event: {
      type: 'terminal:data',
      workspaceId: 'ws',
      data: { terminalId: 'one', chunk: btoa('live') },
    },
  });
  expect(onCwd).toHaveBeenCalledExactlyOnceWith({ terminalId: 'one', cwd: '/legacy' });
  expect(onData).toHaveBeenCalledExactlyOnceWith({
    terminalId: 'one',
    chunk: 'live',
    metadataAllowed: true,
  });
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(request).toHaveBeenCalledTimes(1);
});

it('replaces the captured session and rejects its held replies and callbacks', async () => {
  let finish!: (value: unknown) => void;
  const oldRequest = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const old = session(oldRequest as EventRecoverySession['request']);
  let state: unknown;
  const onData = vi.fn();
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
        onData,
      },
      () => {},
    ).dispose,
  );
  await settle();
  old.emit('events.lost', {
    subscriptionId: 'lease',
    generation: '1',
    scope: { workspaceId: 'ws' },
  });
  await settle();
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'replacement', lossRecovery: 1 }
      : { terminals: [{ id: 'one', cwd: '/new-session' }] },
  );
  session(request as EventRecoverySession['request']);
  await settle();
  expect(state).toMatchObject({ isConnected: true });
  finish({ terminals: [] });
  old.emit('events.event', {
    subscriptionId: 'lease',
    event: {
      type: 'terminal:data',
      workspaceId: 'ws',
      data: { terminalId: 'one', chunk: btoa('old') },
    },
  });
  await settle();
  expect(state).toMatchObject({ isConnected: true });
  expect(onData).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(1);
});

it('includes overlapping legacy leases in coverage and resumes after they retire', async () => {
  let count = 0;
  const request = vi.fn(async (method: string, params: any) =>
    method === 'events.subscribe'
      ? {
          subscriptionId: ++count === 1 ? 'lease' : 'legacy',
          ...(params.lossRecovery ? { lossRecovery: 1 } : {}),
        }
      : { terminals: [{ id: 'one', cwd: '/fresh' }] },
  );
  const h = session(request as EventRecoverySession['request']);
  let state: unknown;
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
      },
      () => {},
    ).dispose,
  );
  await settle();
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['terminal:exit'] }, { recover: false });
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(0);
  expect(state).toEqual({ terminalId: 'one', clearTransient: true });
  await h.scope.unsubscribe('legacy');
  await settle();
  expect(state).toMatchObject({ isConnected: true });
  expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(1);
});

it('restores legacy connection state on reconnect using a pre-envelope terminal list', async () => {
  session(
    vi.fn(async () => ({ subscriptionId: 'legacy' })) as EventRecoverySession['request'],
    false,
  );
  let state: unknown;
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
      },
      () => {},
    ).dispose,
  );
  await settle();
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'new-legacy' }
      : [{ id: 'one', isExecutingCommand: true }],
  );
  session(request as EventRecoverySession['request'], false);
  await settle();
  expect(state).toMatchObject({
    terminalId: 'one',
    isConnected: true,
  });
  expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(1);
});

it('serializes a held ordinary list and rejects its stale local state before recovery applies', async () => {
  const { readTerminalRuntimeList, terminalRuntimeKey } =
    await import('./terminal-runtime-recovery');
  let finish!: (value: unknown) => void;
  let reads = 0;
  const request = vi.fn(async (method: string) => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    if (method === 'terminal.list' && ++reads === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { terminals: [{ id: 'one', isExecutingCommand: true }] };
  });
  const h = session(request as EventRecoverySession['request']);
  let state: unknown;
  cleanups.push(
    subscribeTerminalRuntime(
      'ws',
      'one',
      {
        onMetadata: (value) => {
          state = value;
        },
      },
      () => {},
    ).dispose,
  );
  await settle();
  const token = rendererEventRecovery.capture(terminalRuntimeKey('ws'));
  const ordinary = readTerminalRuntimeList('ws', async () => {
    throw new Error('unexpected fallback');
  }).then(() =>
    token.commit(() => {
      state = { terminalId: 'one', isConnected: false };
    }),
  );
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(reads).toBe(1);
  finish({ terminals: [] });
  expect(await ordinary).toBe(false);
  await settle();
  expect(reads).toBe(2);
  expect(state).toMatchObject({ isConnected: true });
});

import { RecoveryRequestTimeoutError as VerifierTimeout } from '$shared/event-recovery/session';
import { trackTerminalRuntimeRead as verifierTrack } from './terminal-runtime-recovery';
it.each(['recovery', 'ordinary'])(
  'physical read: terminals retain %s timeout physical drain',
  async (kind) => {
    const request = vi.fn(async (method: string) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease', lossRecovery: 1 }
        : { terminals: [] },
    );
    const h = session(request as EventRecoverySession['request']);
    cleanups.push(subscribeTerminalRuntime('ws', 'one', {}, () => {}).dispose);
    await settle();
    let finish!: (v: any) => void;
    const completion = new Promise<
      import('$shared/event-recovery/session').RecoveryRequestCompletion
    >((resolve) => {
      finish = resolve;
    });
    const error =
      kind === 'recovery'
        ? new VerifierTimeout(completion)
        : new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await verifierTrack('ws', () => Promise.reject(error)).catch(() => {});
    h.emit('events.lost', {
      subscriptionId: 'lease',
      generation: '1',
      scope: { workspaceId: 'ws' },
    });
    await settle();
    const before = request.mock.calls.filter(([m]) => m === 'terminal.list').length;
    finish({ retired: false, errors: [] });
    await settle();
    expect(before).toBe(0);
    expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(1);
  },
);

it.each(['recovery', 'ordinary'])(
  'physical read: terminal %s timeout drain survives authority refresh on the same session',
  async (kind) => {
    let serial = 0;
    const request = vi.fn(async (method: string) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'lease-' + ++serial, lossRecovery: 1 }
        : { terminals: [] },
    );
    session(request as EventRecoverySession['request']);
    cleanups.push(subscribeTerminalRuntime('ws', 'one', {}, () => {}).dispose);
    await settle();
    let finish!: (value: any) => void;
    const completion = new Promise<
      import('$shared/event-recovery/session').RecoveryRequestCompletion
    >((resolve) => {
      finish = resolve;
    });
    const timeout =
      kind === 'recovery'
        ? new VerifierTimeout(completion)
        : new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await verifierTrack('ws', () => Promise.reject(timeout)).catch(() => {});
    rendererEventRecovery.refreshAuthority();
    await settle();
    const before = request.mock.calls.filter(([method]) => method === 'terminal.list').length;
    finish({ retired: false, errors: [] });
    await settle();
    expect(before).toBe(0);
    expect(request.mock.calls.filter(([method]) => method === 'terminal.list')).toHaveLength(1);
  },
);

it.each(['denied', 'retired', 'replacement'])(
  'terminal ordinary late denial respects %s authority',
  async (transition) => {
    const request = vi.fn(async (method: string) =>
      method === 'events.subscribe'
        ? { subscriptionId: 'late-terminal', lossRecovery: 1 }
        : { terminals: [{ id: 'one', isExecutingCommand: true }] },
    );
    const h = session(request as EventRecoverySession['request']);
    let state: unknown;
    const onData = vi.fn(),
      onExit = vi.fn();
    cleanups.push(
      subscribeTerminalRuntime(
        'ws',
        'one',
        {
          onMetadata: (value) => {
            state = value;
          },
          onData,
          onExit,
        },
        () => {},
      ).dispose,
    );
    await settle();
    let finish!: (
      value: import('$shared/event-recovery/session').RecoveryRequestCompletion,
    ) => void;
    const completion = new Promise<
      import('$shared/event-recovery/session').RecoveryRequestCompletion
    >((resolve) => {
      finish = resolve;
    });
    await verifierTrack('ws', () =>
      Promise.reject(new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion)),
    ).catch(() => {});
    if (transition === 'replacement') rendererEventRecovery.refreshAuthority();
    else
      h.emit('events.lost', {
        subscriptionId: 'late-terminal',
        generation: '1',
        scope: { workspaceId: 'ws' },
      });
    await settle();
    finish({
      retired: transition === 'retired',
      errors: [new BackendError({ code: 'FORBIDDEN', message: 'Denied', rpcCode: -32003 })],
    });
    await settle();
    expect(state).toMatchObject({ isConnected: transition !== 'denied' });
    expect(request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(
      transition === 'denied' ? 0 : 1,
    );
    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  },
);
