import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWebSocketLike } from './browser-websocket-transport';
class Socket implements BrowserWebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<{ id: number; method: string; params: any }> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {} // Calling close is intentionally not an observed close event.
  receive(id: number, result: unknown) {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) });
  }
}
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
async function fixture() {
  const { BrowserWebSocketTransport } = await import('./browser-websocket-transport');
  const sockets: Socket[] = [];
  const transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9999',
    requestTimeoutMs: 100,
    reconnectDelayMs: 1,
    webSocketFactory: () => {
      const s = new Socket();
      sockets.push(s);
      return s;
    },
  });
  const open = async (socket: Socket) => {
    socket.onopen?.();
    await flush();
    const hello = socket.sent.at(-1)!;
    socket.receive(hello.id, {
      clientId: 'client',
      protocolVersion: '2.2',
      server: { capabilities: {} },
    });
    await flush();
  };
  return { transport, sockets, open };
}
it('reclaims browser same-socket cleanup credit through more than 64 healthy mount cycles', async () => {
  const f = await fixture();
  const initial = f.transport.subscribeNoteDeletion('ws');
  await f.open(f.sockets[0]);
  const socket = f.sockets[0];
  let pending = initial;
  for (let i = 0; i < 70; i++) {
    await flush();
    const sub = socket.sent.at(-1)!;
    expect(sub.method).toBe('events.subscribe');
    socket.receive(sub.id, { subscriptionId: `server-${i}` });
    const ack = await pending;
    const release = ack.unsubscribe();
    await flush();
    const unsub = socket.sent.at(-1)!;
    expect(unsub).toMatchObject({
      method: 'events.unsubscribe',
      params: { subscriptionId: `server-${i}`, workspaceId: 'ws' },
    });
    socket.receive(unsub.id, { success: true });
    await release;
    if (i < 69) pending = f.transport.subscribeNoteDeletion('ws');
  }
  f.transport.dispose();
});
it('retains timed-out browser registrations and refuses the 65th without sending', async () => {
  const f = await fixture();
  const initial = f.transport.subscribeNoteDeletion('ws');
  const settled = Promise.allSettled([initial]);
  await f.open(f.sockets[0]);
  await vi.advanceTimersByTimeAsync(101);
  await settled;
  for (let i = 1; i < 64; i++) {
    const pending = f.transport.subscribeNoteDeletion('ws');
    const result = Promise.allSettled([pending]);
    await vi.advanceTimersByTimeAsync(101);
    await result;
  }
  const count = f.sockets[0].sent.length;
  await expect(f.transport.subscribeNoteDeletion('ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(f.sockets[0].sent).toHaveLength(count);
  f.transport.dispose();
});
it('never sends old cleanup to a replacement browser socket and does not treat reconnect as release', async () => {
  const f = await fixture();
  const pending = f.transport.subscribeNoteDeletion('ws');
  await f.open(f.sockets[0]);
  const old = f.sockets[0],
    sub = old.sent.at(-1)!;
  old.receive(sub.id, { subscriptionId: 'same-id' });
  const ack = await pending;
  old.onclose?.();
  await vi.advanceTimersByTimeAsync(1);
  await f.open(f.sockets[1]);
  const current = f.sockets[1],
    count = current.sent.length;
  await expect(ack.unsubscribe()).rejects.toThrow();
  expect(current.sent).toHaveLength(count);
  f.transport.dispose();
});

it('does not refund requested close, but releases only old-socket debt when its actual close arrives', async () => {
  const f = await fixture();
  const oldSockets: Socket[] = [];
  // Dispose requests close but the fake does not report onclose. Each owner keeps a live subscription.
  for (let i = 0; i < 8; i++) {
    const { BrowserWebSocketTransport } = await import('./browser-websocket-transport');
    const socket = new Socket();
    const t = new BrowserWebSocketTransport({
      url: 'ws://127.0.0.1:9999',
      webSocketFactory: () => socket,
    });
    const p = t.subscribeNoteDeletion('ws');
    await f.open(socket);
    socket.receive(socket.sent.at(-1)!.id, { subscriptionId: `retained-${i}` });
    await p;
    oldSockets.push(socket);
    t.dispose();
  }
  const denied = f.transport.subscribeNoteDeletion('ws');
  await f.open(f.sockets[0]);
  await expect(denied).rejects.toMatchObject({ code: 'NOTE_DELETE_REGISTRATION_LIMIT' });
  const current = f.sockets[0],
    count = current.sent.length;
  oldSockets[0].onclose?.();
  expect(current.sent).toHaveLength(count);
  const recovered = f.transport.subscribeNoteDeletion('ws');
  await flush();
  current.receive(current.sent.at(-1)!.id, { subscriptionId: 'new-owner' });
  await expect(recovered).resolves.toMatchObject({ subscriptionId: 'new-owner' });
  f.transport.dispose();
});
