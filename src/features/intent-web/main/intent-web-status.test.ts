// @vitest-environment node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { deriveSessionToken, SESSION_COOKIE } from '../../browser-access/main/browser-access-auth';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

// Holds store reads while `hold` is set so a test can finish them in any order.
const reads = vi.hoisted(() => ({ hold: false, pending: [] as Array<() => void> }));
vi.mock('../../backend/main/connections-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../backend/main/connections-store')>();
  return {
    ...actual,
    createConnectionsStore: (...args: Parameters<typeof actual.createConnectionsStore>) => {
      const store = actual.createConnectionsStore(...args);
      const list = store.list.bind(store);
      store.list = async () => {
        if (reads.hold) await new Promise<void>((resolve) => reads.pending.push(resolve));
        return list();
      };
      return store;
    },
  };
});

import { createIntentWebServer } from './intent-web-server';

type Pushed = { connections: Array<{ id: string; status?: string }> };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  reads.hold = false;
  for (const release of reads.pending.splice(0)) release();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-status-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A local "daemon" that accepts and holds connections.
  const socketPath = path.join(dir, 'd.sock');
  const sockets = new Set<net.Socket>();
  const daemon = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => daemon.listen(socketPath, resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => daemon.close(() => resolve()));
  });
  const server = await createIntentWebServer({
    dataDir: path.join(dir, 'data'),
    webRoot: dir,
    getAccessKey: () => 'key',
    localSocket: socketPath,
    tailcatAvailable: false,
    tailcatBinary: null,
  });
  cleanups.push(() => server.close());
  const port = await server.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const headers = { Cookie: `${SESSION_COOKIE}=${deriveSessionToken('key')}`, Origin: origin };
  const pushed: Pushed[] = [];
  const events = await fetch(origin + '/__intent-web/events', { headers });
  const reader = events.body!.getReader();
  cleanups.push(() => reader.cancel().catch(() => {}));
  void (async () => {
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += new TextDecoder().decode(value);
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
        buffer = buffer.slice(end + 2);
        if (data) pushed.push(JSON.parse(data) as Pushed);
      }
    }
  })();
  const openTab = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/intentd/ws/local`, { headers });
    cleanups.push(() => ws.terminate());
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    return ws;
  };
  const listed = async () => {
    const response = await fetch(origin + '/__intent-web/connections', { headers });
    return ((await response.json()) as Pushed).connections.find((c) => c.id === 'local')?.status;
  };
  const lastPushed = () => pushed.at(-1)?.connections.find((c) => c.id === 'local')?.status;
  return { openTab, listed, lastPushed, pushed };
}

it('ends connected when a tab reloads and the older store read finishes last', async () => {
  const { openTab, listed, lastPushed, pushed } = await start();
  const first = await openTab();
  await vi.waitFor(() => expect(lastPushed()).toBe('connected'));

  reads.hold = true;
  first.close();
  await vi.waitFor(() => expect(reads.pending.length).toBeGreaterThan(0));
  const second = await openTab();
  // Let any newer reads run first, then the read the close started.
  const [closeRead, ...later] = reads.pending.splice(0);
  for (const release of later) release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  reads.hold = false;
  for (const release of reads.pending.splice(0)) release();
  closeRead();

  const count = pushed.length;
  await vi.waitFor(async () => {
    expect(await listed()).toBe('connected');
    expect(pushed.length).toBeGreaterThanOrEqual(count);
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(lastPushed()).toBe('connected');
  expect(second.readyState).toBe(WebSocket.OPEN);
});

it('keeps a machine connected while another tab still has it open', async () => {
  const { openTab, listed, lastPushed } = await start();
  const first = await openTab();
  await openTab();
  await vi.waitFor(() => expect(lastPushed()).toBe('connected'));
  first.close();
  await once(first, 'close');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(lastPushed()).toBe('connected');
  expect(await listed()).toBe('connected');
});
