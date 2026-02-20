/**
 * Process Tree Kill Utility
 *
 * Kills an entire process tree (parent + all descendants), not just the direct child.
 * This is critical for processes spawned via npx/npm-exec, where child.kill() only
 * kills the npx wrapper but leaves the actual adapter process (grandchild) orphaned.
 *
 * Without this, each killed npx process leaves behind a running claude-code-acp
 * (or similar) adapter, leading to massive memory leaks (80GB+ observed).
 */

import { ChildProcess, execSync } from 'child_process';
import { Logger } from '../logger';

const logger = new Logger('ProcessTreeKill');

/**
 * Kill an entire process tree rooted at the given PID.
 *
 * On macOS/Linux, uses `pkill -P` to find and kill child processes recursively,
 * then kills the parent. Falls back to just killing the parent if tree-kill fails.
 *
 * @param pid - The root process ID to kill
 * @param signal - Signal to send (default: SIGTERM)
 */
export function killProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  if (!pid || pid <= 0) {
    logger.warn('Invalid PID for process tree kill', { pid });
    return;
  }

  try {
    if (process.platform === 'win32') {
      // Windows: use taskkill /T to kill the process tree
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', timeout: 5000, windowsHide: true });
    } else {
      // macOS/Linux: find all descendant PIDs and kill them bottom-up
      try {
        // pgrep -P finds direct children; we recurse to get the full tree
        const descendants = getDescendantPids(pid);

        // Kill descendants first (bottom-up: children before parents)
        for (const childPid of descendants.reverse()) {
          try {
            process.kill(childPid, signal);
          } catch {
            // Process may have already exited
          }
        }

        // Kill the root process
        try {
          process.kill(pid, signal);
        } catch {
          // Process may have already exited
        }

        logger.debug('Process tree killed', {
          rootPid: pid,
          descendantCount: descendants.length,
          signal,
        });
      } catch (error) {
        // Fallback: just kill the root process
        logger.debug('Tree-kill enumeration failed, killing root only', {
          pid,
          error: (error as Error).message,
        });
        try {
          process.kill(pid, signal);
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch (error) {
    logger.debug('Process tree kill failed (process may have already exited)', {
      pid,
      error: (error as Error).message,
    });
  }
}

/**
 * Get all descendant PIDs of a given process (recursive).
 * Uses pgrep -P to find children at each level.
 */
function getDescendantPids(pid: number): number[] {
  const descendants: number[] = [];
  try {
    const output = execSync(`pgrep -P ${pid}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true,
    }).trim();

    if (output) {
      const childPids = output
        .split('\n')
        .map((p) => parseInt(p.trim(), 10))
        .filter((p) => !isNaN(p) && p > 0);

      for (const childPid of childPids) {
        // Recurse to get grandchildren etc.
        descendants.push(...getDescendantPids(childPid));
        descendants.push(childPid);
      }
    }
  } catch {
    // pgrep returns exit code 1 when no children found - that's normal
  }
  return descendants;
}

/**
 * Kill a ChildProcess and its entire process tree.
 * Removes all listeners first to prevent event handler issues.
 *
 * @param child - The ChildProcess to kill
 * @param signal - Signal to send (default: SIGTERM)
 */
export function killChildProcessTree(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
): void {
  if (!child) return;

  const pid = child.pid;
  if (pid) {
    killProcessTree(pid, signal);
  } else {
    // No PID available, try basic kill
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}
