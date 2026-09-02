/**
 * tailcat tunnel dialer for the remote `wss` transport.
 *
 * The daemon side (intentd's tunnel supervisor) runs `tailcat serve` exposing
 * its wss port at a tc address. This module dials that address from the
 * client side: the bundled tailcat binary in stdio pipe client mode
 * (`tailcat <tcAddress> <port>`) speaks the tunnel protocol over
 * stdin/stdout, so a local 127.0.0.1 TCP forwarder bridges it to socket
 * consumers — each accepted local connection spawns one tailcat child and
 * pipes the socket through its stdio. `backend-connection.ts` then dials
 * `wss://127.0.0.1:<localPort>` through the forwarder with the existing
 * pin + token verification (the pin is fingerprint-based, so the loopback
 * hostname does not weaken it).
 *
 * Binary location (mirrors resolveIntentdBinaryPath):
 *   - `TAILCAT_BIN=/path/to/tailcat` → explicit override (dev/testing).
 *   - Packaged → `process.resourcesPath/tailcat/tailcat` (tailcat.exe on
 *     Windows; staged by scripts/fetch-tailcat.cjs via extraResources).
 *   - Dev → walk from `cwd` up looking for the fetch-tailcat staging output
 *     `packages/cloudlands-fe/resources/tailcat/<os>-<arch>/<bin>` (the
 *     per-target layout electron-builder packages from).
 *
 * Everything here fails soft: a missing binary or a failed spawn only breaks
 * the tunnel candidate, never the direct-host connect race.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { Duplex } from 'node:stream';

import { Logger } from '$shared/logger';

const logger = new Logger('TailcatTunnel');

/** Grace period between SIGTERM and the SIGKILL escalation. */
const KILL_ESCALATION_MS = 2_000;

/**
 * Kill a tailcat child with escalation: SIGTERM first, SIGKILL after a short
 * grace period if `exit` has not fired — a child wedged on relay I/O ignoring
 * SIGTERM must not leak until app exit (the connect race can spawn a fresh
 * child per attempt). No-op on Windows semantics concerns: `kill()` without a
 * signal terminates unconditionally there, so the escalation timer just never
 * finds a live child.
 */
function killWithEscalation(child: ChildProcess): void {
  child.kill();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, KILL_ESCALATION_MS);
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}

/** Spawn signature the tunnel needs; injectable so tests can fake tailcat. */
export type TailcatSpawn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcess;

/**
 * Resolve the tailcat client binary path, or `null` when unavailable
 * (tunnel dialing is then skipped — fail-soft).
 */
