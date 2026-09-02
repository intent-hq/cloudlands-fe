import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
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
    await new Promise<void>((resolve) => facade.once('connect', resolve));
    // Kill the child mid-stream: the inner loopback socket closes, which
    // must surface on the facade as end-of-stream (push(null) → 'end') so
    // the JSON-RPC client sees a disconnect rather than a hang.
    const ended = new Promise<void>((resolve) => facade.once('end', resolve));
    facade.resume();
    children[0]!.kill();
    await ended;
    facade.destroy();
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
});
