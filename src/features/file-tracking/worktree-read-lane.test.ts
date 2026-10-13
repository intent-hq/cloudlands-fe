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
