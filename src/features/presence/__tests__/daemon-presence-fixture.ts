/**
 * Opt-in, disposable protocol fixture. Nothing starts during module evaluation.
 * Port/config/auth/forge/route-advertisement semantics mirror intentd's
 * e2e_wss_invite_join_gitlab.rs and invite_join/presence.rs. This is NOT a real
 * tunnel, provider bootstrap, installed daemon or native-window test.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import type { ConnectionOptions } from 'node:tls';
import type { WebSocket } from 'ws';
import { normalizeFingerprint, pinnedTlsConnect } from '$features/backend/main/backend-connection';
import type { BrowserWebSocketLike } from '$lib/client/live/browser-websocket-transport';

// The ordinary Vitest config aliases the ESM ws import to a browser stub.
const { WebSocket: NodeWebSocket } = createRequire(import.meta.url)('ws') as {
  WebSocket: typeof WebSocket;
};
type Row = Record<string, any>;
export type Frame = { id?: number; method?: string; params?: Row; result?: any; error?: Row };
export type Guest = { principalId: string; token: string; login: string };
type Binding = {
  daemonPath: string;
  daemonSha256: string;
  daemonCommit: string;
  docsCommit: string;
  evidenceDir: string;
};

/** External DATA supplies the approved archive and immutable source binding. */
async function binding(): Promise<Binding> {
  const file = process.env.INTENT_PRESENCE_FIXTURE_INPUT;
  if (!file || !isAbsolute(file)) throw new Error('Requested fixture needs an absolute input file');
  const value = JSON.parse(await readFile(file, 'utf8')) as Binding;
  if (
    !isAbsolute(value.daemonPath ?? '') ||
    !isAbsolute(value.evidenceDir ?? '') ||
    !/^[a-f0-9]{64}$/.test(value.daemonSha256 ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.daemonCommit ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.docsCommit ?? '')
  )
    throw new Error('Invalid fixture archive/source binding');
  const actual = createHash('sha256')
    .update(await readFile(value.daemonPath))
    .digest('hex');
  if (actual !== value.daemonSha256) throw new Error('Fixture archive hash mismatch');
  value.daemonPath = await realpath(value.daemonPath);
  return value;
}

export async function eventually(
  check: () => boolean | Promise<boolean>,
  label: string,
  budgetMs = 10_000,
) {
  const deadline = Date.now() + budgetMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Fixture readiness deadline: ${label}`);
    // Readiness polling, never an assertion that elapsed time implies success.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function socket(port: number, fingerprint: string, token?: string): WebSocket {
  const endpoint = token ? `/ws?token=${encodeURIComponent(token)}` : '/invite';
  return new NodeWebSocket(`wss://127.0.0.1:${port}${endpoint}`, {
    rejectUnauthorized: false,
    createConnection: ((options: ConnectionOptions) =>
      pinnedTlsConnect(options, normalizeFingerprint(fingerprint))) as never,
  });
}

