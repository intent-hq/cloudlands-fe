import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../../../shared/logger';
import { getEnhancedPath } from '../../../shared/main/find-binary';

const rawExec = promisify(exec);
const logger = new Logger('VersionChecks');

/**
 * Check whether git is available using the enhanced PATH.
 *
 * Unlike checkNodeVersion() (which uses the raw process.env PATH to match
 * how the agent process is spawned), this uses getEnhancedPath() because
 * the rest of the app executes git through buildGitEnv() / getEnhancedPath().
 * Using the raw launcher PATH would undercount installed Git on macOS GUI
 * launches and standard Windows installs where git is only on the enhanced PATH.
 *
 * Retries for transient spawn errors (EAGAIN/EBADF).
 *
 * @param execFn - Optional executor for testing. Defaults to promisified child_process.exec.
 */
export async function checkGitVersion(
  execFn: (cmd: string, opts: object) => Promise<{ stdout: string; stderr: string }> = rawExec,
): Promise<{
  gitInstalled: boolean;
  gitVersion?: string;
}> {
  const MAX_RETRIES = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { stdout } = await execFn('git --version', {
        timeout: 5000,
        env: { ...process.env, PATH: getEnhancedPath() },
        windowsHide: true,
      });
      const output = (stdout || '').trim();
      if (output) {
        // `git --version` outputs e.g. "git version 2.39.0" or
        // "git version 2.44.0.windows.1" on Windows
        const versionMatch = output.match(/(\d+(?:\.\d+)+)/);
        const version = versionMatch ? versionMatch[1] : output;
        logger.info('Git version check', { version });
        return { gitInstalled: true, gitVersion: version };
      }
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EBADF') {
        logger.warn(
          `Git version check attempt ${attempt}/${MAX_RETRIES} failed with ${code}, retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      // Non-transient error — no point retrying
      break;
    }
  }

  logger.warn('Git not found on PATH', { error: lastError });
  return { gitInstalled: false };
}
