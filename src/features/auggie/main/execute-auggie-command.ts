import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { hostExec } from '../../../shared/main/host-exec';
import {
  findAuggiePathAsync,
  getEnhancedPath,
} from './auggie-path';

const logger = new Logger('ExecuteAuggieCommand');

// Default timeout for auggie commands (30 seconds)
export const DEFAULT_AUGGIE_TIMEOUT_MS = 30_000;

/**
 * Build a PATH string for executing the auggie CLI binary.
 *
 * Retained as a pure helper for main-process callers that need to construct
 * an env-augmented PATH string (e.g. when they still spawn locally pending
 * migration). Auggie exec itself now routes through `host.exec`, which uses
 * the daemon's own PATH resolution.
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

/**
 * Run an arbitrary command via the daemon's `host.exec` (argv-based, no shell).
 * Returns `{ stdout, stderr }` on exit code 0; throws with the same shape as
 * the legacy `child_process` exec (message = stderr, `.code`, `.stdout`,
 * `.stderr`) on non-zero exit so pre-existing catch sites stay compatible.
 */
export async function execWithEnhancedPath(
  command: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; workspaceId?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? DEFAULT_AUGGIE_TIMEOUT_MS;
  const result = await hostExec(command, {
    args,
    timeoutMs: timeout,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  });
  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeout}ms`);
  }
  if (result.exitCode !== 0) {
    const err = new Error(result.stderr || `Command exited with code ${result.exitCode}`);
    (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).code = String(
      result.exitCode,
    );
    (err as { stdout?: string }).stdout = result.stdout;
    (err as { stderr?: string }).stderr = result.stderr;
    throw err;
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Execute the auggie CLI via the daemon's `host.exec` (argv-based, no shell).
 *
 * `args` is a whitespace-separated argument string (kept for backwards
 * compatibility with existing call-sites) and is split on spaces before being
 * forwarded to the daemon as positional `args`. Tokens with inner whitespace
 * are not supported.
 *
 * `stdin` is not forwarded — `host.exec` is a buffered one-shot RPC with no
 * stdin channel (PROTOCOL §5.14). If a caller passes `stdin`, the call is
 * rejected so the caller can surface the gap rather than silently ignoring
 * the input. The only historical `stdin` caller was `auggie login`, which is
 * now retired in favour of instructions rendered by the FE.
 */
export async function executeAuggieCommand(
  args: string,
  options: { timeout?: number; stdin?: string; cwd?: string; workspaceId?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? DEFAULT_AUGGIE_TIMEOUT_MS;

  if (options.stdin != null) {
    // host.exec is buffered and does not forward stdin; refuse rather than
    // silently drop input. Callers that need interactive stdin must wait for
    // a streaming/interactive host surface (BE gap).
    logger.warn('executeAuggieCommand: stdin is not supported (host.exec has no stdin channel)', {
      argPreview: args.slice(0, 80),
    });
    throw new Error(
      'executeAuggieCommand: stdin is not supported by host.exec (buffered RPC). See host.exec (PROTOCOL §5.14).',
    );
  }

  const auggiePath = await findAuggiePathAsync();
  const executablePath = auggiePath || 'auggie';
  const argsArray = args.split(' ').filter(Boolean);
  logger.debug('Executing auggie command via host.exec', {
    path: executablePath,
    args: argsArray,
    timeout,
  });

  return execWithEnhancedPath(executablePath, argsArray, {
    timeout,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  });
}

/**
 * Determine whether spawn should use `shell: true` for the given auggie path.
 *
 * Retained as a pure helper for callers that still spawn locally. Not used by
 * the host.exec-based `executeAuggieCommand`, which forwards argv to the
 * daemon and does not run through a shell on the FE.
 */
export function shouldUseWindowsShell(auggiePath: string): boolean {
  if (process.platform !== 'win32') return false;
  const lower = auggiePath.toLowerCase();
  return !path.isAbsolute(auggiePath) || lower.endsWith('.cmd') || lower.endsWith('.bat');
}
