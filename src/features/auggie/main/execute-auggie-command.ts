import * as path from 'path';
import { Buffer } from 'node:buffer';
import { Logger } from '../../../shared/logger';
import { hostExec } from '../../../shared/main/host-exec';
import { hostExecStream } from '../../../shared/main/host-exec-stream';
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
 * Execute the auggie CLI via the daemon (argv-based, no shell).
 *
 * `args` is a whitespace-separated argument string (kept for backwards
 * compatibility with existing call-sites) and is split on spaces before being
 * forwarded to the daemon as positional `args`. Tokens with inner whitespace
 * are not supported.
 *
 * When `stdin` is provided, the call is routed through the daemon's streaming
 * `host.execStream` surface (PROTOCOL §5.14): the initial payload rides with
 * the request, stdin is closed via a follow-up `host.execStream.write { eof: true }`
 * so the child sees EOF, and stdout/stderr are buffered until the terminal
 * `host:exec:exit` frame lands — preserving the buffered `{ stdout, stderr }`
 * shape the legacy `child_process` exec returned. When `stdin` is absent, the
 * call uses the buffered one-shot `host.exec` for lower overhead.
 */
export async function executeAuggieCommand(
  args: string,
  options: { timeout?: number; stdin?: string; cwd?: string; workspaceId?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? DEFAULT_AUGGIE_TIMEOUT_MS;
  const auggiePath = await findAuggiePathAsync();
  const executablePath = auggiePath || 'auggie';
  const argsArray = args.split(' ').filter(Boolean);

  if (options.stdin != null) {
    logger.debug('Executing auggie command via host.execStream (stdin)', {
      path: executablePath,
      args: argsArray,
      timeout,
      stdinBytes: options.stdin.length,
    });
    return execAuggieStreamed(executablePath, argsArray, options.stdin, {
      timeout,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    });
  }

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
 * Streamed exec that buffers stdout/stderr and returns the same
 * `{ stdout, stderr }` shape as {@link execWithEnhancedPath}. Used when the
 * caller has stdin to forward, since `host.exec` is buffered-response-only.
 * Errors mirror the legacy `child_process`-exec surface: non-zero exit throws
 * with `.code`, `.stdout`, `.stderr`; timeouts throw a `timed out` message.
 */
async function execAuggieStreamed(
  command: string,
  args: string[],
  stdin: string,
  options: { timeout: number; cwd?: string; workspaceId?: string },
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const handle = await hostExecStream(command, {
    args,
    timeoutMs: options.timeout,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    stdin,
    onStdout: (chunk: Buffer) => stdoutChunks.push(chunk),
    onStderr: (chunk: Buffer) => stderrChunks.push(chunk),
  });

  // Close stdin so `auggie` (or any read-to-EOF child) exits cleanly. A failed
  // `eof` write is non-fatal: the child may have already exited and closed the
  // pipe; `done` still settles from the terminal `host:exec:exit` frame.
  try {
    await handle.endStdin();
  } catch (error) {
    logger.debug('host.execStream.write { eof:true } failed (child may have exited)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const exitResult = await handle.done;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  if (exitResult.timedOut) {
    throw new Error(`Command timed out after ${options.timeout}ms`);
  }
  if (exitResult.cancelled) {
    throw new Error('Command cancelled');
  }
  if (!exitResult.ok || exitResult.exitCode !== 0) {
    const code = exitResult.exitCode ?? null;
    const err = new Error(stderr || `Command exited with code ${code}`);
    (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).code = String(code);
    (err as { stdout?: string }).stdout = stdout;
    (err as { stderr?: string }).stderr = stderr;
    throw err;
  }
  return { stdout, stderr };
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
