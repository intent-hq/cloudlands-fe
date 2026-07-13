/**
 * Async Utilities for Main Process
 *
 * Provides async alternatives to synchronous operations to prevent
 * blocking the main thread and causing UI freezes (beach balls).
 *
 * Execution helpers (`execAsync`, `execFileAsync`, `getNpmGlobalBinAsync`)
 * route through the daemon's streaming exec seam (`host.execStream`,
 * PROTOCOL.md §5.14), frame-accumulating stdout/stderr and throwing on
 * non-zero exit with `.stdout` / `.stderr` / numeric `.code` — the same
 * G1 fidelity contract git-env exposes. `findExecutableAsync` /
 * `findVSCodeAsync` forward to `host.findBinary` via the shared
 * `findBinary` helper; `findAuggieAsync` delegates to the daemon-backed
 * `findAuggiePathAsync` (`host.checkAuggie`). The fs helpers below stay as
 * local promisified `fs` calls (not execution — untouched by this seam).
 */

import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { renameWithRetry } from './file-sync-utils';
import {
  hostExecStream,
  type HostExecStreamOptions,
} from './host-exec-stream';

const logger = new Logger('AsyncUtils');

/**
 * Options accepted by the routed exec helpers. Subset of the legacy
 * `child_process.exec` / `execFile` option bag — callers pass `cwd`,
 * `timeout`, `env`, and `encoding` (retained for signature compat; the
 * daemon streams bytes and we always decode as UTF-8 on this side).
 */
export interface AsyncExecOptions {
  cwd?: string;
  timeout?: number;
  encoding?: BufferEncoding;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  windowsHide?: boolean;
  shell?: string | boolean;
}

export interface AsyncExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Error thrown when a daemon-routed exec exits non-zero (or times out).
 * Reconstructs the `promisify(child_process.exec)` contract call-sites
 * rely on: `.stdout` / `.stderr` buffers plus a numeric `.code` exit
 * status (and `.killed` on timeout).
 */
interface AsyncExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
  killed?: boolean;
}

/**
 * Resolve the host shell binary + flag for shell-form commands. Mirrors
 * the `system.ipc` EXECUTE_COMMAND shim: `/bin/sh -c` on POSIX,
 * `cmd.exe /c` on Windows.
 */
function resolveShell(customShell?: string): [string, string] {
  if (process.platform === 'win32') return ['cmd.exe', '/c'];
  return [customShell && customShell.length > 0 ? customShell : '/bin/sh', '-c'];
}

/** Coerce a `NodeJS.ProcessEnv` into the string-valued env the daemon accepts. */
function toHostEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Core exec runner: routes a single command through the daemon's
 * `host.execStream` seam, accumulating stdout/stderr chunk frames so
 * large output is not capped by the single WSS message limit. Resolves
 * `{ stdout, stderr }` on exit 0; on non-zero exit or timeout throws an
 * Error carrying `.stdout` / `.stderr` / numeric `.code` (+ `.killed`
 * on timeout), matching the legacy `promisify(exec)` contract.
 */
async function runViaHostStream(
  command: string,
  args: readonly string[] | undefined,
  options: AsyncExecOptions | undefined,
  label: string,
): Promise<AsyncExecResult> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const streamOptions: HostExecStreamOptions = {
    onStdout: (chunk: Buffer) => stdoutChunks.push(chunk),
    onStderr: (chunk: Buffer) => stderrChunks.push(chunk),
  };
  if (args && args.length > 0) streamOptions.args = [...args];
  if (typeof options?.cwd === 'string' && options.cwd.length > 0) {
    streamOptions.cwd = options.cwd;
  }
  if (typeof options?.timeout === 'number' && options.timeout > 0) {
    streamOptions.timeoutMs = options.timeout;
  }
  const envMap = toHostEnv(options?.env);
  if (envMap) streamOptions.env = envMap;

  const handle = await hostExecStream(command, streamOptions);
  const result = await handle.done;
  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  const stderr = Buffer.concat(stderrChunks).toString('utf-8');

  if (result.timedOut) {
    const err = new Error(`Command timed out: ${label}`) as AsyncExecError;
    err.stdout = stdout;
    err.stderr = stderr;
    err.killed = true;
    if (typeof result.exitCode === 'number') err.code = result.exitCode;
    throw err;
  }

  const exitCode =
    typeof result.exitCode === 'number' ? result.exitCode : result.ok ? 0 : 1;
  if (exitCode !== 0) {
    const err = new Error(`Command failed: ${label}\n${stderr}`) as AsyncExecError;
    err.stdout = stdout;
    err.stderr = stderr;
    err.code = exitCode;
    throw err;
  }

  return { stdout, stderr };
}

