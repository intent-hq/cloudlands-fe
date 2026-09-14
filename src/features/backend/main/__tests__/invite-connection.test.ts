import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import https from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

/**
 * `/invite` redemption client (features/backend/main/invite-connection.ts)
 * against a fake WSS daemon presenting a pinned self-signed cert. Covers the
 * two-phase `invite.redeem` wire shape (intentd #1872), the handshake-level
 * pin, `error.data.code` routing, and the multi-host race.
 */

const nodeRequire = createRequire(import.meta.url);
const { WebSocketServer } = nodeRequire('ws') as typeof import('ws');

// Same self-signed EC cert as backend-connection.test.ts (CN=localhost, SAN 127.0.0.1).
const WSS_CERT_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJtVENDQVQrZ0F3SUJBZ0lVWVlzc05zWkxXdTZXZXdkb2p6UlpFY3k0LzRzd0NnWUlLb1pJemowRUF3SXcKRkRFU01CQUdBMVVFQXd3SmJHOWpZV3hvYjNOME1CNFhEVEkyTURnd056QXhOVGt6TkZvWERUTTJNRGd3TkRBeApOVGt6TkZvd0ZERVNNQkFHQTFVRUF3d0piRzlqWVd4b2IzTjBNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBECkFRY0RRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUDZBREkKeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Y2TnZNRzB3SFFZRFZSME9CQllFRk80WTZBc2c2NEJVV1RhQgo2SzBUeDgvczR2S21NQjhHQTFVZEl3UVlNQmFBRk80WTZBc2c2NEJVV1RhQjZLMFR4OC9zNHZLbU1BOEdBMVVkCkV3RUIvd1FGTUFNQkFmOHdHZ1lEVlIwUkJCTXdFWUlKYkc5allXeG9iM04waHdSL0FBQUJNQW9HQ0NxR1NNNDkKQkFNQ0EwZ0FNRVVDSVFET3hKTXBKcy9DcmQwOG95U2tGdVRueVo0c3VqVklvL3BDK1RVWUpRMEY5UUlnU2pvagppWG56RlZ0Q1U0Wll2VWFtRkc0bFNUYmlQano5QXlubWxpSkI1a289Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K',
  'base64',
).toString('utf8');

const WSS_KEY_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBFQyBQQVJBTUVURVJTLS0tLS0KQmdncWhrak9QUU1CQnc9PQotLS0tLUVORCBFQyBQQVJBTUVURVJTLS0tLS0KLS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0NBUUVFSVBLTnFYZll2aEdqbDErMmNpMmEyOFZDNC9BbTVWLzBOV1JvS0cxeWlLbWFvQW9HQ0NxR1NNNDkKQXdFSG9VUURRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUAo2QURJeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Z3PT0KLS0tLS1FTkQgRUMgUFJJVkFURSBLRVktLS0tLQo=',
  'base64',
).toString('utf8');

interface RpcReq {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}
type Outcome = { result?: unknown; error?: { code: number; message: string; data?: unknown } };

class FakeInviteDaemon {
  private server!: https.Server;
  private wss!: import('ws').WebSocketServer;
  private clients: import('ws').WebSocket[] = [];
  port = 0;
  fingerprint = '';
  upgradeUrls: string[] = [];
  requests: RpcReq[] = [];
  decryptedBytes = 0;
  handler: (req: RpcReq) => Outcome | Promise<Outcome> = () => ({ result: null });

  async start(): Promise<void> {
    this.fingerprint = new crypto.X509Certificate(WSS_CERT_PEM).fingerprint256;
    this.server = https.createServer({ cert: WSS_CERT_PEM, key: WSS_KEY_PEM });
    this.server.on('secureConnection', (socket) => {
      socket.on('data', (chunk: Buffer) => {
        this.decryptedBytes += chunk.length;
      });
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (socket, req) => {
      this.upgradeUrls.push(req.url ?? '');
      this.clients.push(socket);
      socket.on('message', async (data, isBinary) => {
        if (isBinary) return;
        const rpc = JSON.parse(String(data)) as RpcReq;
        this.requests.push(rpc);
        const outcome = await this.handler(rpc);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, ...outcome }));
      });
    });
    await new Promise<void>((res) => this.server.listen(0, '127.0.0.1', () => res()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    await new Promise<void>((res) => this.wss.close(() => res()));
    await new Promise<void>((res) => this.server.close(() => res()));
  }
}

