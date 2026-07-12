/**
 * Sidecar manager: spawns and supervises the intentd daemon in the Electron
 * main process.
 *
 * Packaged apps spawn the bundled binary automatically; dev builds require
 * `INTENTD_SIDECAR=1` (default is two-terminal flow). Env overrides
 * (`INTENTD_SOCKET`, `INTENTD_WS_URL`, `INTENTD_TCP`) disable spawning and
 * connect to an external daemon. The manager probes the target UDS socket
 * before spawning to adopt an already-running daemon (single-instance).
 *
 * Binary location:
 *   - Packaged → `process.resourcesPath/intentd/intentd` (contract for task 3)
 *   - Dev      → `packages/intentd/target/{release,debug}/intentd` (or `INTENTD_BIN`)
 *
 * Data dir: honors `INTENTD_DATA_DIR` (spawns intentd with that env and
 * connects to `$INTENTD_DATA_DIR/intentd.sock`). `INTENTD_SOCKET` is
 * connect-only (disables spawning).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { Logger } from '$shared/logger';
import { RestartPolicy } from './restart-policy';

const logger = new Logger('Sidecar');

let sidecarProcess: ChildProcess | null = null;
let restartPolicy: RestartPolicy | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

/** Spawn-policy decision result. */
export interface ShouldSpawnDecision {
  shouldSpawn: boolean;
  reason: string;
}

/**
 * Decide whether to spawn the sidecar daemon.
 *
 * Returns `shouldSpawn: false` when:
 *   - `INTENTD_SIDECAR=0` (explicit disable)
 *   - Any transport override is set (`INTENTD_SOCKET`, `INTENTD_WS_URL`, `INTENTD_TCP`)
 *   - Dev build without `INTENTD_SIDECAR=1`
 *
 * Pure function for testability.
 */
export function shouldSpawnSidecar(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): ShouldSpawnDecision {
  const sidecarEnv = env.INTENTD_SIDECAR?.trim();
  if (sidecarEnv === '0') {
    return { shouldSpawn: false, reason: 'INTENTD_SIDECAR=0 disables spawning' };
  }
  if (env.INTENTD_SOCKET?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_SOCKET override disables spawning' };
  }
  if (env.INTENTD_WS_URL?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_WS_URL override disables spawning' };
  }
  if (env.INTENTD_TCP?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_TCP override disables spawning' };
  }
  if (!isPackaged && sidecarEnv !== '1') {
    return { shouldSpawn: false, reason: 'dev build requires INTENTD_SIDECAR=1' };
  }
  return { shouldSpawn: true, reason: isPackaged ? 'packaged build' : 'INTENTD_SIDECAR=1' };
}

/**
 * Resolve the intentd binary path.
 *
 * Precedence:
 *   1. `INTENTD_BIN` env override (absolute path)
 *   2. Packaged → `process.resourcesPath/intentd/intentd`
 *   3. Dev → `packages/intentd/target/release/intentd` then `debug/intentd`
 *
 * Returns `null` if no binary is found (caller should fail or adopt external daemon).
 * Pure function for testability (uses `fs.existsSync`, but caller can mock).
 */
export function resolveIntentdBinaryPath(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): string | null {
  const override = env.INTENTD_BIN?.trim();
  if (override && fs.existsSync(override)) {
    return override;
  }
  if (isPackaged) {
    const packagedBinary = path.join(resourcesPath, 'intentd', 'intentd');
    return fs.existsSync(packagedBinary) ? packagedBinary : null;
  }
  // Dev: check release first, then debug
  const releaseBinary = path.join(cwd, 'packages/intentd/target/release/intentd');
  if (fs.existsSync(releaseBinary)) return releaseBinary;
  const debugBinary = path.join(cwd, 'packages/intentd/target/debug/intentd');
  if (fs.existsSync(debugBinary)) return debugBinary;
  return null;
}

/**
 * Resolve the UDS socket path the daemon will use.
 *
 * If `INTENTD_DATA_DIR` is set, returns `$INTENTD_DATA_DIR/intentd.sock`.
 * Otherwise returns the platform default (macOS: `~/Library/Application Support/intentd/intentd.sock`).
 */
export function resolveSocketPath(env: NodeJS.ProcessEnv): string {
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (dataDir) {
    return path.join(dataDir, 'intentd.sock');
  }
  // Default per intentd's Config::resolve (crates/intent-core/src/config.rs)
  return path.join(os.homedir(), 'Library', 'Application Support', 'intentd', 'intentd.sock');
}

/**
 * Probe the UDS socket to check if a daemon is already running.
 * Returns `true` if the socket exists and accepts a connection (adopt it).
 */
async function probeDaemonSocket(socketPath: string): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;
  return new Promise<boolean>((resolve) => {
    const client = net.connect({ path: socketPath });
    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 500);
    client.on('connect', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(true);
    });
    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Health check probe: sends a cheap JSON-RPC request to the daemon socket.
 * Returns `true` if the daemon responds successfully within the timeout.
 *
 * @param socketPath - Path to the UDS socket
 * @param timeoutMs - Timeout in milliseconds (default: 3000)
 */
export async function healthCheckProbe(socketPath: string, timeoutMs = 3000): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;

  return new Promise<boolean>((resolve) => {
    const client = net.connect({ path: socketPath });
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        resolve(false);
      }
    }, timeoutMs);

    // Send a cheap JSON-RPC ping request (workspace.list with lite:true)
    const rpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'workspace.list',
      params: { lite: true },
    };

    client.on('connect', () => {
      client.write(JSON.stringify(rpcRequest) + '\n');
    });

    client.on('data', (chunk: Buffer) => {
      // Got a response - daemon is alive
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      }
    });

    client.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });

    client.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

