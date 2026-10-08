/** Test-only loopback relay: real WSS authentication, explicit request/ACK delivery gates. */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import WebSocket, { WebSocketServer } from 'ws';

export interface DaemonFixture {
  base: string;
  port: number;
  workspaceId: string;
  ownerToken: string;
  guestToken: string;
  guestId: string;
}
export async function connect(fixture: DaemonFixture, token: string) {
  if (!/^\/tmp\/intent-optimistic-[^/]+$/.test(fixture.base)) {
    throw new Error('Functional tests require the dedicated temporary daemon fixture');
  }
  const fingerprint = new X509Certificate(readFileSync(`${fixture.base}/ws-cert.pem`))
    .fingerprint256;
  const socket = new WebSocket(`wss://127.0.0.1:${fixture.port}/ws?token=${token}`, {
    rejectUnauthorized: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('upgrade', (response) => {
      if ((response.socket as TLSSocket).getPeerCertificate().fingerprint256 !== fingerprint) {
        socket.terminate();
        reject(new Error('Isolated daemon certificate mismatch'));
      }
    });
    socket.once('open', resolve);
  });
  return socket;
}
export function rpcClient(socket: WebSocket) {
  let serial = 0;
  return (method: string, params: object = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timeout = setTimeout(() => {
        socket.off('message', receive);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30000);
      function receive(data: WebSocket.RawData) {
        const frame = JSON.parse(data.toString());
        if (frame.id !== id) return;
        clearTimeout(timeout);
        socket.off('message', receive);
        if (frame.error) reject(new Error(JSON.stringify(frame.error)));
        else resolve(frame.result);
      }
      socket.on('message', receive);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
}
export async function createRelay(fixture: DaemonFixture) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const peers: WebSocket[] = [];
  const calls: Array<{ method: string; params: any }> = [];
  const errors: Array<{ method: string | undefined; error: unknown }> = [];
  const replies: Array<{ method: string | undefined; result: any }> = [];
  const gates = new Map<string, Array<() => void>>();
  server.on('connection', async (browser) => {
    peers.push(browser);
    const buffered: WebSocket.RawData[] = [];
    const buffer = (data: WebSocket.RawData) => buffered.push(data);
    browser.on('message', buffer);
    const upstream = await connect(fixture, fixture.ownerToken);
    browser.off('message', buffer);
    peers.push(upstream);
    const requests = new Map<number, string>();
    browser.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      requests.set(frame.id, frame.method);
      calls.push(frame);
      const send = () => upstream.send(data.toString());
      const gate = gates.get(`request:${frame.method}`);
      if (gate) gate.push(send);
      else send();
    });
    upstream.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      const method = frame.id !== undefined ? requests.get(frame.id) : frame.method;
      if (frame.error) errors.push({ method, error: frame.error });
      if (frame.id !== undefined) replies.push({ method, result: frame.result });
      const send = () => {
        if (browser.readyState === WebSocket.OPEN) browser.send(data.toString());
      };
      const gate = gates.get(`${frame.id !== undefined ? 'response' : 'event'}:${method}`);
      if (gate) gate.push(send);
      else send();
    });
    buffered.forEach((data) => browser.emit('message', data));
    browser.on('close', () => upstream.close());
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    calls,
    errors,
    replies,
    hold(method: string, phase: 'request' | 'response' | 'event') {
      const key = `${phase}:${method}`;
      const pending: Array<() => void> = [];
      gates.set(key, pending);
      return {
        pending,
        release() {
          gates.delete(key);
          pending.splice(0).forEach((send) => send());
        },
      };
    },
    close() {
      peers.forEach((peer) => peer.terminate());
      server.close();
    },
  };
}