/**
 * Execute a shell command via the daemon's `host.execStream` seam.
 * Returns `{ stdout, stderr }` on exit 0; throws with `.stdout` /
 * `.stderr` / numeric `.code` on non-zero exit or timeout.
 */
export async function execAsync(
  command: string,
  options?: AsyncExecOptions,
): Promise<AsyncExecResult> {
  const [shellCmd, shellFlag] = resolveShell(
    typeof options?.shell === 'string' ? options.shell : undefined,
  );
  return runViaHostStream(shellCmd, [shellFlag, command], options, command);
}

/**
 * Execute a file with argv via the daemon's `host.execStream` seam.
 * Supports the legacy `(file, args, options)` and `(file, options)`
 * overload shapes callers relied on.
 */
export async function execFileAsync(
  file: string,
  argsOrOptions?: readonly string[] | AsyncExecOptions,
  maybeOptions?: AsyncExecOptions,
): Promise<AsyncExecResult> {
  if (Array.isArray(argsOrOptions)) {
    const args = argsOrOptions as readonly string[];
    return runViaHostStream(file, args, maybeOptions, `${file} ${args.join(' ')}`);
  }
  return runViaHostStream(file, undefined, argsOrOptions as AsyncExecOptions | undefined, file);
}

// Promisified fs functions
export const writeFileAsync = promisify(fs.writeFile);
export const readFileAsync = promisify(fs.readFile);
export const mkdirAsync = promisify(fs.mkdir);
export const existsAsync = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find an executable in PATH or common locations asynchronously.
 * Delegates to shared `findBinary()`. Note: common path checks use
 * synchronous `fs.existsSync` which briefly blocks, but this is
 * negligible for the small number of paths checked.
 *
 * @param command - The command to find (e.g., 'code', 'auggie')
 * @param commonPaths - Optional list of common paths to check
 * @returns The path to the executable, or null if not found
 */
export async function findExecutableAsync(
  command: string,
  commonPaths: string[] = [],
): Promise<string | null> {
  const { findBinary } = await import('./find-binary');
  const result = await findBinary(command, {
    commonPaths,
    cache: false,
    timeout: 5000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    logger.debug(`Found ${command} via shared findBinary`, { path: result });
  }

  return result;
}

/**
 * Common paths for VSCode on different platforms
 */
export const VSCODE_COMMON_PATHS: string[] =
  process.platform === 'darwin'
    ? [
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
          'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
        ]
      : ['/usr/bin/code', '/snap/bin/code'];

/**
 * Find VSCode executable asynchronously
 */
export async function findVSCodeAsync(): Promise<string | null> {
  return findExecutableAsync('code', VSCODE_COMMON_PATHS);
}

/**
 * Find the Auggie CLI asynchronously by delegating to the daemon-backed
 * `findAuggiePathAsync` (`host.checkAuggie`). The BE owns the settings
 * precedence (`context.auggiePath` → `providers.paths.auggie`) and the
 * canonical discovery (`~/.augment/bin/auggie`, enhanced-PATH scan) — no
 * local cache files or hardcoded install-path lists on this side.
 */
export async function findAuggieAsync(): Promise<string | null> {
  const { findAuggiePathAsync } = await import(
    '../../features/auggie/main/auggie-path'
  );
  return findAuggiePathAsync();
}

/**
 * Get npm global bin directory asynchronously
 */
export async function getNpmGlobalBinAsync(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('npm bin -g', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Write JSON to file asynchronously with atomic write pattern
 */
export async function writeJsonAsync(
  filePath: string,
  data: unknown,
  options?: { spaces?: number },
): Promise<void> {
  const content = JSON.stringify(data, null, options?.spaces ?? 2);
  const dir = path.dirname(filePath);

  // Ensure directory exists (guard against Windows drive roots like C:\)
  if (dir && dir.length > 3 && !/^[A-Za-z]:\\?$/.test(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Write to temp file first, then rename (atomic)
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await renameWithRetry(tempPath, filePath);
}

/**
 * Read JSON from file asynchronously with error handling
 */
export async function readJsonAsync<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
