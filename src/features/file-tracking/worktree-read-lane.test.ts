import { expect, it, vi } from 'vitest';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { trackWorktreeSnapshotRead } from './worktree-read-lane';
it('retains exclusive recovery ownership until a logically timed out driver drains', async () => {
  let drain!: (result: { retired: boolean; errors: unknown[] }) => void;
  const error = new RecoveryRequestTimeoutError(
    new Promise((resolve) => {
      drain = resolve;
    }),
  );
  await expect(
    trackWorktreeSnapshotRead('deadline-case', () => Promise.reject(error), 'recovery'),
  ).rejects.toBe(error);
  const read = vi.fn(async () => 'new');
  const ordinary = trackWorktreeSnapshotRead('deadline-case', read);
  await Promise.resolve();
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  drain({ retired: false, errors: [] });
  await expect(ordinary).resolves.toBe('new');
  expect(read).toHaveBeenCalledTimes(1);
});

it('keeps a real ordinary browser deadline in the worktree lane until its wire reply', async () => {
  const { BrowserWebSocketTransport } =
    await import('$lib/client/live/browser-websocket-transport');
  vi.useFakeTimers();
  const frames: Array<{ id: number; method: string }> = [];
  const socket = {
    onopen: null as null | (() => void),
    onmessage: null as null | ((e: { data: unknown }) => void),
    onerror: null,
    onclose: null,
    send(raw: string) {
      frames.push(JSON.parse(raw));
    },
    close() {},
  };
  const transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc',
    webSocketFactory: () => socket,
    requestTimeoutMs: 50,
  });
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  const receive = (id: number, result: unknown) =>
    socket.onmessage?.({ data: JSON.stringify({ id, result }) });
  try {
    const capture = transport.captureEventRecovery();
    socket.onopen?.();
    await flush();
    receive(frames.at(-1)!.id, {
      clientId: 'browser',
      protocolVersion: '2.2',
      server: {
        locality: 'local',
        hasDisplay: false,
        osArch: 'linux/x86_64',
        version: '0.1.0',
        protocolVersion: '2.2',
        capabilities: { liveState: true, eventStreamRecovery: 1 },
      },
    });
    await capture;
    const ordinary = trackWorktreeSnapshotRead('ordinary-browser-worktree', () =>
      transport.request('git.status', { workspaceId: 'ws' }),
    );
    const failed = ordinary.catch((error) => error);
    await flush();
    const wire = frames.at(-1)!;
    expect(wire.method).toBe('git.status');
    await vi.advanceTimersByTimeAsync(60);
    expect(await failed).toMatchObject({ code: 'TIMEOUT' });
    const read = vi.fn(async () => 'recovered');
    const recovery = trackWorktreeSnapshotRead('ordinary-browser-worktree', read, 'recovery');
    await flush();
    expect.soft(read).not.toHaveBeenCalled();
    receive(wire.id, { branch: 'fresh' });
    await expect(recovery).resolves.toBe('recovered');
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    transport.dispose();
    vi.useRealTimers();
  }
});

it.each(['current', 'push', 'replaced'] as const)(
  'observes late worktree denial on original authority after %s',
  async (change) => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    const { agentLockReducer, setAgentLockState } =
      await import('$store/renderer/slices/agent-lock/agent-lock-slice');
    rendererEventRecovery.dispose();
    let state = agentLockReducer(undefined, setAgentLockState('ws', { protected: true }, {}));
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onNotification: () => () => {},
        onRetired: () => () => {},
        dispose: () => {},
        request: async () => ({}),
      }),
    );
    const key = 'worktree-denial-' + change;
    const owner = {
      key,
      workspaceId: 'ws',
      eventTypes: ['git:*'],
      isCurrent: () => true,
      read: async () => null,
      apply: () => undefined,
      invalidate: () => undefined,
      retire: () => {
        state = agentLockReducer(state, setAgentLockState('ws', {}, {}));
      },
    };
    const handle = scope.registerResource(owner);
    let finish!: (outcome: { retired: boolean; errors: unknown[] }) => void;
    const completion = new Promise<{ retired: boolean; errors: unknown[] }>((resolve) => {
      finish = resolve;
    });
    const error = Object.assign(new Error('timeout'), { completion });
    try {
      await expect(trackWorktreeSnapshotRead(key, () => Promise.reject(error))).rejects.toBe(error);
      if (change === 'push') rendererEventRecovery.push(key);
      if (change === 'replaced') {
        handle.dispose();
        scope.registerResource(owner);
        state = agentLockReducer(state, setAgentLockState('ws', { replacement: true }, {}));
      }
      const before = state;
      const expected =
        change === 'replaced' ? before : agentLockReducer(before, setAgentLockState('ws', {}, {}));
      const next = trackWorktreeSnapshotRead(
        key,
        async () => {
          expect(state).toEqual(expected);
          return 'done';
        },
        'recovery',
      );
      finish({ retired: false, errors: [Object.assign(new Error('denied'), { rpcCode: -32003 })] });
      await next;
      expect(rendererEventRecovery.captureAuthority(key).isCurrent()).toBe(change === 'replaced');
    } finally {
      rendererEventRecovery.dispose();
    }
  },
);

it.each(['same', 'replacement'] as const)(
  'shares held work only with the same physical session (%s)',
  async (change) => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    const attach = () =>
      rendererEventRecovery.attach(
        createEventRecoverySession({
          supported: true,
          isCurrent: () => true,
          onNotification: () => () => {},
          onRetired: () => () => {},
          dispose: () => {},
          request: async () => ({}),
        }),
      );
    attach();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ordinary = trackWorktreeSnapshotRead('physical-' + change, () => held);
    if (change === 'replacement') attach();
    else rendererEventRecovery.refreshAuthority();
    const read = vi.fn(async () => 'fresh');
    const recovery = trackWorktreeSnapshotRead('physical-' + change, read, 'recovery');
    await Promise.resolve();
    await Promise.resolve();
    expect.soft(read).toHaveBeenCalledTimes(change === 'replacement' ? 1 : 0);
    release();
    await ordinary;
    await recovery;
    rendererEventRecovery.dispose();
  },
);