export function resolveTailcatBinaryPath(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  cwd: string = process.cwd(),
): string | null {
  const binaryName = process.platform === 'win32' ? 'tailcat.exe' : 'tailcat';
  const override = env.TAILCAT_BIN?.trim();
  if (override && fs.existsSync(override)) {
    return override;
  }
  if (resourcesPath) {
    const packagedBinary = path.join(resourcesPath, 'tailcat', binaryName);
    if (fs.existsSync(packagedBinary)) return packagedBinary;
  }
  // Dev: walk upward from cwd probing the fetch-tailcat staging directory,
  // like resolveIntentdBinaryPath does for the sidecar (the Electron cwd is
  // not guaranteed to be the monorepo root). The staging layout is
  // per-target (<os>-<arch> in electron-builder macro vocabulary); dev runs
  // always execute on the build host, so probe the host's own target dir.
  const hostTargetDir = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
  let dir = path.isAbsolute(cwd) ? cwd : path.resolve(cwd);
  for (let i = 0; i < 16; i++) {
    const candidates = [
      path.join(
        dir,
        'packages',
        'cloudlands-fe',
        'resources',
        'tailcat',
        hostTargetDir,
        binaryName,
      ),
      path.join(dir, 'resources', 'tailcat', hostTargetDir, binaryName),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** A listening local forwarder for one tc address. */
export interface TailcatTunnel {
  /** Loopback port the forwarder accepts connections on. */
  localPort: number;
  /** Tear down the forwarder: stop listening and kill every tailcat child. */
  close(): void;
}

/** Options for {@link createTailcatTunnel}. */
export interface CreateTailcatTunnelOptions {
  /** tc address of the daemon's tunnel endpoint (from pairing). */
  tcAddress: string;
  /** Remote port tailcat forwards to (the daemon's wss port). */
  remotePort: number;
  /** Absolute path to the tailcat client binary. */
  binaryPath: string;
  /** Injectable spawn for tests (fakes the tailcat process). */
  spawn?: TailcatSpawn;
}

/**
 * Start a local 127.0.0.1 forwarder for a tc address. Each accepted
 * connection spawns `tailcat <tcAddress> <remotePort>` (stdio pipe client
 * mode) and pipes the socket through the child's stdio; either side ending
 * tears the pair down. Resolves once the forwarder is listening.
 */
export function createTailcatTunnel(options: CreateTailcatTunnelOptions): Promise<TailcatTunnel> {
  const { tcAddress, remotePort, binaryPath } = options;
  const spawn = options.spawn ?? (nodeSpawn as TailcatSpawn);
  const children = new Set<ChildProcess>();
  const server = net.createServer((socket) => {
    let child: ChildProcess;
    try {
      child = spawn(binaryPath, [tcAddress, String(remotePort)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      logger.warn('tailcat spawn failed', { error: String(error) });
      socket.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    children.add(child);
    let torndown = false;
    const teardown = (): void => {
      if (torndown) return; // kill() may re-emit 'exit' synchronously
      torndown = true;
      children.delete(child);
      killWithEscalation(child);
      socket.destroy();
    };
    child.on('error', (error: Error) => {
      logger.warn('tailcat child error', { error: error.message });
      teardown();
    });
    child.on('exit', teardown);
    socket.on('close', teardown);
    socket.on('error', () => {
      // 'close' follows and runs teardown; the handler only prevents an
      // uncaught 'error' from the local loopback socket.
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logger.debug('tailcat stderr', { output: chunk.toString().trimEnd() });
    });
    // stdio is always ['pipe','pipe','pipe'] (TailcatSpawn), so stdin/stdout
    // exist; guard anyway rather than assert.
    if (!child.stdin || !child.stdout) {
      teardown();
      return;
    }
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
  });
  return new Promise<TailcatTunnel>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('tailcat forwarder listen returned no port'));
        return;
      }
      resolve({
        localPort: address.port,
        close(): void {
          server.close();
          for (const child of children) killWithEscalation(child);
          children.clear();
        },
      });
    });
  });
}

/** Options for {@link createTunneledSocket}. */
export interface CreateTunneledSocketOptions extends CreateTailcatTunnelOptions {
  /**
   * Dial the actual transport through the forwarder: called with the local
   * loopback port once the forwarder is listening; returns the inner socket
   * (e.g. the pinned wss socket aimed at `127.0.0.1:<localPort>`).
   */
  createInner: (localPort: number) => Duplex;
}

/**
 * Synchronous facade over the async tunnel bring-up, so the tunnel can join
 * the first-connect-wins race as a plain socket candidate: returns a `Duplex`
 * immediately, starts the forwarder in the background, dials the inner socket
 * through it, and forwards `connect`/`data`/`error`/`close`. Destroying the
 * facade (or the inner socket ending) tears the forwarder down, so a lost
 * race cleans up its tailcat children.
 */
export function createTunneledSocket(options: CreateTunneledSocketOptions): Duplex {
  let inner: Duplex | null = null;
  let tunnel: TailcatTunnel | null = null;
  const facade = new Duplex({
    allowHalfOpen: false,
    read() {
      // Inbound data is pushed from the inner socket's `data` events.
    },
    write(chunk, encoding, callback) {
      if (inner) {
        inner.write(chunk, encoding, callback);
        return;
      }
      // Consumers only write after `connect`, so a pre-connect write is
      // unexpected — fail it like a not-yet-open socket.
      callback(new Error('Socket is not connected'));
    },
    destroy(error, callback) {
      inner?.removeAllListeners();
      // A destroyed-but-alive inner socket can still emit async 'error'
      // events; keep a sink listener so they cannot become uncaught.
      inner?.on('error', () => {});
      inner?.destroy();
      tunnel?.close();
      callback(error);
    },
  });
  createTailcatTunnel(options)
    .then((created) => {
      if (facade.destroyed) {
        created.close();
        return;
      }
      tunnel = created;
      inner = options.createInner(created.localPort);
      inner.once('connect', () => facade.emit('connect'));
      inner.on('data', (chunk: Buffer | string) => facade.push(chunk));
      inner.once('error', (error: Error) => {
        if (!facade.destroyed) facade.destroy(error);
      });
      inner.once('close', () => facade.push(null));
    })
    .catch((error: unknown) => {
      if (!facade.destroyed) {
        facade.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
  return facade;
}
