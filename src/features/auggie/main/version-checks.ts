import { Logger } from '../../../shared/logger';
import { hostExec } from '../../../shared/main/host-exec';

const logger = new Logger('VersionChecks');

/**
 * Check whether git is available on the daemon's host by probing
 * `git --version` via `host.exec` (PROTOCOL §5.14).
 *
 * The FE no longer spawns git locally: post-P2 the daemon owns arbitrary exec
 * (with argv, no shell, and its own PATH-enriched env), so the `git` that
 * `host.exec` resolves is exactly the git the daemon uses for its own git
 * operations. Honest-degrade on RPC failure / non-zero exit: return
 * `{ gitInstalled: false }` without throwing.
 */
export async function checkGitVersion(): Promise<{
  gitInstalled: boolean;
  gitVersion?: string;
}> {
  try {
    const result = await hostExec('git', {
      args: ['--version'],
      timeoutMs: 5000,
    });
    if (result.timedOut) {
      logger.warn('Git version probe (host.exec) timed out');
      return { gitInstalled: false };
    }
    if (result.exitCode !== 0) {
      logger.warn('Git not found on PATH (host.exec)', {
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
      return { gitInstalled: false };
    }
    const output = (result.stdout || '').trim();
    if (output) {
      // `git --version` outputs e.g. "git version 2.39.0" or
      // "git version 2.44.0.windows.1" on Windows
      const versionMatch = output.match(/(\d+(?:\.\d+)+)/);
      const version = versionMatch ? versionMatch[1] : output;
      logger.info('Git version check (host.exec)', { version });
      return { gitInstalled: true, gitVersion: version };
    }
    return { gitInstalled: false };
  } catch (err) {
    logger.warn('Git version probe (host.exec) failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { gitInstalled: false };
  }
}
