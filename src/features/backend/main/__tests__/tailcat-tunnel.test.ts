import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { Duplex, PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

/**
 * Tests for the tailcat tunnel dialer (features/backend/main/tailcat-tunnel.ts):
 * binary resolution (env override → packaged resources → dev staging walk),
 * and the local loopback forwarder that spawns one tailcat stdio pipe client
 * per accepted connection. tailcat itself is faked via the injectable spawn:
 * the fake echoes stdin back on stdout so byte round-trips prove both pipe
 * directions.
 */

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

import {
  createTailcatTunnel,
  createTunneledSocket,
  resolveTailcatBinaryPath,
  TUNNEL_CONNECT_TIMEOUT_MS,
  type TailcatSpawn,
} from '../tailcat-tunnel';
import { raceDuplexSockets } from '../backend-connection';

/** Fake tailcat child: echoes stdin → stdout, records kill(). */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  constructor() {
    super();
    this.stdin.pipe(this.stdout);
  }
  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0);
    return true;
  }
}

function fakeSpawn(children: FakeChild[], args: string[][]): TailcatSpawn {
  return (_command, spawnArgs) => {
    const child = new FakeChild();
    children.push(child);
    args.push(spawnArgs);
    return child as unknown as ChildProcess;
  };
}

/**
 * Inner transport that is TCP-connected through the forwarder but never
 * finishes its handshake — the shape of `WebSocketDuplex` while the remote
 * daemon is down: tailcat accepts the loopback connect immediately, the TLS
 * handshake bytes vanish into the tunnel, and `connect` (ws `open`) never
 * fires.
 */
function stalledInner(localPort: number): Duplex {
  const socket = net.connect(localPort, '127.0.0.1');
  socket.on('error', () => {});
  return new Duplex({
    allowHalfOpen: false,
    read() {},
    write(chunk, encoding, callback) {
      socket.write(chunk, encoding, callback);
    },
    destroy(error, callback) {
      socket.destroy();
      callback(error);
    },
  });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailcat-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveTailcatBinaryPath', () => {
  const binName = process.platform === 'win32' ? 'tailcat.exe' : 'tailcat';

  it('prefers an existing TAILCAT_BIN override', () => {
    const override = path.join(tmpDir, 'custom-tailcat');
    fs.writeFileSync(override, '');
    expect(resolveTailcatBinaryPath({ TAILCAT_BIN: override }, undefined, tmpDir)).toBe(override);
  });

  it('ignores a TAILCAT_BIN pointing at a missing file', () => {
    const missing = path.join(tmpDir, 'nope');
    expect(resolveTailcatBinaryPath({ TAILCAT_BIN: missing }, undefined, tmpDir)).toBeNull();
  });

  it('resolves the packaged resources path when present', () => {
    const staged = path.join(tmpDir, 'tailcat');
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, binName), '');
    expect(resolveTailcatBinaryPath({}, tmpDir, tmpDir)).toBe(path.join(staged, binName));
  });

  it('walks up from cwd to the dev staging directory (host per-target subdir)', () => {
    const hostTargetDir = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
    const staging = path.join(
      tmpDir,
      'packages',
      'cloudlands-fe',
      'resources',
      'tailcat',
      hostTargetDir,
    );
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, binName), '');
    const deepCwd = path.join(tmpDir, 'packages', 'cloudlands-fe', 'dist', 'main');
    fs.mkdirSync(deepCwd, { recursive: true });
    expect(resolveTailcatBinaryPath({}, undefined, deepCwd)).toBe(path.join(staging, binName));
  });

  it('returns null when nothing is staged (fail-soft)', () => {
    expect(resolveTailcatBinaryPath({}, undefined, tmpDir)).toBeNull();
  });
});

describe('createTailcatTunnel', () => {
  it('spawns one tailcat pipe client per connection and round-trips bytes', async () => {
    const children: FakeChild[] = [];
    const args: string[][] = [];
    const tunnel = await createTailcatTunnel({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, args),
    });
    try {
      const socket = net.connect(tunnel.localPort, '127.0.0.1');
      await new Promise<void>((resolve) => socket.once('connect', resolve));
      const echoed = new Promise<string>((resolve) => {
        socket.once('data', (chunk) => resolve(chunk.toString()));
      });
      socket.write('hello-through-tunnel');
      expect(await echoed).toBe('hello-through-tunnel');
      expect(args).toEqual([['tc.example.ts.net', '8443']]);
      socket.destroy();
    } finally {
      tunnel.close();
    }
    expect(children).toHaveLength(1);
  });

  it('close() kills spawned children and stops accepting', async () => {
    const children: FakeChild[] = [];
    const tunnel = await createTailcatTunnel({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
    });
    const socket = net.connect(tunnel.localPort, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    tunnel.close();
    expect(children.every((child) => child.killed)).toBe(true);
    socket.destroy();
  });
});

