import * as path from 'path';
import { createRequire } from 'module';
import {
  execAsyncWithRetry,
  execFileAsyncWithRetry,
} from '../../../shared/git/git-env';
import { Logger } from '../../../shared/logger';
import {
  findAuggiePathAsync,
  getEnhancedPath,
} from './auggie-path';

const logger = new Logger('ExecuteAuggieCommand');

// Create require function for ESM context to access Node.js built-in modules
const requireNode = createRequire(import.meta.url);

// Default timeout for auggie commands (30 seconds)
export const DEFAULT_AUGGIE_TIMEOUT_MS = 30_000;

/**
 * Build a PATH string for executing the auggie CLI binary.
 *
 * On macOS, GUI apps launched from Finder have a severely limited PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin). If auggie was installed via nvm/fnm,
 * the `node` binary lives in the same bin directory as auggie. Without
 * including that directory, the #!/usr/bin/env node shebang in the auggie
 * script can't find node, causing silent execution failures.
 *
 * This function prepends the auggie binary's parent directory to the
 * enhanced PATH so the correct node binary is always discoverable.
 */
export function getAuggieExecPATH(auggiePath: string | null): string {
  const enhancedPath = getEnhancedPath();
  if (!auggiePath || !path.isAbsolute(auggiePath)) {
    return enhancedPath;
  }
  const auggieBinDir = path.dirname(auggiePath);
  const sep = process.platform === 'win32' ? ';' : ':';
  return `${auggieBinDir}${sep}${enhancedPath}`;
}

export async function execWithEnhancedPath(
  command: string,
  options: { cwd?: string; maxBuffer?: number; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const enhancedPath = getEnhancedPath();
  // Use retry-enabled exec to handle transient errors like EAGAIN
  return execAsyncWithRetry(command, {
    ...options,
    env: {
      PATH: enhancedPath,
    },
  });
}

/**
 * Execute the auggie CLI. `args` is passed through to a shell on Windows (and
 * to the PATH-lookup shell fallback on macOS/Linux), so callers MUST sanitize
 * it — cmd metacharacters (&, |, ;, `, $, ", etc.) in `args` will be
 * interpreted by the shell.
 *
 * Note: `args` is split on spaces (`args.split(' ')`) before being passed to
 * `execFile` / `spawn`, so each token must be a single space-separated value
 * with no inner whitespace (e.g. `"session stats --json"`, not values that
 * themselves contain spaces).
 */
export async function executeAuggieCommand(
  args: string,
  options: { timeout?: number; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? DEFAULT_AUGGIE_TIMEOUT_MS;
  // PERF: Use async path finding to avoid blocking main thread
  const auggiePath = await findAuggiePathAsync();

  const executablePath = auggiePath || 'auggie';
  const argsArray = args.split(' ').filter(Boolean);
  logger.debug('Executing auggie command', {
    path: executablePath,
    args: argsArray,
    timeout,
    hasStdin: !!options.stdin,
  });

  // If stdin is provided, use spawn instead of exec to pipe input
  if (options.stdin) {
    return executeAuggieWithStdin(executablePath, argsArray, options.stdin, timeout);
  }

  if (!auggiePath) {
    // Try to execute directly in case it's in PATH but not found by our search
    return execWithEnhancedPath(`auggie ${args}`, { timeout });
  }

  const auggieEnvPath = getAuggieExecPATH(auggiePath);

  // On Windows, npm-installed commands (both .cmd wrappers and non-.cmd shims)
  // cannot be executed with execFile (no shell). Always use exec (shell-based) on Windows.
  if (process.platform === 'win32') {
    return execAsyncWithRetry(`"${auggiePath}" ${args}`, {
      timeout,
      env: { PATH: auggieEnvPath },
    });
  }

  // On macOS/Linux, use execFile (no shell) when we have the full path - more robust
  // against EAGAIN because it doesn't spawn a shell process
  return execFileAsyncWithRetry(auggiePath, argsArray, {
    timeout,
    env: { PATH: auggieEnvPath },
  });
}

/**
 * Determine whether spawn should use `shell: true` for the given auggie path.
 *
 * On Windows, we need shell: true when auggiePath is either:
 *   - A bare name (e.g. 'auggie') — cmd.exe resolves via PATH/PATHEXT to the .cmd shim.
 *   - A .cmd or .bat file — npm shims require a shell to invoke.
 * Absolute paths to non-shim binaries keep shell: false (safer — avoids cmd.exe
 * interpretation of args).
 * On macOS/Linux, always returns false — /bin/sh may not be accessible in
 * macOS GUI apps launched from Finder.
 */
export function shouldUseWindowsShell(auggiePath: string): boolean {
  if (process.platform !== 'win32') return false;
  const lower = auggiePath.toLowerCase();
  return !path.isAbsolute(auggiePath) || lower.endsWith('.cmd') || lower.endsWith('.bat');
}

async function executeAuggieWithStdin(
  auggiePath: string,
  args: string[],
  stdinData: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  const { spawn } = requireNode('child_process') as typeof import('child_process');

  return new Promise((resolve, reject) => {
    const enhancedEnv = {
      ...process.env,
      PATH: getAuggieExecPATH(auggiePath),
    };

    const useShell = shouldUseWindowsShell(auggiePath);

    // On Windows-with-shell, quote the path to handle spaces (e.g. C:\Users\John Doe\...).
    const spawnCommand = useShell ? `"${auggiePath}"` : auggiePath;

    const child = spawn(spawnCommand, args, {
      env: enhancedEnv,
      shell: useShell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Kill the child process tree. On Windows with shell mode, cmd.exe is the
    // direct child and killing it alone leaves the actual auggie process orphaned.
    // Use taskkill /T /F to terminate the entire process tree in that case.
    const killChild = () => {
      if (process.platform === 'win32' && useShell && child.pid) {
        const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        });
        taskkill.on('error', () => {
          child.kill();
        });
        taskkill.on('exit', (code) => {
          if (code !== 0) {
            child.kill();
          }
        });
      } else {
        child.kill();
      }
    };

    // Set up timeout before attaching event handlers so the error handler
    // can clear it via closure (prevents a stale timeout from firing after
    // the promise has already been rejected by a spawn error).
    const timeoutId = setTimeout(() => {
      killChild();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Command exited with code ${code}`));
      }
    });

    // Handle stdin EPIPE errors (child process may exit before consuming all input)
    child.stdin.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('EPIPE')) {
        // Benign: child process exited before reading all stdin data
        logger.debug('Stdin EPIPE (child exited before consuming input)');
      } else {
        logger.error('Stdin error:', error);
      }
    });

    // Write stdin and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
