import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createRequire } from 'node:module';
import net, { type AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import type { TailcatSpawn } from '../tailcat-tunnel';

/**
 * `/invite` join client (features/backend/main/invite-connection.ts) against
 * a fake WSS daemon presenting a pinned self-signed cert. Covers the
 * challenge-and-prove wire shape (intentd #1967), the handshake-level pin,
 * `error.data.code` routing, and the multi-host race.
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

  /** Server-side sockets still open (a torn-down client closes its side). */
  openClients(): number {
    return this.clients.filter((c) => c.readyState === c.OPEN).length;
  }

  async start(bindHost: string | undefined = '127.0.0.1'): Promise<void> {
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
    await new Promise<void>((res) => this.server.listen(0, bindHost, () => res()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    await new Promise<void>((res) => this.wss.close(() => res()));
    await new Promise<void>((res) => this.server.close(() => res()));
  }
}

/**
 * Fake tailcat pipe client that really relays its stdio to a loopback port:
 * the shape of `tailcat <tc-address> <port>` with the tc network replaced by
 * a TCP hop to the fake daemon. Records kill() like the tunnel suite's fake.
 */
class RelayChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  private readonly socket: net.Socket;
  constructor(relayPort: number) {
    super();
    this.socket = net.connect(relayPort, '127.0.0.1');
    this.socket.on('error', () => {});
    this.socket.on('close', () => this.emit('exit', 0));
    this.stdin.pipe(this.socket);
    this.socket.pipe(this.stdout);
  }
  kill(): boolean {
    this.killed = true;
    this.socket.destroy();
    return true;
  }
}

function relaySpawn(relayPort: number, children: RelayChild[], args: string[][]): TailcatSpawn {
  return (_command, spawnArgs) => {
    const child = new RelayChild(relayPort);
    children.push(child);
    args.push(spawnArgs);
    return child as unknown as ChildProcess;
  };
}

/**
 * Fake tailcat child that exits right away without relaying a byte — the
 * shape of a real client given a tc address it cannot rendezvous on.
 */
class DyingChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode = null;
  constructor() {
    super();
    setImmediate(() => {
      this.exitCode = 1;
      this.emit('exit', 1);
    });
  }
  kill(): boolean {
    return true;
  }
}

const dyingSpawn: TailcatSpawn = () => new DyingChild() as unknown as ChildProcess;

