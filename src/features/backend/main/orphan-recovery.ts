/**
 * Kill-and-restart recovery for an orphaned sidecar intentd (#2444).
 *
 * The user accepted the renderer's "Restart with the bundled daemon" offer for
 * an adopted daemon classified as an ORPHANED SIDECAR (see intentd-orphan.ts).
 * This module:
 *   1. Re-verifies the classification at action time (pid still alive, its
 *      executable still resolves inside OUR bundle) — the invariant that a
 *      genuinely external daemon is NEVER signalled holds even if state went
 *      stale between detection and click.
 *   2. Checks the daemon for actively responding agents and asks for explicit
 *      confirmation before interrupting them (quit-flow pattern).
 *   3. Stops the orphan gracefully: SIGTERM → grace wait → SIGKILL, polling
 *      for actual process exit.
 *   4. Spawns the bundled sidecar via the existing on-demand spawn path
 *      (which re-probes the socket and never runs two daemons side by side).
 *
 * Dependencies are injectable for tests; the default wiring lives in
 * backend.ipc.ts.
 */
import { Logger } from '$shared/logger';
import type { OrphanedSidecarState } from './connection-mode';
import type { SpawnSidecarOnDemandResult } from './intentd-sidecar';
import type { RespondingAgent } from '../../../main/running-agents';

const logger = new Logger('OrphanRecovery');

/** Grace period after SIGTERM before escalating to SIGKILL. */
const SIGTERM_GRACE_MS = 5000;
/** Extra wait after SIGKILL for the process to disappear. */
const SIGKILL_WAIT_MS = 2000;
/** Poll interval while waiting for the orphan to exit. */
const EXIT_POLL_INTERVAL_MS = 200;

/** Outcome of the kill-and-restart recovery. */
export interface RestartOrphanResult {
  ok: boolean;
  /** True when the bundled sidecar spawn kicked off. */
  spawned: boolean;
  /** True when the user declined the active-agents confirmation. */
  cancelled?: boolean;
  reason?: string;
}

/** Injectable collaborators (defaults wired in backend.ipc.ts). */
export interface OrphanRecoveryDeps {
  /** Current orphan classification from startup (or null). */
  getOrphanedSidecarInfo(): OrphanedSidecarState | null;
  /** Clear the classification + adopted-version info once the orphan is gone. */
  clearOrphanState(): void;
  /** Re-run detection now (action-time re-verification). */
  detectOrphan(): OrphanedSidecarState | null;
  /** Responding agents on the daemon (fail-open: [] on any failure). */
  listRespondingAgents(): Promise<RespondingAgent[]>;
  /** Ask the user to confirm interrupting `agents`; resolves true to proceed. */
  confirmInterrupt(agents: RespondingAgent[]): Promise<boolean>;
  /** Send `signal` to `pid`; returns false when the process is already gone. */
  kill(pid: number, signal: NodeJS.Signals | 0): boolean;
  /** Spawn the bundled sidecar (existing on-demand spawn path). */
  spawnSidecar(): Promise<SpawnSidecarOnDemandResult>;
  sleep(ms: number): Promise<void>;
}

function defaultKill(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll until `pid` is gone or the budget elapses; true when the process
 * exited. Attempt-counted (budget / poll interval) rather than wall-clock so
 * an injected test `sleep` fully controls the pacing.
 */
async function waitForExit(
  deps: OrphanRecoveryDeps,
  pid: number,
  budgetMs: number,
): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(budgetMs / EXIT_POLL_INTERVAL_MS));
  for (let i = 0; i < attempts; i++) {
    if (!deps.kill(pid, 0)) return true;
    await deps.sleep(EXIT_POLL_INTERVAL_MS);
  }
  return !deps.kill(pid, 0);
}

/**
 * Stop the orphaned sidecar and start the bundled daemon. See module docs for
 * the sequence; every verification failure returns `{ ok: false }` without
 * signalling anything.
 */
export async function restartOrphanedSidecar(
  deps: OrphanRecoveryDeps,
): Promise<RestartOrphanResult> {
  const recorded = deps.getOrphanedSidecarInfo();
  if (!recorded) {
    return { ok: false, spawned: false, reason: 'no orphaned sidecar detected' };
  }

  // Action-time re-verification: the pid must STILL name a live process whose
  // executable resolves inside our bundle. Guards against pid reuse and state
  // that went stale since startup detection.
  const current = deps.detectOrphan();
  if (!current || current.pid !== recorded.pid) {
    logger.warn('Orphan re-verification failed; refusing to signal', {
      recordedPid: recorded.pid,
      currentPid: current?.pid ?? null,
    });
    return { ok: false, spawned: false, reason: 'orphaned sidecar re-verification failed' };
  }

  const agents = await deps.listRespondingAgents();
  if (agents.length > 0) {
    const proceed = await deps.confirmInterrupt(agents);
    if (!proceed) {
      logger.info('User cancelled orphan restart due to responding agents');
      return { ok: false, spawned: false, cancelled: true, reason: 'cancelled by user' };
    }
  }

  logger.info('Stopping orphaned sidecar', { pid: current.pid });
  if (deps.kill(current.pid, 'SIGTERM')) {
    if (!(await waitForExit(deps, current.pid, SIGTERM_GRACE_MS))) {
      logger.warn('Orphaned sidecar did not exit after SIGTERM; sending SIGKILL', {
        pid: current.pid,
      });
      deps.kill(current.pid, 'SIGKILL');
      if (!(await waitForExit(deps, current.pid, SIGKILL_WAIT_MS))) {
        return { ok: false, spawned: false, reason: 'orphaned sidecar did not exit' };
      }
    }
  }

  // The orphan is gone: clear the classification (and adopted-version info)
  // BEFORE spawning so the next transport payload reflects the new posture.
  deps.clearOrphanState();

  const result = await deps.spawnSidecar();
  return { ok: result.ok, spawned: result.spawned, reason: result.reason };
}

/** Default `kill` dep (exported for the backend.ipc.ts wiring). */
export { defaultKill };
