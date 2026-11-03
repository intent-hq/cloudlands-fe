// @vitest-environment node
import { tlsIdentities } from './intent-web-tls.fixture';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { createIntentWebServer } from './intent-web-server';
import { deriveSessionToken, SESSION_COOKIE } from '../../browser-access/main/browser-access-auth';
const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
async function browsersClosed(ws: { close(): void; readyState: number }) {
  const closing = once(ws as never, 'close');
  ws.close();
  await closing;
}
it('routes two saved machines independently and closes only the forgotten bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bridge-'));
  const daemons: Array<{
    http: https.Server;
    wss: InstanceType<typeof WebSocketServer>;
    port: number;
    fingerprint: string;
    sockets: Set<import('node:net').Socket>;
  }> = [];
  const browsers: InstanceType<typeof WebSocket>[] = [];
  const server = await createIntentWebServer({
    dataDir: path.join(dir, 'data'),
    webRoot: dir,
    getAccessKey: () => 'key',
    localSocket: null,
    tailcatAvailable: false,
    tailcatBinary: null,
  });
  try {
    for (const name of ['one', 'two']) {
      const { cert, key } = tlsIdentities[name === 'one' ? 0 : 1];
      const http = https.createServer({ cert, key });
      const sockets = new Set<import('node:net').Socket>();
      http.on('connection', (s) => {
        sockets.add(s);
        s.once('close', () => sockets.delete(s));
      });
      const wss = new WebSocketServer({ noServer: true });
      http.on('upgrade', (req, socket, head) => {
        if (req.headers.authorization !== `Bearer ${name}`) {
          socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) =>
          ws.on('message', (raw) => {
            const request = JSON.parse(String(raw));
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: name }));
          }),
        );
      });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      daemons.push({
        http,
        wss,
        sockets,
        fingerprint: new crypto.X509Certificate(cert).fingerprint256,
        port: (http.address() as import('node:net').AddressInfo).port,
      });
    }
    const port = await server.listen(0),
      origin = `http://127.0.0.1:${port}`;
    const headers = {
      Cookie: `${SESSION_COOKIE}=${deriveSessionToken('key')}`,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const ids: string[] = [];
    for (const [i, daemon] of daemons.entries()) {
      const name = i === 0 ? 'one' : 'two';
      const response = await fetch(origin + '/__intent-web/connections', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          label: name,
          host: '127.0.0.1',
          port: daemon.port,
          fingerprint: daemon.fingerprint,
          token: name,
        }),
      });
      const { connection } = await response.json();
      ids.push(connection.id);
      const tested = await fetch(origin + `/__intent-web/connections/${connection.id}/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ host: '127.0.0.1', port: daemon.port }),
      });
      expect(await tested.json()).toMatchObject({ status: 'success' });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/intentd/ws/${connection.id}`, { headers });
      browsers.push(ws);
      await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
      const reply = once(ws, 'message', { signal: AbortSignal.timeout(5000) });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test.echo', params: {} }));
      expect(JSON.parse(String((await reply)[0]))).toEqual({ jsonrpc: '2.0', id: 1, result: name });
    }
    const statuses = async () => {
      const response = await fetch(origin + '/__intent-web/connections', { headers });
      const { connections } = (await response.json()) as {
        connections: Array<{ id: string; status?: string }>;
      };
      return Object.fromEntries(connections.map((c) => [c.id, c.status]));
    };
    // A machine with a live browser bridge reads as connected in every tab's list.
    expect(await statuses()).toEqual({ [ids[0]]: 'connected', [ids[1]]: 'connected' });
    const events = await fetch(origin + '/__intent-web/events', { headers });
    const reader = events.body!.getReader();
    const closed = once(browsers[0], 'close');
    expect(
      (
        await fetch(origin + `/__intent-web/connections/${ids[0]}`, {
          method: 'DELETE',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(200);
    await closed;
    expect(browsers[1].readyState).toBe(WebSocket.OPEN);
    await browsersClosed(browsers[1]);
    // Closing the last bridge pushes the change to open tabs.
    let pushed = '';
    while (!pushed.includes('"status":"not-open"')) {
      const { value, done } = await reader.read();
      if (done) break;
      pushed += new TextDecoder().decode(value);
    }
    expect(pushed).toContain('event: connections:changed');
    expect(await statuses()).toEqual({ [ids[1]]: 'not-open' });
    await reader.cancel();
  } finally {
    for (const ws of browsers) ws.terminate();
    await server.close();
    for (const d of daemons) {
      for (const ws of d.wss.clients) ws.terminate();
      d.wss.close();
      for (const socket of d.sockets) socket.destroy();
      await new Promise<void>((resolve) => d.http.close(() => resolve()));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
