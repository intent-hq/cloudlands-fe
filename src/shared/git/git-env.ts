/**
 * Git Environment Configuration
 *
 * Centralized environment variables for git operations to prevent
 * terminal prompts in packaged Electron apps while honoring keychain consent.
 *
 * This module provides a consistent set of environment variables that:
 * 1. Prevent interactive terminal prompts by default (GIT_TERMINAL_PROMPT)
 * 2. Optionally disable credential helpers when policy requires
 * 3. Configure SSH_ASKPASS for passphrase-protected SSH key support
 *
 * Keychain dialogs are handled via an explicit consent flow rather than
 * globally disabling credential helpers.
 */

import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { getEnhancedPath } from '../main/find-binary';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// ============================================================================
// SSH ASKPASS Support
// ============================================================================

const ASKPASS_SCRIPT_NAME =
  process.platform === 'win32' ? 'ssh-askpass-intent.bat' : 'ssh-askpass-intent.sh';

/**
 * Get the path to the bundled SSH askpass script.
 * In development: resources/bin/ssh-askpass-intent.sh (relative to project root)
 * In production: app.asar.unpacked/resources/bin/ssh-askpass-intent.sh
 *
 * Returns undefined if the script cannot be found.
 */
function getSSHAskPassPath(): string | undefined {
  const fs = require('fs');

  // Try development path first: __dirname is src/shared/git, go up to project root
  const devPath = path.join(__dirname, '..', '..', '..', 'resources', 'bin', ASKPASS_SCRIPT_NAME);
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Try production path: use electron app if available
  try {
    const { app } = require('electron');
    if (app) {
      const appPath = app.getAppPath();
      const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
      const prodPath = path.join(unpackedPath, 'resources', 'bin', ASKPASS_SCRIPT_NAME);
      if (fs.existsSync(prodPath)) {
        return prodPath;
      }
    }
  } catch {
    // electron not available (e.g., running in tests or non-Electron context)
  }

  return undefined;
}

/**
 * Get the SSH agent socket path.
 * On macOS, when launched from Finder, SSH_AUTH_SOCK may not be set.
 * We try to use the launchd socket which is the default on modern macOS.
 */
function getSSHAuthSock(): string | undefined {
  // If already set in environment, use it
  if (process.env.SSH_AUTH_SOCK) {
    return process.env.SSH_AUTH_SOCK;
  }

  // On macOS, try the launchd SSH agent socket
  // This is typically at /private/tmp/com.apple.launchd.*/Listeners
  if (process.platform === 'darwin') {
    try {
      const fs = require('fs');
      const tmpDir = '/private/tmp';
      const entries = fs.readdirSync(tmpDir);
      for (const entry of entries) {
        if (entry.startsWith('com.apple.launchd.')) {
          const socketPath = `${tmpDir}/${entry}/Listeners`;
          if (fs.existsSync(socketPath)) {
            return socketPath;
          }
        }
      }
    } catch {
      // Ignore errors, fall through to undefined
    }
  }

  return undefined;
}

type GitTerminalPromptPolicy = 'disable' | 'allow' | 'inherit';
type GitCredentialHelperPolicy = 'disable' | 'allow' | 'inherit';

interface GitEnvPolicy {
  terminalPrompt?: GitTerminalPromptPolicy;
  credentialHelper?: GitCredentialHelperPolicy;
}

// ============================================================================
// Centralized exec utilities with git environment
// ============================================================================

import { Buffer } from 'node:buffer';
import { hostExecStream, type HostExecStreamOptions } from '../main/host-exec-stream';

