/**
 * Unit tests for the local-transport tunnel backend (DirectRelay): a plain
 * FE-side loopback TCP relay with the same provider surface and lifecycle
 * rules as the `/tunnel` mux backend (reuse, refused-connect drop,
 * closeForward, persistence until explicit close/dispose).
 */
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DirectRelay } from './direct-relay';

/** Loopback echo server on an ephemeral port. */
async function startEchoServer(): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function collectUntil(socket: net.Socket, expectedBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= expectedBytes) resolve(Buffer.concat(chunks));
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('socket closed before enough data')));
  });
}

function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => socket.once('close', resolve));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await delay(10);
  }
}

describe('DirectRelay', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });
  const onCleanup = (fn: () => void | Promise<void>): void => {
    cleanups.push(fn);
  };

  it('identifies as the direct backend', () => {
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());
    expect(relay.backend).toBe('direct');
  });

  it('forwardPort relays data both ways through a loopback listener', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());

    const localPort = await relay.forwardPort(port);
    expect(localPort).toBeGreaterThan(0);
    expect(localPort).not.toBe(port);
    expect(relay.activeForwards()).toEqual([{ remotePort: port, localPort }]);

    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('hello over the relay');
    client.write(payload);
    const echoed = await collectUntil(client, payload.length);
    expect(echoed.equals(payload)).toBe(true);

    // And a second round-trip on the same socket.
    const again = Buffer.from('second message');
    client.write(again);
    const echoed2 = await collectUntil(client, again.length);
    expect(echoed2.equals(again)).toBe(true);
  });

  it('half-close propagates: client end() still receives the echo then FIN', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());

    const localPort = await relay.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('one-shot');
    const received = collectUntil(client, payload.length);
    client.end(payload);
    expect((await received).equals(payload)).toBe(true);
    await waitForClose(client);
  });

  it('reuses the existing forward for a repeated forwardPort call', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());

    const localPort = await relay.forwardPort(port);
    await expect(relay.forwardPort(port)).resolves.toBe(localPort);
    expect(relay.activeForwards()).toEqual([{ remotePort: port, localPort }]);
  });

  it('rejects invalid remote ports', async () => {
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());
    await expect(relay.forwardPort(0)).rejects.toThrow(/invalid remote port/);
    await expect(relay.forwardPort(65536)).rejects.toThrow(/invalid remote port/);
    await expect(relay.forwardPort(1.5)).rejects.toThrow(/invalid remote port/);
  });

  it('drops the whole forward on a refused connect, leaving other forwards intact (#2537)', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    // A port with nothing listening: grab an ephemeral port then release it.
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());
    const healthyLocal = await relay.forwardPort(healthy.port);
    const healthyClient = await connectClient(healthyLocal);
    onCleanup(() => healthyClient.destroy());

    const deadLocal = await relay.forwardPort(deadPort);
    expect(relay.activeForwards().length).toBe(2);
    const refused = await connectClient(deadLocal);
    await waitForClose(refused);

    // The refused forward is dropped immediately …
    await waitFor(() => relay.activeForwards().length === 1);
    expect(relay.activeForwards()).toEqual([{ remotePort: healthy.port, localPort: healthyLocal }]);
    // … its local listener is closed …
    await expect(connectClient(deadLocal)).rejects.toThrow();
    // … and the healthy forward's in-flight socket still relays.
    const payload = Buffer.from('unaffected');
    const received = collectUntil(healthyClient, payload.length);
    healthyClient.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('a later forwardPort recreates a forward dropped by a refused connect', async () => {
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());
    const staleLocal = await relay.forwardPort(deadPort);
    const refused = await connectClient(staleLocal);
    await waitForClose(refused);
    await waitFor(() => relay.activeForwards().length === 0);

    // The server comes back on the same remote port; the next forwardPort
    // builds a fresh forward instead of returning the dropped one.
    const revived = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve, reject) => {
      revived.once('error', reject);
      revived.listen(deadPort, '127.0.0.1', () => resolve());
    });
    onCleanup(() => revived.close());

    const freshLocal = await relay.forwardPort(deadPort);
    expect(relay.activeForwards()).toEqual([{ remotePort: deadPort, localPort: freshLocal }]);
    const client = await connectClient(freshLocal);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('recreated');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('closeForward closes the forward and its listener; false for unknown ports', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());

    const localPort = await relay.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());

    expect(relay.closeForward(port)).toBe(true);
    expect(relay.activeForwards()).toEqual([]);
    // The local listener is gone and the in-flight socket is destroyed.
    await waitForClose(client);
    await expect(connectClient(localPort)).rejects.toThrow();
    // Closing again (or a never-forwarded port) reports false.
    expect(relay.closeForward(port)).toBe(false);
    expect(relay.closeForward(1)).toBe(false);

    // A later forwardPort recreates the forward fresh.
    const freshLocal = await relay.forwardPort(port);
    const fresh = await connectClient(freshLocal);
    onCleanup(() => fresh.destroy());
    const payload = Buffer.from('reopened');
    const received = collectUntil(fresh, payload.length);
    fresh.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('notifies onForwardDropped for refused-connect drops and explicit closeForward', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    // A port with nothing listening: grab an ephemeral port then release it.
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const relay = new DirectRelay();
    onCleanup(() => relay.dispose());
    const dropped: number[] = [];
    relay.onForwardDropped = (remotePort) => dropped.push(remotePort);

    const deadLocal = await relay.forwardPort(deadPort);
    const refused = await connectClient(deadLocal);
    await waitForClose(refused);
    await waitFor(() => dropped.length === 1);
    expect(dropped).toEqual([deadPort]);

    await relay.forwardPort(healthy.port);
    expect(relay.closeForward(healthy.port)).toBe(true);
    expect(dropped).toEqual([deadPort, healthy.port]);
  });

  it('keeps an idle forward alive well past the old 10-minute idle timeout', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    // Fake the JS timers (real net I/O keeps flowing) so any lingering idle
    // sweep armed at construction/forward time would fire during the jump.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    let localPort: number;
    try {
      const relay = new DirectRelay();
      onCleanup(() => relay.dispose());
      localPort = await relay.forwardPort(port);
      vi.advanceTimersByTime(11 * 60_000);
      expect(relay.activeForwards()).toEqual([{ remotePort: port, localPort }]);
    } finally {
      vi.useRealTimers();
    }
    // The forward still accepts connections and relays after the idle jump.
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('still alive');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('dispose tears everything down and further use is rejected', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const relay = new DirectRelay();
    const localPort = await relay.forwardPort(port);
    relay.dispose();
    await expect(connectClient(localPort)).rejects.toThrow();
    await expect(relay.forwardPort(port)).rejects.toThrow(/disposed/);
  });
});
