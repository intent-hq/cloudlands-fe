/**
 * Orphaned-sidecar detection (#2444).
 *
 * An app crash/force-quit leaves the app-spawned intentd running; the next
 * launch adopts it as "external" and quit never stops it, so a stale daemon
 * survives app upgrades forever. This module tells a TRUE orphan — a daemon
 * whose executable lives inside the running app's own bundle — apart from a
 * genuinely external daemon (user-managed, dev build, other install), which
 * must NEVER be signalled.
 *
 * Identification: the daemon writes its pid to `<data dir>/intentd.pid`
 * (single-instance pidfile, crates/intentd/src/main.rs `acquire_single_instance`)
 * and removes it on shutdown, so the pidfile of a live daemon serving the
 * socket names that daemon's pid. The pid's executable path is resolved via
 * platform process inspection and realpath-compared against the app's
 * `process.resourcesPath`. Every step fails safe: any read/parse/inspection
 * failure yields "not an orphan".
 *
 * Dependency-light on purpose (fs/path/child_process only) so it is unit
 * testable and importable from the sidecar manager and the recovery handler.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveIntentdDataDir } from './intentd-data-dir';

/** Outcome of orphan detection for an adopted local daemon. */
export interface OrphanedSidecarInfo {
  /** Pid from the daemon's pidfile (verified alive). */
  pid: number;
  /** The daemon process's executable path (as reported by the OS). */
  executablePath: string;
}

/** Read the daemon's pid from `<data dir>/intentd.pid`; null when absent/invalid. */
export function readDaemonPidFromPidfile(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): number | null {
  try {
    const pidPath = path.join(resolveIntentdDataDir(env, platform), 'intentd.pid');
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== raw) return null;
    return pid;
  } catch {
    return null;
  }
}

/** True when `pid` names a live process (signal-0 probe; EPERM counts as alive). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Resolve the executable path of a live process.
 *
 * - linux  → `readlink /proc/<pid>/exe` (a deleted binary — replaced during an
 *   app upgrade — reports `<path> (deleted)`; the suffix is stripped).
 * - darwin → `ps -o comm= -p <pid>` (comm is the full executable path on macOS).
 * - win32/other → null (unsupported; detection then never classifies an orphan).
 */
export function getProcessExecutablePath(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): string | null {
  try {
    if (platform === 'linux') {
      const target = fs.readlinkSync(`/proc/${pid}/exe`);
      return target.replace(/ \(deleted\)$/, '');
    }
    if (platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 2000,
      }).trim();
      return out.length > 0 ? out : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when `executablePath` resolves inside `resourcesPath`. Both sides are
 * realpath'd (symlinked install locations); a deleted executable (upgrade
 * replaced the bundle) falls back to its normalized literal path.
 */
export function isExecutableInsideResources(
  executablePath: string,
  resourcesPath: string,
): boolean {
  let resolvedResources: string;
  try {
    resolvedResources = fs.realpathSync(resourcesPath);
  } catch {
    return false;
  }
  let resolvedExe: string;
  try {
    resolvedExe = fs.realpathSync(executablePath);
  } catch {
    resolvedExe = path.normalize(executablePath);
  }
  const relative = path.relative(resolvedResources, resolvedExe);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Detect whether the live adopted daemon on the local socket is an orphaned
 * sidecar: its pidfile names a live process whose executable resolves inside
 * the running app's own bundle. Returns null (not an orphan / cannot tell)
 * on any failure — the fail-safe default that keeps genuinely external
 * daemons untouchable.
 */
export function detectOrphanedSidecar(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string = process.resourcesPath,
  platform: NodeJS.Platform = process.platform,
): OrphanedSidecarInfo | null {
  const pid = readDaemonPidFromPidfile(env, platform);
  if (pid === null || pid === process.pid) return null;
  if (!isProcessAlive(pid)) return null;
  const executablePath = getProcessExecutablePath(pid, platform);
  if (!executablePath) return null;
  if (!isExecutableInsideResources(executablePath, resourcesPath)) return null;
  return { pid, executablePath };
}