export interface ExecOptions {
  cwd?: string;
  maxBuffer?: number;
  timeout?: number;
  encoding?: BufferEncoding;
  env?: NodeJS.ProcessEnv;
  /** Optional policy for git-specific env overrides */
  gitPolicy?: GitEnvPolicy;
  shell?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Apply git-specific policy to an environment map.
 */
function applyGitEnvPolicy(env: NodeJS.ProcessEnv, policy?: GitEnvPolicy): NodeJS.ProcessEnv {
  const terminalPromptPolicy: GitTerminalPromptPolicy = policy?.terminalPrompt ?? 'disable';
  if (terminalPromptPolicy === 'disable') {
    env.GIT_TERMINAL_PROMPT = '0';
  } else if (terminalPromptPolicy === 'allow') {
    delete env.GIT_TERMINAL_PROMPT;
  }

  const credentialHelperPolicy: GitCredentialHelperPolicy = policy?.credentialHelper ?? 'inherit';
  if (credentialHelperPolicy === 'disable') {
    env.GIT_CONFIG_PARAMETERS = "'credential.helper='";
  } else if (credentialHelperPolicy === 'allow') {
    delete env.GIT_CONFIG_PARAMETERS;
  }

  return env;
}

/**
 * Get the user-configured SSH key path from app settings.
 * Uses lazy import to avoid circular dependency between shared/ and features/.
 * Returns undefined if not set or if settings are unavailable.
 */
function getConfiguredSshKeyPath(): string | undefined {
  try {
    // Lazy import to avoid circular dependency (shared/ -> features/)
    // This mirrors the pattern used by getSSHAskPassPath() with require('electron')
    const { getSshKeyPath } = require('../../features/workspace/main/app-settings.service');
    let keyPath = getSshKeyPath();
    if (!keyPath) return undefined;
    // Expand ~ to the user's home directory. Tilde is not expanded by the shell
    // when the path is inside quotes (as in GIT_SSH_COMMAND's -i "...").
    if (keyPath.startsWith('~/') || keyPath === '~') {
      keyPath = keyPath.replace('~', require('os').homedir());
    }
    return keyPath;
  } catch {
    // Settings service not available (e.g., running in tests or before initialization)
    return undefined;
  }
}

/**
 * Build a fresh git environment with current process.env values.
 * This is called dynamically to handle cases where process.env.PATH
 * might have been empty at module load time but populated later.
 */
function buildGitEnv(additionalEnv?: NodeJS.ProcessEnv, policy?: GitEnvPolicy): NodeJS.ProcessEnv {
  const askPassPath = getSSHAskPassPath();
  const sshKeyPath = getConfiguredSshKeyPath();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Ensure PATH includes essential system directories (critical for macOS GUI apps)
    // Computed fresh each time to pick up any PATH changes
    PATH: getEnhancedPath(),
    // Ensure SSH agent socket is available (critical for SSH-based git remotes)
    SSH_AUTH_SOCK: getSSHAuthSock() || process.env.SSH_AUTH_SOCK,
    // SSH_ASKPASS: point to our bundled askpass script for passphrase-protected keys.
    // SSH_ASKPASS_REQUIRE=force tells SSH to always use the askpass program instead of
    // trying the terminal first (which would fail in a GUI app).
    ...(askPassPath
      ? {
          SSH_ASKPASS: askPassPath,
          SSH_ASKPASS_REQUIRE: 'force',
        }
      : {}),
    // DISPLAY must be set for SSH to use ASKPASS on Linux (no-op on macOS).
    // If not already set, provide a fallback value.
    DISPLAY: process.env.DISPLAY || ':0',
    // GIT_SSH_COMMAND: when user has configured a specific SSH key, tell git to use it.
    // -o IdentitiesOnly=yes ensures ONLY the specified key is tried (not all keys in agent).
    // -o StrictHostKeyChecking=accept-new auto-accepts new hosts but rejects changed keys,
    // preventing hangs on first-time host key prompts in the non-interactive GUI context.
    // On Windows, normalize backslashes to forward slashes since SSH interprets backslashes
    // as escape characters (e.g., C:\Users\... → C:/Users/...).
    ...(sshKeyPath
      ? {
          GIT_SSH_COMMAND: `ssh -i "${process.platform === 'win32' ? sshKeyPath.replace(/\\/g, '/') : sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
        }
      : {}),
    // Apply any additional environment variables
    ...additionalEnv,
  };

  return applyGitEnvPolicy(env, policy);
}

/**
 * Error thrown when a daemon-routed exec exits non-zero (or times out).
 * Reconstructs the `promisify(child_process.exec)` contract call-sites rely on:
 * `.stdout` / `.stderr` buffers plus a numeric `.code` exit status.
 */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
  killed?: boolean;
}

/**
 * Coerce a NodeJS.ProcessEnv (values may be undefined) into the
 * Record<string, string> shape the daemon exec seam accepts.
 */
function toHostEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Resolve the host shell binary + flag for shell-form commands. Mirrors the
 * `system.ipc` EXECUTE_COMMAND shell-shim: `/bin/sh -c` on POSIX, `cmd.exe /c`
 * on Windows.
 */
function resolveShell(options?: ExecOptions): [string, string] {
  if (process.platform === 'win32') return ['cmd.exe', '/c'];
  return [options?.shell ?? '/bin/sh', '-c'];
}

/**
 * Core exec runner: routes a single command through the daemon's
 * `host.execStream` seam (PROTOCOL.md §5.14), accumulating stdout/stderr chunk
 * frames so large git output (diffs, log, fetch) is not capped by the single
 * WSS message limit. The computed `gitEnv` rides as the caller env (the daemon
 * merges it over its own host env). Resolves `{ stdout, stderr }` on exit 0; on
 * non-zero exit or timeout throws an Error carrying `.stdout` / `.stderr` /
 * numeric `.code`, matching the legacy `promisify(exec)` contract.
 */
async function runViaHostStream(
  command: string,
  args: readonly string[] | undefined,
  options: ExecOptions | undefined,
  label: string,
): Promise<ExecResult> {
  const env = toHostEnv(buildGitEnv(options?.env, options?.gitPolicy));
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const streamOptions: HostExecStreamOptions = {
    env,
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

  const handle = await hostExecStream(command, streamOptions);
  const result = await handle.done;
  const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
  const stderr = Buffer.concat(stderrChunks).toString('utf-8');

  if (result.timedOut) {
    const err = new Error(`Command timed out: ${label}`) as ExecError;
    err.stdout = stdout;
    err.stderr = stderr;
    err.killed = true;
    if (typeof result.exitCode === 'number') err.code = result.exitCode;
    throw err;
  }

  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : result.ok ? 0 : 1;
  if (exitCode !== 0) {
    const err = new Error(`Command failed: ${label}\n${stderr}`) as ExecError;
    err.stdout = stdout;
    err.stderr = stderr;
    err.code = exitCode;
    throw err;
  }

  return { stdout, stderr };
}

/**
 * Execute a shell command with git-safe environment.
 * Automatically applies gitEnv to prevent terminal prompts.
 *
 * @example
 * ```typescript
 *
 *
 * const { stdout } = await execAsync('git status', { cwd: '/path/to/repo' });
 * ```
 */
export async function execAsync(command: string, options?: ExecOptions): Promise<ExecResult> {
  const [shellCmd, shellFlag] = resolveShell(options);
  return runViaHostStream(shellCmd, [shellFlag, command], options, command);
}

/**
 * Execute a file with arguments with git-safe environment.
 * Safer than execAsync as it doesn't use a shell.
 *
 * @example
 * ```typescript
 *
 *
 * const { stdout } = await execFileAsync('git', ['status'], { cwd: '/path/to/repo' });
 * ```
 */
export async function execFileAsync(
  file: string,
  args: readonly string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return runViaHostStream(file, args, options, `${file} ${args.join(' ')}`);
}