const START = {
  flowId: 'flow_1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
  workspaceId: 'ws_1',
  workspaceTitle: 'Shared project',
};
const CREDENTIAL = {
  status: 'authorized',
  token: 't'.repeat(64),
  principalId: 'prn_7',
  login: 'octocat',
  workspaceId: 'ws_1',
};

describe('openInviteConnection', () => {
  let daemon: FakeInviteDaemon;

  beforeAll(async () => {
    daemon = new FakeInviteDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(() => {
    daemon.handler = () => ({ result: null });
    daemon.requests = [];
    daemon.upgradeUrls = [];
  });

  it('dials /invite and runs both invite.redeem phases with the documented params', async () => {
    daemon.handler = (req) => {
      if (req.method !== 'invite.redeem') return { error: { code: -32001, message: 'nope' } };
      if (typeof req.params?.flowId === 'string') return { result: CREDENTIAL };
      return { result: START };
    };
    const { openInviteConnection } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint.toLowerCase(),
    });
    try {
      expect(conn.host).toBe('127.0.0.1');
      expect(daemon.upgradeUrls).toEqual(['/invite']);
      await expect(conn.redeemStart('inv_1', 's3cret')).resolves.toEqual(START);
      await expect(conn.redeemWait('flow_1', 5_000)).resolves.toEqual(CREDENTIAL);
      expect(daemon.requests.map((r) => [r.method, r.params])).toEqual([
        ['invite.redeem', { inviteId: 'inv_1', secret: 's3cret' }],
        ['invite.redeem', { flowId: 'flow_1' }],
      ]);
    } finally {
      conn.close();
    }
  });

  it('surfaces error.data.code as inviteCode so the flow routes on the code', async () => {
    daemon.handler = () => ({
      error: {
        code: -32602,
        message: 'invalid params: invite has expired',
        data: { code: 'invite-expired' },
      },
    });
    const { openInviteConnection, InviteRpcError } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint,
    });
    try {
      const err = await conn.redeemStart('inv_1', 's3cret').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteRpcError);
      expect(err).toMatchObject({ code: -32602, inviteCode: 'invite-expired' });
    } finally {
      conn.close();
    }
  });

  it('refuses a foreign certificate before any application byte reaches the wire', async () => {
    // Let the previous test's close frame drain before sampling the counter.
    await new Promise((r) => setTimeout(r, 50));
    const before = daemon.decryptedBytes;
    const { openInviteConnection } = await import('../invite-connection');
    const { PinMismatchError } = await import('../backend-connection');
    const wrongPin = 'AA:'.repeat(31) + 'AA';
    await expect(
      openInviteConnection(
        { hosts: ['127.0.0.1'], port: daemon.port, fingerprint: wrongPin },
        { timeoutMs: 3_000 },
      ),
    ).rejects.toBeInstanceOf(PinMismatchError);
    expect(daemon.decryptedBytes).toBe(before);
    expect(daemon.upgradeUrls).toEqual([]);
  });

  it('races candidate hosts and wins on the reachable one', async () => {
    daemon.handler = () => ({ result: START });
    const { openInviteConnection } = await import('../invite-connection');
    // 192.0.2.0/24 is TEST-NET-1: never routable, so it neither answers nor refuses.
    const conn = await openInviteConnection(
      { hosts: ['192.0.2.1', '127.0.0.1'], port: daemon.port, fingerprint: daemon.fingerprint },
      { timeoutMs: 5_000 },
    );
    try {
      expect(conn.host).toBe('127.0.0.1');
      await expect(conn.redeemStart('inv_1', 's3cret')).resolves.toEqual(START);
    } finally {
      conn.close();
    }
  });

  it('rejects pending requests when the connection is closed', async () => {
    daemon.handler = () => new Promise(() => {});
    const { openInviteConnection } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint,
    });
    const waiting = conn.redeemWait('flow_1', 0);
    conn.close();
    await expect(waiting).rejects.toThrow(/closed/);
    await expect(conn.redeemStart('x', 'y')).rejects.toThrow(/closed/);
  });

  it('rejects when every candidate is unreachable', async () => {
    const { openInviteConnection } = await import('../invite-connection');
    await expect(
      openInviteConnection(
        { hosts: ['127.0.0.1'], port: 1, fingerprint: daemon.fingerprint },
        { timeoutMs: 3_000 },
      ),
    ).rejects.toThrow();
    await expect(
      openInviteConnection({ hosts: [], port: daemon.port, fingerprint: daemon.fingerprint }),
    ).rejects.toThrow(/no host/);
  });
});