const CHALLENGE = {
  workspaceId: 'ws_1',
  workspaceTitle: 'Shared project',
  nonce: 'n'.repeat(43),
  nonceExpiresAt: '2026-09-17T12:05:00Z',
};
const PROOF = { nonce: CHALLENGE.nonce, gistId: 'gist0123abcdef', login: 'octocat' };
const CREDENTIAL = {
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

  it('dials /invite and runs invite.challenge then invite.prove with the documented params', async () => {
    daemon.handler = (req) => {
      if (req.method === 'invite.challenge') return { result: CHALLENGE };
      if (req.method === 'invite.prove') return { result: CREDENTIAL };
      return { error: { code: -32601, message: 'unknown' } };
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
      await expect(conn.challenge('inv_1', 's3cret')).resolves.toEqual(CHALLENGE);
      await expect(conn.prove('inv_1', 's3cret', PROOF, 5_000)).resolves.toEqual(CREDENTIAL);
      expect(daemon.requests.map((r) => [r.method, r.params])).toEqual([
        ['invite.challenge', { inviteId: 'inv_1', secret: 's3cret' }],
        [
          'invite.prove',
          {
            inviteId: 'inv_1',
            secret: 's3cret',
            nonce: PROOF.nonce,
            gistId: PROOF.gistId,
            login: PROOF.login,
          },
        ],
      ]);
    } finally {
      conn.close();
    }
  });

  // The host's own proof refusals (intentd #1967) and the owner's self-join
  // refusal (intentd #1986) route on `error.data.code` like every other
  // invite refusal.
  it.each(['proof-invalid', 'proof-expired', 'github-unreachable', 'owner-self-join'])(
    'surfaces an invite.prove refusal with %s as inviteCode',
    async (code) => {
      daemon.handler = (req) =>
        req.method === 'invite.prove'
          ? { error: { code: -32602, message: 'refused', data: { code } } }
          : { error: { code: -32601, message: 'unknown' } };
      const { openInviteConnection, InviteRpcError } = await import('../invite-connection');
      const conn = await openInviteConnection({
        hosts: ['127.0.0.1'],
        port: daemon.port,
        fingerprint: daemon.fingerprint,
      });
      try {
        const err = await conn.prove('inv_1', 's3cret', PROOF, 5_000).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InviteRpcError);
        expect(err).toMatchObject({ code: -32602, inviteCode: code });
      } finally {
        conn.close();
      }
    },
  );

  // Returning-guest join: `invite.inspect` previews without a proof and
  // `invite.accept` joins with the stored credential; a credential the host no
  // longer recognizes is the documented `credential-invalid` code.
  it('runs invite.inspect and invite.accept with the documented params and result shapes', async () => {
    const INSPECTION = {
      workspaceId: 'ws_1',
      workspaceTitle: 'Shared',
      hostname: 'studio.local',
      prettyHostname: 'Studio',
    };
    daemon.handler = (req) => {
      if (req.method === 'invite.inspect') return { result: INSPECTION };
      if (req.method === 'invite.accept') {
        return req.params?.credential === 'stored-token'
          ? { result: CREDENTIAL }
          : { error: { code: -32602, message: 'nope', data: { code: 'credential-invalid' } } };
      }
      return { error: { code: -32601, message: 'unknown' } };
    };
    const { openInviteConnection, InviteRpcError } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint,
    });
    try {
      await expect(conn.inspect('inv_1', 's3cret')).resolves.toEqual(INSPECTION);
      await expect(conn.accept('inv_1', 's3cret', 'stored-token')).resolves.toEqual(CREDENTIAL);
      const refused = await conn.accept('inv_1', 's3cret', 'revoked').catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(InviteRpcError);
      expect(refused).toMatchObject({ code: -32602, inviteCode: 'credential-invalid' });
      expect(daemon.requests.map((r) => [r.method, r.params])).toEqual([
        ['invite.inspect', { inviteId: 'inv_1', secret: 's3cret' }],
        ['invite.accept', { inviteId: 'inv_1', secret: 's3cret', credential: 'stored-token' }],
        ['invite.accept', { inviteId: 'inv_1', secret: 's3cret', credential: 'revoked' }],
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
      const err = await conn.challenge('inv_1', 's3cret').catch((e: unknown) => e);
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
    daemon.handler = () => ({ result: CHALLENGE });
    const { openInviteConnection } = await import('../invite-connection');
    // 192.0.2.0/24 is TEST-NET-1: never routable, so it neither answers nor refuses.
    const conn = await openInviteConnection(
      { hosts: ['192.0.2.1', '127.0.0.1'], port: daemon.port, fingerprint: daemon.fingerprint },
      { timeoutMs: 5_000 },
    );
    try {
      expect(conn.host).toBe('127.0.0.1');
      await expect(conn.challenge('inv_1', 's3cret')).resolves.toEqual(CHALLENGE);
    } finally {
      conn.close();
    }
  });

  it('rejects pending requests with connection-closed when the connection is closed', async () => {
    daemon.handler = () => new Promise(() => {});
    const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint,
    });
    const waiting = conn.prove('inv_1', 's3cret', PROOF, 0);
    conn.close();
    const closedError = await waiting.catch((e: unknown) => e);
    expect(closedError).toBeInstanceOf(InviteTransportError);
    expect(closedError).toMatchObject({ transportCode: 'connection-closed' });
    const afterClose = await conn.challenge('x', 'y').catch((e: unknown) => e);
    expect(afterClose).toBeInstanceOf(InviteTransportError);
    expect(afterClose).toMatchObject({ transportCode: 'connection-closed' });
  });

  it('rejects a prove request the daemon never answers with host-unreachable', async () => {
    daemon.handler = () => new Promise(() => {});
    const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
    const conn = await openInviteConnection({
      hosts: ['127.0.0.1'],
      port: daemon.port,
      fingerprint: daemon.fingerprint,
    });
    try {
      const err = await conn.prove('inv_1', 's3cret', PROOF, 200).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteTransportError);
      expect(err).toMatchObject({ transportCode: 'host-unreachable' });
    } finally {
      conn.close();
    }
  });

  it('rejects with host-refused when the only candidate refuses the connection', async () => {
    const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
    // Port 1 (tcpmux) has no listener on the test host: an immediate ECONNREFUSED.
    const err = await openInviteConnection(
      { hosts: ['127.0.0.1'], port: 1, fingerprint: daemon.fingerprint },
      { timeoutMs: 3_000 },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InviteTransportError);
    expect(err).toMatchObject({ transportCode: 'host-refused' });
    // A refused connection is not mistaken for a plain socket error: the
    // library's ECONNREFUSED text (which names the address) is not carried.
    expect((err as Error).message).not.toContain('127.0.0.1');
    await expect(
      openInviteConnection({ hosts: [], port: daemon.port, fingerprint: daemon.fingerprint }),
    ).rejects.toThrow(/no host/);
  });

  it('tears down every non-winning candidate once the race settles', async () => {
    // Dual-stack daemon so both spellings of loopback reach it and both
    // candidates can complete a pin-verified handshake.
    const shared = new FakeInviteDaemon();
    await shared.start(undefined);
    shared.handler = () => ({ result: CHALLENGE });
    const { openInviteConnection } = await import('../invite-connection');
    try {
      const conn = await openInviteConnection(
        { hosts: ['127.0.0.1', 'localhost'], port: shared.port, fingerprint: shared.fingerprint },
        { timeoutMs: 5_000 },
      );
      try {
        expect(['127.0.0.1', 'localhost']).toContain(conn.host);
        await expect(conn.challenge('inv_1', 's3cret')).resolves.toEqual(CHALLENGE);
        // The loser — connecting or already open — is destroyed, so at most
        // the winner's socket remains open on the daemon side.
        await vi.waitFor(() => expect(shared.openClients()).toBe(1), { timeout: 3_000 });
      } finally {
        conn.close();
      }
      await vi.waitFor(() => expect(shared.openClients()).toBe(0), { timeout: 3_000 });
    } finally {
      await shared.stop();
    }
  });

  it('destroys a candidate still stuck in its handshake when the deadline hits', async () => {
    // Accepts TCP but never answers the TLS ClientHello: the dial can only
    // end by the overall deadline, and its socket must not outlive it.
    const accepted: net.Socket[] = [];
    let closedCount = 0;
    const blackhole = net.createServer((socket) => {
      accepted.push(socket);
      // Drain the ClientHello so the readable side can observe the peer's
      // FIN ('end' → auto-close); a paused socket never emits 'close'.
      socket.resume();
      socket.on('close', () => {
        closedCount += 1;
      });
    });
    await new Promise<void>((res) => blackhole.listen(0, '127.0.0.1', () => res()));
    const port = (blackhole.address() as AddressInfo).port;
    const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
    try {
      const err = await openInviteConnection(
        { hosts: ['127.0.0.1'], port, fingerprint: daemon.fingerprint },
        { timeoutMs: 500 },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteTransportError);
      expect(err).toMatchObject({ transportCode: 'host-unreachable' });
      await vi.waitFor(() => expect(accepted.length).toBe(1), { timeout: 3_000 });
      await vi.waitFor(() => expect(closedCount).toBe(1), { timeout: 3_000 });
    } finally {
      for (const s of accepted) s.destroy();
      await new Promise<void>((res) => blackhole.close(() => res()));
    }
  });

  describe('tunnel fallback', () => {
    const previousTailcatBin = process.env.TAILCAT_BIN;
    beforeAll(() => {
      // Any existing file passes the binary probe; the injected spawn never
      // executes it.
      process.env.TAILCAT_BIN = process.execPath;
    });
    afterAll(() => {
      if (previousTailcatBin === undefined) delete process.env.TAILCAT_BIN;
      else process.env.TAILCAT_BIN = previousTailcatBin;
    });

    it('hosts=[] + tc (the daemon default) dials the tunnel with the pin enforced', async () => {
      daemon.handler = () => ({ result: CHALLENGE });
      const children: RelayChild[] = [];
      const args: string[][] = [];
      const { openInviteConnection } = await import('../invite-connection');
      const conn = await openInviteConnection(
        {
          hosts: [],
          port: daemon.port,
          fingerprint: daemon.fingerprint,
          tcAddress: ' TC-Key-ABC ',
        },
        { timeoutMs: 5_000, tailcatSpawn: relaySpawn(daemon.port, children, args) },
      );
      try {
        expect(conn.via).toBe('tunnel');
        expect(conn.host).toBe('TC-Key-ABC');
        expect(args).toEqual([['TC-Key-ABC', String(daemon.port)]]);
        expect(daemon.upgradeUrls).toEqual(['/invite']);
        await expect(conn.challenge('inv_1', 's3cret')).resolves.toEqual(CHALLENGE);
      } finally {
        conn.close();
      }
      await vi.waitFor(() => expect(children.every((c) => c.killed)).toBe(true), {
        timeout: 3_000,
      });
    });

    it('passes the tc address to tailcat byte-for-byte (base64url is case-sensitive)', async () => {
      daemon.handler = () => ({ result: CHALLENGE });
      const children: RelayChild[] = [];
      const args: string[][] = [];
      const tcAddress =
        'tcO2FwWCCz0cQ-4LS-CykXcxAP81C7kREV9iftw3EJi5SBsr6EH2FrWCCUw7CJSXjETiP08mBzLNbZq1oMcXwMAlHysI25i6Ifd2FpGQEw';
      const { openInviteConnection } = await import('../invite-connection');
      const conn = await openInviteConnection(
        {
          hosts: [],
          port: daemon.port,
          fingerprint: daemon.fingerprint,
          tcAddress: ` ${tcAddress} `,
        },
        { timeoutMs: 5_000, tailcatSpawn: relaySpawn(daemon.port, children, args) },
      );
      try {
        expect(conn.via).toBe('tunnel');
        expect(conn.host).toBe(tcAddress);
        expect(args).toEqual([[tcAddress, String(daemon.port)]]);
      } finally {
        conn.close();
      }
      await vi.waitFor(() => expect(children.every((c) => c.killed)).toBe(true), {
        timeout: 3_000,
      });
    });

    it('falls back to the tunnel when every direct host fails, and closes it on failure', async () => {
      daemon.handler = () => ({ result: CHALLENGE });
      const children: RelayChild[] = [];
      const { openInviteConnection } = await import('../invite-connection');
      // Direct: port 1 refuses at once. The relay ignores the remote port
      // argument and hops to the real daemon, as the tc network would.
      const conn = await openInviteConnection(
        { hosts: ['127.0.0.1'], port: 1, fingerprint: daemon.fingerprint, tcAddress: 'tc-key' },
        { timeoutMs: 5_000, tailcatSpawn: relaySpawn(daemon.port, children, []) },
      );
      try {
        expect(conn.via).toBe('tunnel');
        expect(conn.host).toBe('tc-key');
        await expect(conn.challenge('inv_1', 's3cret')).resolves.toEqual(CHALLENGE);
      } finally {
        conn.close();
      }

      // A foreign cert through the tunnel is a pin mismatch, and the tunnel
      // (with its tailcat child) is torn down with the failed dial.
      const { PinMismatchError } = await import('../backend-connection');
      const mismatchChildren: RelayChild[] = [];
      await expect(
        openInviteConnection(
          {
            hosts: [],
            port: daemon.port,
            fingerprint: 'AA:'.repeat(31) + 'AA',
            tcAddress: 'tc-key',
          },
          { timeoutMs: 3_000, tailcatSpawn: relaySpawn(daemon.port, mismatchChildren, []) },
        ),
      ).rejects.toBeInstanceOf(PinMismatchError);
      await vi.waitFor(
        () => {
          expect(mismatchChildren.length).toBeGreaterThan(0);
          expect(mismatchChildren.every((c) => c.killed)).toBe(true);
        },
        { timeout: 3_000 },
      );
    });

    it('rejects with tunnel-failed when the tailcat child exits immediately', async () => {
      const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
      const err = await openInviteConnection(
        { hosts: [], port: daemon.port, fingerprint: daemon.fingerprint, tcAddress: 'tc-bad' },
        { timeoutMs: 3_000, tailcatSpawn: dyingSpawn },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteTransportError);
      expect(err).toMatchObject({ transportCode: 'tunnel-failed' });
      expect((err as Error).message).not.toContain('tc-bad');
    });

    it('rejects with tailcat-unavailable when no tailcat binary can be resolved', async ({
      skip,
    }) => {
      const { resolveTailcatBinaryPath } = await import('../tailcat-tunnel');
      const override = process.env.TAILCAT_BIN;
      process.env.TAILCAT_BIN = '/nonexistent/tailcat-for-invite-test';
      try {
        // A staged dev binary up the tree would satisfy the probe regardless
        // of the override; the code path under test needs a truly absent one.
        if (resolveTailcatBinaryPath() !== null) skip();
        const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
        const err = await openInviteConnection(
          { hosts: [], port: daemon.port, fingerprint: daemon.fingerprint, tcAddress: 'tc-key' },
          { timeoutMs: 3_000, tailcatSpawn: dyingSpawn },
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InviteTransportError);
        expect(err).toMatchObject({ transportCode: 'tailcat-unavailable' });
      } finally {
        process.env.TAILCAT_BIN = override;
      }
    });

    it('a refused direct host falling through to a dead tunnel reports the tunnel failure', async () => {
      const { openInviteConnection, InviteTransportError } = await import('../invite-connection');
      const err = await openInviteConnection(
        { hosts: ['127.0.0.1'], port: 1, fingerprint: daemon.fingerprint, tcAddress: 'tc-bad' },
        { timeoutMs: 3_000, tailcatSpawn: dyingSpawn },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteTransportError);
      expect(err).toMatchObject({ transportCode: 'tunnel-failed' });
    });
  });
});