describe('createTunneledSocket', () => {
  it('brings up the tunnel, dials the inner socket through it, and forwards connect + data', async () => {
    const children: FakeChild[] = [];
    let dialedPort = 0;
    const facade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      createInner: (localPort) => {
        dialedPort = localPort;
        return net.connect(localPort, '127.0.0.1');
      },
    });
    await new Promise<void>((resolve) => facade.once('connect', resolve));
    expect(dialedPort).toBeGreaterThan(0);
    const echoed = new Promise<string>((resolve) => {
      facade.once('data', (chunk: Buffer) => resolve(chunk.toString()));
    });
    facade.write('ping');
    expect(await echoed).toBe('ping');
    facade.destroy();
    // Teardown propagates: the forwarder's accepted-connection child dies.
    await vi.waitFor(() => expect(children.every((child) => child.killed)).toBe(true));
  });

  it('destroying a losing race candidate before bring-up completes closes the tunnel', async () => {
    const children: FakeChild[] = [];
    const createInner = vi.fn((localPort: number) => net.connect(localPort, '127.0.0.1'));
    const facade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      createInner,
    });
    facade.destroy();
    // The async bring-up resolves after destroy: it must self-close without
    // ever dialing the inner socket.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createInner).not.toHaveBeenCalled();
  });

  it('surfaces the tunnel dying mid-stream as end-of-stream on the facade', async () => {
    const children: FakeChild[] = [];
    const facade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      createInner: (localPort) => net.connect(localPort, '127.0.0.1'),
    });
    try {
      await new Promise<void>((resolve) => facade.once('connect', resolve));
      // The client's `connect` and the forwarder's accept callback (which
      // spawns the child) are separate event-loop tasks with no ordering
      // guarantee, so wait until the spawn is observable before killing it.
      const child = await vi.waitFor(() => {
        expect(children).toHaveLength(1);
        return children[0]!;
      });
      // Kill the child mid-stream: the inner loopback socket closes, which
      // must surface on the facade as end-of-stream (push(null) → 'end') so
      // the JSON-RPC client sees a disconnect rather than a hang.
      const ended = new Promise<void>((resolve) => facade.once('end', resolve));
      facade.resume();
      child.kill();
      await ended;
    } finally {
      facade.destroy();
    }
  });

  it('losing the connect race to a direct candidate tears down the tailcat children', async () => {
    // Cross-module path: a real tunneled facade races a direct candidate in
    // raceDuplexSockets. The direct candidate wins; the loser's teardown must
    // propagate through the tunnel facade to the spawned tailcat children.
    const children: FakeChild[] = [];
    const tunnelFacade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      createInner: (localPort) => net.connect(localPort, '127.0.0.1'),
    });
    const directWinner = new PassThrough() as unknown as net.Socket;
    const raced = raceDuplexSockets([
      { host: 'direct.example', create: () => directWinner as never },
      { host: 'tunnel:tc.example.ts.net', create: () => tunnelFacade },
    ]);
    const won = new Promise<void>((resolve) => raced.once('connect', resolve));
    directWinner.emit('connect');
    await won;
    // The losing tunnel candidate is destroyed by the race; every spawned
    // tailcat child must die with it (children may spawn asynchronously
    // during bring-up, so wait for the destroy to propagate).
    await vi.waitFor(() => {
      expect(tunnelFacade.destroyed).toBe(true);
      expect(children.every((child) => child.killed)).toBe(true);
    });
    raced.destroy();
  });

  it('fails a candidate whose inner socket never connects at the connect bound and tears the tunnel down', async () => {
    const children: FakeChild[] = [];
    let dialedPort = 0;
    let inner: Duplex | null = null;
    const facade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      connectTimeoutMs: 50,
      createInner: (localPort) => {
        dialedPort = localPort;
        inner = stalledInner(localPort);
        return inner;
      },
    });
    const failed = new Promise<Error>((resolve) => facade.once('error', resolve));
    const error = await failed;
    expect(error.message).toMatch(/did not connect within 50ms/);
    expect(facade.destroyed).toBe(true);
    // The inner socket had been dialed (TCP-accepted by the forwarder) and is
    // destroyed with the facade; the forwarder's child dies and it stops
    // listening, so a lost candidate leaves no tailcat process behind.
    expect(dialedPort).toBeGreaterThan(0);
    expect(inner!.destroyed).toBe(true);
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
      expect(children.every((child) => child.killed)).toBe(true);
    });
    const refused = new Promise<NodeJS.ErrnoException>((resolve) => {
      net.connect(dialedPort, '127.0.0.1').once('error', resolve);
    });
    expect((await refused).code).toBe('ECONNREFUSED');
  });

  it('leaves a candidate that connects within the bound alone; the timer never fires later', async () => {
    const children: FakeChild[] = [];
    const facade = createTunneledSocket({
      tcAddress: 'tc.example.ts.net',
      remotePort: 8443,
      binaryPath: '/fake/tailcat',
      spawn: fakeSpawn(children, []),
      connectTimeoutMs: 50,
      createInner: (localPort) => net.connect(localPort, '127.0.0.1'),
    });
    const errors: Error[] = [];
    facade.on('error', (error: Error) => errors.push(error));
    await new Promise<void>((resolve) => facade.once('connect', resolve));
    // Outlive the bound: a connected candidate must stay usable.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(facade.destroyed).toBe(false);
    expect(errors).toEqual([]);
    const echoed = new Promise<string>((resolve) => {
      facade.once('data', (chunk: Buffer) => resolve(chunk.toString()));
    });
    facade.write('still-alive');
    expect(await echoed).toBe('still-alive');
    facade.destroy();
    await vi.waitFor(() => expect(children.every((child) => child.killed)).toBe(true));
  });

  it('bounds the connect at TUNNEL_CONNECT_TIMEOUT_MS by default, counting from facade creation', async () => {
    vi.useFakeTimers();
    try {
      const neverConnects = new PassThrough();
      const facade = createTunneledSocket({
        tcAddress: 'tc.example.ts.net',
        remotePort: 8443,
        binaryPath: '/fake/tailcat',
        spawn: fakeSpawn([], []),
        createInner: () => neverConnects,
      });
      const errors: Error[] = [];
      facade.on('error', (error: Error) => errors.push(error));
      await vi.advanceTimersByTimeAsync(TUNNEL_CONNECT_TIMEOUT_MS - 1);
      expect(facade.destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(facade.destroyed).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toMatch(/did not connect/);
    } finally {
      vi.useRealTimers();
    }
  });
});