/** Raw control sockets deliberately do NOT issue client.hello implicitly. */
export class RpcSocket {
  readonly frames: Frame[] = [];
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  readonly ready: Promise<void>;
  forcedClose = false;
  constructor(readonly wire: WebSocket) {
    this.ready = new Promise((resolve, reject) => {
      wire.once('open', resolve);
      wire.once('error', () => reject(new Error('Fixture WSS handshake failed')));
    });
    wire.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      // Retain notifications only: invitation replies contain credentials.
      if (frame.method) this.frames.push(frame);
      const request = frame.id === undefined ? undefined : this.pending.get(frame.id);
      if (!request) return;
      this.pending.delete(frame.id!);
      clearTimeout(request.timer);
      if (frame.error) {
        const error = new Error(
          `Fixture RPC refused: ${frame.error.data?.code ?? frame.error.code}`,
        );
        Object.assign(error, { code: frame.error.data?.code, rpcCode: frame.error.code });
        request.reject(error);
      } else request.resolve(frame.result);
    });
    wire.on('error', () => undefined); // Errors surface through readiness/pending calls, without URL/token logging.
    wire.on('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Fixture socket closed'));
      }
      this.pending.clear();
    });
  }
  async request<T = any>(method: string, params: Row = {}): Promise<T> {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Fixture RPC deadline: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.wire.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
  async close() {
    if (this.wire.readyState === NodeWebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.wire.once('close', () => resolve()));
    const timer = setTimeout(() => {
      this.forcedClose = true;
      this.wire.terminate();
    }, 1000);
    this.wire.close();
    try {
      await closed;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type DeliveryHold = {
  frames: Frame[];
  release: () => void;
};

/** Real network socket, with explicitly controlled delivery of selected ORIGINAL frames. */
export class RendererWire {
  readonly requests: Array<{ id: number; method: string; params: Row }> = [];
  readonly received: Frame[] = [];
  readonly sockets: WebSocket[] = [];
  private gate: {
    predicate: (frame: Frame, method?: string) => boolean;
    frames: Frame[];
    deliver: Array<() => void>;
  } | null = null;
  constructor(
    private port: number,
    private fingerprint: string,
    private token: string,
  ) {}
  hold(predicate: (frame: Frame, method?: string) => boolean): DeliveryHold {
    if (this.gate) throw new Error('One controlled delivery hold at a time');
    const gate = { predicate, frames: [] as Frame[], deliver: [] as Array<() => void> };
    this.gate = gate;
    return {
      frames: gate.frames,
      release: () => {
        if (this.gate === gate) this.gate = null;
        for (const deliver of gate.deliver.splice(0)) deliver();
      },
    };
  }
  create = (): BrowserWebSocketLike => {
    const wire = socket(this.port, this.fingerprint, this.token);
    this.sockets.push(wire);
    const methods = new Map<number, string>();
    const adapter: BrowserWebSocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (data) => {
        const frame = JSON.parse(data);
        methods.set(frame.id, frame.method);
        this.requests.push(frame);
        wire.send(data);
      },
      close: (code, reason) => wire.close(code, reason),
    };
    wire.on('open', () => adapter.onopen?.());
    wire.on('message', (data) => {
      const text = data.toString();
      const frame = JSON.parse(text) as Frame;
      this.received.push(frame);
      // Call the adapter's CURRENT callback when released. A retired socket's
      // callback still reaches the production transport's socket-identity fence.
      const deliver = () => adapter.onmessage?.({ data: text });
      if (this.gate?.predicate(frame, frame.id === undefined ? undefined : methods.get(frame.id))) {
        this.gate.frames.push(frame);
        this.gate.deliver.push(deliver);
      } else deliver();
    });
    wire.on('error', () => adapter.onerror?.());
    wire.on('close', () => adapter.onclose?.());
    return adapter;
  };
  disconnect() {
    this.sockets.at(-1)?.close();
  }
  async close() {
    this.gate = null;
    await Promise.all(
      this.sockets.map(async (wire) => {
        if (wire.readyState === NodeWebSocket.CLOSED) return;
        const done = new Promise<void>((resolve) => wire.once('close', () => resolve()));
        wire.terminate();
        await done;
      }),
    );
  }
}

export class DaemonPresenceFixture {
  private root = '';
  private evidence = '';
  private readonly openedAt = new Date().toISOString();
  private child?: ChildProcess;
  private childStart = '';
  private ownedIdentities = new Map<number, string>();
  private forge?: Server;
  private controls: RpcSocket[] = [];
  private gists = new Map<string, Row>();
  private users = new Map<string, number>([
    ['target-guest', 9001],
    ['remaining-guest', 9002],
    ['stable-guest', 9003],
  ]);
  private port = 0;
  private fingerprint = '';
  owner!: RpcSocket;
  observer!: RpcSocket;
  target!: Guest;
  remaining!: Guest;
  stable!: Guest;
  workspaceId = '';
  privateWorkspaceId = '';
  renderer!: RendererWire;
  targetLease?: RpcSocket;
  noteObserver?: RpcSocket;

  static async start() {
    const fixture = new DaemonPresenceFixture();
    try {
      await fixture.boot();
      return fixture;
    } catch (error) {
      try {
        await fixture.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Fixture startup and cleanup failed');
      }
      throw error;
    }
  }
  private async boot() {
    const input = await binding();
    this.evidence = await mkdtemp(join(input.evidenceDir, 'presence-fixture-'));
    await writeFile(
      join(this.evidence, 'binding.json'),
      JSON.stringify(
        {
          daemonSha256: input.daemonSha256,
          daemonCommit: input.daemonCommit,
          docsCommit: input.docsCommit,
          openedAt: this.openedAt,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    this.root = await mkdtemp(join(tmpdir(), 'pd-'));
    const gh = join(this.root, 'gh');
    const workspaces = join(this.root, 'workspaces');
    await mkdir(gh);
    await mkdir(workspaces);
    this.forge = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://fixture.invalid').pathname;
      const login = path.startsWith('/users/') ? path.slice('/users/'.length) : '';
      const id = this.users.get(login);
      const body = id
        ? { login, id, name: login, avatar_url: null }
        : path.startsWith('/gists/')
          ? this.gists.get(path.slice('/gists/'.length))
          : undefined;
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(body ?? { message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => this.forge!.listen(0, '127.0.0.1', resolve));
    const address = this.forge.address();
    if (!address || typeof address === 'string') throw new Error('Fixture forge did not bind');
    const base = `http://127.0.0.1:${address.port}`;
    const tailcat = join(this.root, 'route-advertisement.sh');
    // Host/workspace invite creation requires a tunnel address. This mirrors the
    // backend fake-tailcat fixture ONLY to satisfy local route advertisement;
    // every test connection goes directly to owned loopback WSS. No real tunnel.
    await writeFile(
      tailcat,
      '#!/bin/sh\ncase "$1" in\n genkey) for arg in "$@"; do case "$arg" in --key=*) printf fixture-key > "${arg#--key=}";; esac; done;;\n serve) printf \'{"listenAddr":"tc-presence-fixture"}\\n\'; exec sleep 600;;\nesac\n',
      { mode: 0o700 },
    );
    await writeFile(
      join(this.root, 'config.toml'),
      '[server.tunnel]\nenabled = true\n[server.wsApi]\nenabled = true\nport = 5181\n',
    );
    const token = randomBytes(32).toString('hex');
    // Whitelist, rather than inherit credentials, socket targets or node injection.
    const daemonLog = await open(join(this.root, 'daemon.log'), 'wx', 0o600);
    this.child = spawn(input.daemonPath, ['serve'], {
      detached: true,
      stdio: ['ignore', 'ignore', daemonLog.fd],
      env: {
        PATH: process.env.PATH,
        LANG: 'C.UTF-8',
        TMPDIR: this.root,
        INTENTD_DATA_DIR: this.root,
        INTENTD_WORKSPACES_DIR: workspaces,
        INTENTD_ASSERT_HERMETIC_ROOT: '1',
        INTENTD_AUTH_TOKEN: token,
        INTENTD_TCP_PORT: '0',
        INTENTD_SECRETS_FILE: join(this.root, 'secrets.json'),
        GH_CONFIG_DIR: gh,
        INTENTD_TAILCAT_BIN: tailcat,
        INTENTD_GITHUB_API_BASE_URI: base,
        INTENTD_GITHUB_LOGIN_BASE_URI: base,
        INTENTD_GITLAB_API_BASE_URI: base,
      },
    });
    await daemonLog.close();
    this.child.on('error', () => undefined);
    if (!this.child.pid) throw new Error('Fixture daemon did not spawn');
    this.childStart = await processIdentity(this.child.pid);
    this.ownedIdentities.set(this.child.pid, this.childStart);
    await writeFile(
      join(this.evidence, 'owned-child.json'),
      JSON.stringify(
        {
          pid: this.child.pid,
          startIdentity: this.childStart,
          root: this.root,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    let status: Row | undefined;
    await eventually(async () => {
      if (this.child?.exitCode !== null) throw new Error('Fixture daemon exited before readiness');
      try {
        status = await this.udsStatus();
        return typeof status?.port === 'number';
      } catch {
        return false;
      }
    }, 'owned daemon WSS');
    this.ownedIdentities = await ownedTree(this.child.pid);
    await writeFile(
      join(this.evidence, 'owned-tree.json'),
      JSON.stringify([...this.ownedIdentities], null, 2),
      { mode: 0o600 },
    );
    this.port = status!.port;
    this.fingerprint = status!.fingerprint;
    if (
      !Number.isInteger(this.port) ||
      this.port < 1 ||
      typeof this.fingerprint !== 'string' ||
      !this.fingerprint
    )
      throw new Error('Owned status did not return a WSS port/fingerprint');
    await writeFile(
      join(this.evidence, 'owned-listeners.json'),
      JSON.stringify(
        {
          wssPort: this.port,
          forgePort: address.port,
          fingerprint: this.fingerprint,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    this.owner = this.connect(token);
    await this.owner.request('client.hello', { clientId: 'fixture-owner' });
    const shared = await this.owner.request('workspace.create', {
      title: 'Shared presence fixture',
    });
    this.workspaceId = shared.workspace.id;
    this.privateWorkspaceId = (
      await this.owner.request('workspace.create', { title: 'Private fixture' })
    ).workspace.id;
    this.target = await this.join('target-guest');
    this.remaining = await this.join('remaining-guest');
    this.stable = await this.join('stable-guest');
    this.observer = this.connect(this.remaining.token);
    await this.observer.request('events.subscribe', {
      eventTypes: [
        'presence:changed',
        'workspace:updated',
        'host:members-changed',
        'host:invites-changed',
        'note:presence',
      ],
    });
    this.renderer = new RendererWire(this.port, this.fingerprint, this.remaining.token);
  }
  private udsStatus(): Promise<Row> {
    return new Promise((resolve, reject) => {
      const wire = createConnection(join(this.root, 'intentd.sock'));
      const timer = setTimeout(() => {
        wire.destroy();
        reject(new Error('Owned UDS readiness deadline'));
      }, 500);
      let data = '';
      const stop = () => {
        clearTimeout(timer);
        wire.destroy();
      };
      wire.on('error', () => {
        stop();
        reject(new Error('Owned UDS unavailable'));
      });
      wire.on('connect', () =>
        wire.write(
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.status', params: {} }) + '\n',
        ),
      );
      wire.on('data', (chunk) => {
        data += chunk.toString();
        if (!data.includes('\n')) return;
        stop();
        try {
          resolve(JSON.parse(data.split('\n')[0]).result);
        } catch {
          reject(new Error('Invalid owned status response'));
        }
      });
    });
  }
  connect(token?: string) {
    const connection = new RpcSocket(socket(this.port, this.fingerprint, token));
    this.controls.push(connection);
    return connection;
  }
  private async join(login: string): Promise<Guest> {
    const link = await this.owner.request('workspace.invite.create', {
      workspaceId: this.workspaceId,
      pinLogin: login,
      pinProvider: 'github',
    });
    const connection = this.connect();
    const claim = { inviteId: link.invite.id, secret: link.secret, scope: 'workspace' };
    const challenge = await connection.request('invite.challenge', claim);
    const gistId = String(this.users.get(login));
    this.gists.set(gistId, {
      owner: { login, id: this.users.get(login) },
      created_at: new Date().toISOString(),
      files: {
        'intent-join-proof.txt': {
          filename: 'intent-join-proof.txt',
          content: challenge.nonce,
          truncated: false,
        },
      },
    });
    const admitted = await connection.request('invite.prove', {
      ...claim,
      nonce: challenge.nonce,
      gistId,
      login,
      provider: 'github',
      host: 'github.com',
    });
    await connection.close();
    if (!admitted.token || !admitted.principalId || admitted.hostRole !== 'guest')
      throw new Error('Fixture guest admission failed');
    return { token: admitted.token, principalId: admitted.principalId, login };
  }
  async promote() {
    const link = await this.owner.request('host.invite.create', {
      pinLogin: this.target.login,
      pinProvider: 'github',
    });
    const connection = this.connect();
    const result = await connection.request('invite.accept', {
      inviteId: link.invite.id,
      secret: link.secret,
      scope: 'host',
      credential: this.target.token,
    });
    await connection.close();
    if (result.principalId !== this.target.principalId || result.hostRole !== 'member')
      throw new Error('Fixture host promotion failed');
  }
  async retainCachedTarget() {
    this.targetLease = this.connect(this.target.token); // No hello on the retained lease.
    await this.targetLease.request('note.presence.subscribe', {
      workspaceId: this.workspaceId,
      noteId: 'spec',
    });
    const online = this.connect(this.target.token);
    await online.request('client.hello', { clientId: 'fixture-target-transient' });
    await online.close();
    await eventually(
      async () =>
        !(await this.snapshot()).members.some(
          (p: Row) => p.principalId === this.target.principalId,
        ),
      'target offline after hello connection closes',
    );
    // This observer ensures ONLY its own profile. The target's retained viewer
    // and source gc_profile rule establish cache retention, not introspection.
    this.noteObserver = this.connect(this.remaining.token);
    const subscription = await this.noteObserver.request('note.presence.subscribe', {
      workspaceId: this.workspaceId,
      noteId: 'spec',
    });
    await eventually(
      () =>
        this.noteObserver!.frames.some(
          (f) =>
            f.method === 'subscription.push' &&
            f.params?.subscriptionId === subscription.subscriptionId &&
            f.params?.seq === 0,
        ),
      'non-repairing note observer',
    );
    const initial = this.noteObserver.frames.find(
      (f) => f.params?.subscriptionId === subscription.subscriptionId && f.params?.seq === 0,
    )!;
    const target = initial.params!.snapshot.viewers.find(
      (p: Row) => p.principalId === this.target.principalId,
    );
    if (target?.hostRole !== 'guest' || target?.login !== this.target.login)
      throw new Error('Target lease was not retained');
    return target;
  }
  snapshot() {
    return this.owner.request('presence.snapshot', { workspaceId: this.workspaceId });
  }
  members() {
    return this.owner.request('workspace.members.list', { workspaceId: this.workspaceId });
  }
  async workspace() {
    return (await this.observer.request('workspace.get', { workspaceId: this.workspaceId }))
      .workspace;
  }
  async close() {
    const failures: unknown[] = [];
    try {
      await this.renderer?.close();
    } catch (e) {
      failures.push(e);
    }
    for (const control of this.controls) {
      try {
        await control.close();
      } catch (e) {
        failures.push(e);
      }
    }
    if (this.child?.pid) {
      try {
        // Walk only the process tree rooted at this recorded child; never scan
        // unrelated processes. Retain identities before sending any signal.
        if ((await identityOrAbsent(this.child.pid)) === this.childStart) {
          for (const [pid, identity] of await ownedTree(this.child.pid))
            this.ownedIdentities.set(pid, identity);
        }
        await writeFile(
          join(this.evidence, 'cleanup-identities.json'),
          JSON.stringify([...this.ownedIdentities], null, 2),
          { mode: 0o600 },
        );
        for (const [pid, identity] of [...this.ownedIdentities].reverse()) {
          if ((await identityOrAbsent(pid)) === identity) {
            try {
              process.kill(pid, 'SIGTERM');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            }
          }
        }
        await eventually(
          async () => {
            for (const [pid, identity] of this.ownedIdentities) {
              if ((await identityOrAbsent(pid)) === identity) return false;
            }
            return true;
          },
          'recorded owned descendants gone',
          3000,
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.forge) {
      try {
        await new Promise<void>((resolve, reject) =>
          this.forge!.close((error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (!failures.length && this.root) {
      try {
        await rm(this.root, { recursive: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.evidence)
      await writeFile(
        join(this.evidence, 'cleanup.json'),
        JSON.stringify(
          {
            endedAt: new Date().toISOString(),
            root: this.root,
            daemonPid: this.child?.pid,
            complete: failures.length === 0,
            failureCount: failures.length,
            rawSocketCount: this.controls.length,
            forcedSocketClosures: this.controls.filter((c) => c.forcedClose).length,
            rendererSocketCount: this.renderer?.sockets.length ?? 0,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    if (failures.length)
      throw new AggregateError(failures, 'Fixture cleanup incomplete; retain owned root');
  }
}
async function processIdentity(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

async function identityOrAbsent(pid: number): Promise<string | null> {
  try {
    return await processIdentity(pid);
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
async function ownedTree(pid: number, parent?: number): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const identity = await identityOrAbsent(pid);
  if (identity === null) return result;
  if (parent !== undefined) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[1]) !== parent || fields[19] !== identity) return result;
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return result;
      throw error;
    }
  }
  result.set(pid, identity);
  let children: string;
  try {
    children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8');
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return result;
    throw error;
  }
  for (const child of children.trim().split(/\s+/).filter(Boolean)) {
    for (const entry of await ownedTree(Number(child), pid)) result.set(...entry);
  }
  return result;
}