/**
 * Start the health watchdog for the sidecar daemon.
 *
 * After an initial 2s grace period, probes the daemon every 10s with a 3s timeout.
 * If a probe fails, triggers the restart path.
 *
 * @param socketPath - Path to the UDS socket
 * @param delayMs - Delay before the next probe (default: 2000 for initial grace, 10000 for steady-state)
 */
function startHealthWatchdog(socketPath: string, delayMs = 2000): void {
  // Clear any existing watchdog
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  watchdogTimer = setTimeout(async () => {
    if (isShuttingDown || !sidecarProcess) return;

    const isHealthy = await healthCheckProbe(socketPath, 3000);
    if (!isHealthy) {
      logger.warn('Health check failed; triggering restart');
      // Kill the process to trigger the restart path
      if (sidecarProcess && !sidecarProcess.killed) {
        sidecarProcess.kill('SIGKILL');
      }
      return;
    }

    // Schedule next probe in 10s (steady-state interval)
    startHealthWatchdog(socketPath, 10000);
  }, delayMs);
}

/**
 * Spawn the sidecar daemon process.
 *
 * Internal helper extracted from startIntentdSidecar for restart path reuse.
 */
async function spawnSidecarProcess(
  binaryPath: string,
  socketPath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (isShuttingDown) return;

  logger.info('Spawning intentd sidecar', { binaryPath, socketPath });

  const spawnEnv = { ...env };
  if (env.INTENTD_DATA_DIR?.trim()) {
    spawnEnv.INTENTD_DATA_DIR = env.INTENTD_DATA_DIR.trim();
  }

  sidecarProcess = spawn(binaryPath, ['serve', '--listen', 'uds'], {
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Initialize restart policy if not already done
  if (!restartPolicy) {
    restartPolicy = new RestartPolicy();
  }
  restartPolicy.onSpawn();

  sidecarProcess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) logger.info(`[intentd stdout] ${text}`);
  });

  sidecarProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) logger.warn(`[intentd stderr] ${text}`);
  });

  sidecarProcess.on('exit', (code, signal) => {
    logger.info('Sidecar exited', { code, signal });

    // Clear watchdog timer
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }

    sidecarProcess = null;

    // Consult restart policy
    if (!restartPolicy) return;

    const decision = restartPolicy.onExit(code, signal);
    if (!decision.shouldRestart) {
      logger.info('Not restarting sidecar', { reason: decision.reason });
      return;
    }

    logger.info('Scheduling sidecar restart', {
      delayMs: decision.delayMs,
      remainingAttempts: decision.remainingAttempts,
      reason: decision.reason,
    });

    // Schedule restart after backoff delay
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (isShuttingDown) {
        logger.info('Skipping restart; shutdown in progress');
        return;
      }
      await spawnSidecarProcess(binaryPath, socketPath, env);
      // Start watchdog after successful spawn
      startHealthWatchdog(socketPath);
    }, decision.delayMs);
  });

  sidecarProcess.on('error', (err: Error) => {
    logger.error('Sidecar process error', err);
  });

  // Start the health watchdog after spawning
  startHealthWatchdog(socketPath);
}

/**
 * Start the intentd sidecar if the spawn policy allows it.
 *
 * Before spawning, probes the target socket to adopt an already-running daemon.
 * If spawning, pipes stdout/stderr to the main-process logger and starts supervision.
 */
export async function startIntentdSidecar(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged: boolean,
  resourcesPath: string,
  cwd: string,
): Promise<void> {
  const decision = shouldSpawnSidecar(env, isPackaged);
  if (!decision.shouldSpawn) {
    logger.info('Sidecar spawn disabled', { reason: decision.reason });
    return;
  }

  const socketPath = resolveSocketPath(env);
  const alreadyRunning = await probeDaemonSocket(socketPath);
  if (alreadyRunning) {
    logger.info('Adopting existing daemon', { socketPath });
    return;
  }

  const binaryPath = resolveIntentdBinaryPath(env, isPackaged, resourcesPath, cwd);
  if (!binaryPath) {
    logger.warn('intentd binary not found; skipping sidecar spawn', {
      isPackaged,
      resourcesPath,
      cwd,
    });
    return;
  }

  isShuttingDown = false;
  await spawnSidecarProcess(binaryPath, socketPath, env);
}

/**
 * Stop the sidecar daemon (if running).
 *
 * Sends SIGTERM, waits for the grace period, then SIGKILL if still alive.
 * Marks as intentional stop to suppress auto-restart.
 */
export async function stopIntentdSidecar(gracePeriodMs = 3000): Promise<void> {
  // Mark shutdown to prevent restarts
  isShuttingDown = true;

  // Clear watchdog timer
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  // Clear restart timer (quit during pending backoff must not respawn)
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  // Mark intentional stop in restart policy
  if (restartPolicy) {
    restartPolicy.markIntentionalStop();
  }

  if (!sidecarProcess) return;

  logger.info('Stopping sidecar daemon...');
  const proc = sidecarProcess;
  sidecarProcess = null;

  if (proc.killed || proc.exitCode !== null) {
    return;
  }

  // Send SIGTERM
  proc.kill('SIGTERM');

  // Wait for graceful exit
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        logger.warn('Sidecar did not exit gracefully; sending SIGKILL');
        proc.kill('SIGKILL');
      }
      resolve();
    }, gracePeriodMs);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * Check if the sidecar is currently running (process spawned and alive).
 */
export function isSidecarRunning(): boolean {
  return sidecarProcess !== null && sidecarProcess.exitCode === null && !sidecarProcess.killed;
}
