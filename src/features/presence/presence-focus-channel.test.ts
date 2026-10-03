import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const wire = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Set<(n: { method: string; params: unknown }) => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendNotification: (fn: (n: { method: string; params: unknown }) => void) => {
    wire.listeners.add(fn);
    return () => wire.listeners.delete(fn);
  },
}));
import { createPresenceFocusChannel, type FocusSubscription } from './presence-focus-channel';
function push(subscriptionId: string, seq: number, target: unknown, closed?: true) {
  for (const fn of wire.listeners)
    fn({
      method: 'subscription.push',
      params: {
        subscriptionId,
        seq,
        kind: 'snapshot',
        snapshot: {
          workspaceId: 'source',
          principalId: 'person',
          target,
          ...(closed ? { closed } : {}),
        },
      },
    });
}
const flush = () => vi.advanceTimersByTimeAsync(0);
let channel: FocusSubscription;
let seen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  seen = vi.fn();
  wire.request.mockReset();
  wire.request.mockImplementation(async () => ({ subscriptionId: 'sub-1' }));
  channel = createPresenceFocusChannel(
    'source',
    'person',
    'group',
    seen,
    () => true,
    () => true,
  );
});
afterEach(() => {
  channel.close();
  vi.useRealTimers();
});
describe('authorized focus channel', () => {
  it('uses the exact scoped request and accepts a closed-workspace target arriving before ack', async () => {
    wire.request.mockImplementation(async (method) => {
      if (method === 'presence.focus.subscribe')
        push('sub-1', 0, { workspaceId: 'closed', noteId: 'spec' });
      return { subscriptionId: 'sub-1' };
    });
    const frame = await channel.refresh();
    expect(wire.request).toHaveBeenCalledWith('presence.focus.subscribe', {
      workspaceId: 'source',
      principalId: 'person',
      replaceGroup: 'group',
    });
    expect(frame).toEqual({
      generation: 1,
      seq: 0,
      target: { workspaceId: 'closed', noteId: 'spec' },
    });
    expect(seen.mock.calls.at(-1)).toEqual([frame]);
  });
  it('replaces focus with null without retaining hidden metadata', async () => {
    const read = channel.refresh();
    await flush();
    push('sub-1', 0, { workspaceId: 'closed', agentId: 'agent' });
    await read;
    push('sub-1', 1, null);
    expect(seen.mock.calls.at(-1)).toEqual([{ generation: 1, seq: 1, target: null }]);
    push('sub-1', 0, { workspaceId: 'old-secret' });
    expect(seen.mock.calls.at(-1)).toEqual([{ generation: 1, seq: 1, target: null }]);
  });
  it('single-flights renewal and ignores old subscription frames', async () => {
    const read = channel.refresh();
    expect(channel.refresh()).toBe(read);
    await flush();
    push('sub-1', 0, { workspaceId: 'one' });
    await read;
    wire.request.mockResolvedValue({ subscriptionId: 'sub-2' });
    const fresh = channel.refresh();
    await flush();
    push('sub-1', 1, { workspaceId: 'secret' });
    expect(seen.mock.calls.at(-1)).toEqual([null]);
    push('sub-2', 0, { workspaceId: 'two' });
    expect(await fresh).toEqual({ generation: 2, seq: 0, target: { workspaceId: 'two' } });
  });
  it('fails closed on a sequence gap and obtains one fresh snapshot', async () => {
    const read = channel.refresh();
    await flush();
    push('sub-1', 0, { workspaceId: 'one' });
    await read;
    wire.request.mockResolvedValue({ subscriptionId: 'sub-2' });
    push('sub-1', 2, { workspaceId: 'untrusted' });
    await flush();
    expect(seen.mock.calls.at(-1)).toEqual([null]);
    expect(
      wire.request.mock.calls.filter(([method]) => method === 'presence.focus.subscribe'),
    ).toHaveLength(2);
    push('sub-2', 0, null);
    await flush();
    push('sub-2', 2, { workspaceId: 'bad-again' });
    await flush();
    expect(
      wire.request.mock.calls.filter(([method]) => method === 'presence.focus.subscribe'),
    ).toHaveLength(2);
    expect(seen.mock.calls.at(-1)).toEqual([null]);
  });
  it('releases a late ack after disposal without publishing or retaining its snapshot', async () => {
    let resolve!: (value: unknown) => void;
    wire.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const read = channel.refresh();
    channel.close();
    resolve({ subscriptionId: 'late' });
    await flush();
    expect(await read).toBeNull();
    expect(wire.request).toHaveBeenCalledWith('presence.focus.unsubscribe', {
      workspaceId: 'source',
      subscriptionId: 'late',
    });
    expect(wire.listeners.size).toBe(0);
    expect(seen.mock.calls).toEqual([[null]]);
  });
  it('keeps unsupported daemons inert without polling', async () => {
    wire.request.mockRejectedValue({ rpcCode: -32601 });
    expect(await channel.refresh()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.request).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls.at(-1)).toEqual([null]);
  });
  it('clears missing initial snapshots on timeout and releases a late registration', async () => {
    let reply!: (value: unknown) => void;
    wire.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const read = channel.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await read).toBeNull();
    reply({ subscriptionId: 'late' });
    await flush();
    expect(wire.request).toHaveBeenCalledWith('presence.focus.unsubscribe', {
      workspaceId: 'source',
      subscriptionId: 'late',
    });
    push('late', 0, { workspaceId: 'stale' });
    expect(seen.mock.calls.at(-1)).toEqual([null]);
  });
  it('clears malformed active frames without preserving the previous location', async () => {
    const read = channel.refresh();
    await flush();
    push('sub-1', 0, { workspaceId: 'closed' });
    await read;
    push('sub-1', 1, { workspaceId: 'closed', noteId: 'note', agentId: 'agent' });
    expect(seen.mock.calls.at(-1)).toEqual([null]);
    expect(wire.request).toHaveBeenCalledWith('presence.focus.unsubscribe', {
      workspaceId: 'source',
      subscriptionId: 'sub-1',
    });
  });
  it('disposes a terminal snapshot and cannot renew the ended lifetime', async () => {
    const read = channel.refresh();
    await flush();
    push('sub-1', 0, { workspaceId: 'closed' });
    await read;
    push('sub-1', 1, null, true);
    expect(seen.mock.calls.at(-1)).toEqual([null]);
    expect(wire.listeners.size).toBe(0);
    expect(await channel.refresh()).toBeNull();
    expect(
      wire.request.mock.calls.filter(([method]) => method === 'presence.focus.subscribe'),
    ).toHaveLength(1);
  });
});
