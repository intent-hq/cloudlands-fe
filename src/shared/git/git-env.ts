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
export function getSSHAskPassPath(): string | undefined {
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

// ============================================================================
// Keychain Access Detection
// ============================================================================

/**
 * Result of keychain access risk detection
 */
export interface KeychainAccessRisk {
  /** Whether keychain access is likely to be triggered */
  willTriggerKeychain: boolean;
  /** The credential helper that will be used (if any) */
  credentialHelper: string | null;
  /** Whether the remote uses HTTPS (vs SSH) */
  isHttpsRemote: boolean;
  /** The remote URL being accessed */
  remoteUrl: string | null;
  /** Human-readable explanation */
  reason: string;
}

/**
 * Credential helpers that trigger macOS keychain access dialogs.
 *
 * IMPORTANT: Only include helpers that directly use the macOS Keychain in a way
 * that triggers the "allow access" dialog when credentials were stored by a
 * different application (different code signature).
 *
 * NOT included:
 * - git-credential-manager (GCM): Uses its own credential storage and OAuth flow.
 *   While GCM may use Keychain internally, it manages its own ACLs and doesn't
 *   trigger the problematic "allow access" dialog we're warning users about.
 * - manager, manager-core: These are GCM aliases, same reasoning applies.
 */
const KEYCHAIN_CREDENTIAL_HELPERS = ['osxkeychain', 'git-credential-osxkeychain'];

/**
 * Check if a URL is an HTTPS git remote (vs SSH)
 */
export function isHttpsRemote(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Check if a URL is an SSH git remote
 */
export function isSSHRemote(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('git@') ||
    trimmed.startsWith('ssh://') ||
    /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:/.test(trimmed)
  );
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

export type GitTerminalPromptPolicy = 'disable' | 'allow' | 'inherit';
export type GitCredentialHelperPolicy = 'disable' | 'allow' | 'inherit';

export interface GitEnvPolicy {
  terminalPrompt?: GitTerminalPromptPolicy;
  credentialHelper?: GitCredentialHelperPolicy;
}

/**
 * Environment variables for git operations.
 * Properly handles both SSH and HTTPS authentication.
 *
 * Key considerations:
 * - SSH: Ensure SSH_AUTH_SOCK is available for SSH agent
 * - HTTPS: Disable prompts but allow credential helpers to work non-interactively
 *
 * Also ensures PATH includes essential system directories for macOS GUI apps.
 *
 * @example
 * ```typescript
 * import { gitEnv } from '@/shared/git/git-env';
 *
 * spawn('git', ['status'], { env: gitEnv });
 * exec('git status', { env: gitEnv });
 * ```
 */
export const gitEnv: NodeJS.ProcessEnv = buildGitEnv();

/**
 * Create a git environment with additional custom variables.
 * Useful when you need to add extra env vars while keeping the base git config.
 *
 * @example
 * ```typescript
 * const env = createGitEnv({ MY_VAR: 'value' }, { credentialHelper: 'allow' });
 * spawn('git', ['status'], { env });
 * ```
 */
export function createGitEnv(
  additionalEnv?: NodeJS.ProcessEnv,
  policy?: GitEnvPolicy,
): NodeJS.ProcessEnv {
  return buildGitEnv(additionalEnv, policy);
}

/**
 * Create a base shell environment for interactive terminals.
 * Ensures PATH/SSH_AUTH_SOCK are present without forcing non-interactive git settings.
 */
export function createShellEnv(additionalEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Ensure PATH includes essential system directories (critical for macOS GUI apps)
    PATH: getEnhancedPath(),
    // Ensure SSH agent socket is available (critical for SSH-based git remotes)
    SSH_AUTH_SOCK: getSSHAuthSock() || process.env.SSH_AUTH_SOCK,
    ...additionalEnv,
  };
}

// ============================================================================
// Centralized exec utilities with git environment
// ============================================================================

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { killChildProcessTree } from '../main/process-tree-kill';

const execAsyncOriginal = promisify(exec);
const execFileAsyncOriginal = promisify(execFile);

// Default maxBuffer of 50MB for git operations.
// Node.js defaults to 1MB which is easily exceeded by git commands
// on large repositories (e.g., git fetch, git lfs pull, git worktree list).
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

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
export function getConfiguredSshKeyPath(): string | undefined {
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
 * Execute a shell command with git-safe environment.
 * Automatically applies gitEnv to prevent terminal prompts.
 *
 * @example
 * ```typescript
 * import { execAsync } from '@/shared/git/git-env';
 *
 * const { stdout } = await execAsync('git status', { cwd: '/path/to/repo' });
 * ```
 */
export async function execAsync(command: string, options?: ExecOptions): Promise<ExecResult> {
  const result = await execAsyncOriginal(command, {
    encoding: 'utf-8',
    maxBuffer: DEFAULT_MAX_BUFFER,
    ...options,
    env: buildGitEnv(options?.env, options?.gitPolicy),
    windowsHide: true,
  });
  // With encoding: 'utf-8', stdout and stderr are always strings
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Execute a file with arguments with git-safe environment.
 * Safer than execAsync as it doesn't use a shell.
 *
 * @example
 * ```typescript
 * import { execFileAsync } from '@/shared/git/git-env';
 *
 * const { stdout } = await execFileAsync('git', ['status'], { cwd: '/path/to/repo' });
 * ```
 */
export async function execFileAsync(
  file: string,
  args: readonly string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  const result = await execFileAsyncOriginal(file, args, {
    encoding: 'utf-8',
    maxBuffer: DEFAULT_MAX_BUFFER,
    ...options,
    env: buildGitEnv(options?.env, options?.gitPolicy),
    windowsHide: true,
  });
  // With encoding: 'utf-8', stdout and stderr are always strings
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ============================================================================
// Robust exec with retry logic for transient errors
// ============================================================================

import { spawn } from 'child_process';

// Default timeout for exec commands (2 minutes) to prevent UI freezes
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

// Default retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 2000;

/**
 * Transient error codes that should trigger a retry.
 * These are typically resource exhaustion errors that resolve on their own.
 */
const TRANSIENT_ERROR_CODES = [
  'EAGAIN', // Resource temporarily unavailable (too many processes/file descriptors)
  'EMFILE', // Too many open files in system
  'ENFILE', // Too many open files
  'EBUSY', // Resource busy
  'ETIMEDOUT', // Connection timed out (for network operations)
  'ECONNRESET', // Connection reset
  'EPIPE', // Broken pipe
];

/**
 * Check if an error is transient and should be retried.
 */
function isTransientError(error: NodeJS.ErrnoException): boolean {
  if (!error) return false;

  // Check error code
  if (error.code && TRANSIENT_ERROR_CODES.includes(error.code)) {
    return true;
  }

  // Check error message for transient patterns
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('eagain') ||
    message.includes('resource temporarily unavailable') ||
    message.includes('too many open files') ||
    message.includes('emfile') ||
    message.includes('enfile') ||
    message.includes('ebusy')
  );
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateBackoffDelay(attempt: number, initialDelay: number, maxDelay: number): number {
  // Exponential backoff: initialDelay * 2^attempt
  const exponentialDelay = initialDelay * Math.pow(2, attempt);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = Math.min(exponentialDelay + jitter, maxDelay);
  return Math.max(0, delay);
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 2000) */
  maxDelayMs?: number;
}

/**
 * Execute a shell command with git-safe environment, retry logic for transient errors,
 * and EBADF fallback handling.
 *
 * This is the most robust exec function and should be used for critical operations
 * that must not fail due to transient system resource issues.
 *
 * Features:
 * - Automatic retry with exponential backoff for EAGAIN, EMFILE, EBUSY, etc.
 * - Falls back to spawn if exec fails with EBADF (broken pipe) errors
 * - Default 2 minute timeout to prevent indefinite hangs
 *
 * @example
 * ```typescript
 * import { execAsyncWithRetry } from '@/shared/git/git-env';
 *
 * const { stdout } = await execAsyncWithRetry('git status', { cwd: '/path/to/repo' });
 * // Or with custom retry options:
 * const { stdout } = await execAsyncWithRetry('auggie --version', {
 *   timeout: 10000,
 *   maxRetries: 5,
 *   initialDelayMs: 50,
 * });
 * ```
 */
export async function execAsyncWithRetry(
  command: string,
  options?: ExecOptions & RetryOptions,
): Promise<ExecResult> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeout = options?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

  const execOptions: ExecOptions = {
    ...options,
    timeout,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await execAsync(command, execOptions);
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      lastError = errnoError;

      // If it's a transient error and we have retries left, wait and retry
      if (isTransientError(errnoError) && attempt < maxRetries) {
        const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // If we get EBADF error, try using spawn as a fallback (no retry needed)
      if (errnoError.code === 'EBADF' || errnoError.message?.includes('EBADF')) {
        return execWithSpawnFallback(command, execOptions);
      }

      // Non-transient error or out of retries
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(`Command failed after ${maxRetries} retries: ${command}`);
}

/**
 * Execute command using spawn as a fallback when exec fails.
 * Used internally by execAsyncWithRetry for EBADF errors.
 */
function execWithSpawnFallback(command: string, options?: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');
    const timeout = options?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;
    let timeoutId: NodeJS.Timeout | undefined;

    const child = spawn(cmd, args, {
      cwd: options?.cwd,
      shell: true,
      env: buildGitEnv(options?.env, options?.gitPolicy),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    // Set up timeout for spawn fallback
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        // spawned with shell: true, so child.kill() only kills the shell.
        // Use killChildProcessTree to kill the actual command underneath.
        killChildProcessTree(child);
        reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
      }, timeout);
    }

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const spawnError = new Error(`Command failed: ${command}\n${stderr}`);
        (spawnError as NodeJS.ErrnoException).code = String(code);
        reject(spawnError);
      }
    });
  });
}

/**
 * Execute a file directly (without shell) with retry logic for transient errors.
 *
 * This is more efficient and secure than execAsyncWithRetry because it doesn't
 * spawn a shell. Use this when you have the full path to an executable.
 *
 * @example
 * ```typescript
 * import { execFileAsyncWithRetry } from '@/shared/git/git-env';
 *
 * const { stdout } = await execFileAsyncWithRetry('/usr/local/bin/auggie', ['--version']);
 * ```
 */
export async function execFileAsyncWithRetry(
  file: string,
  args: readonly string[],
  options?: ExecOptions & RetryOptions,
): Promise<ExecResult> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeout = options?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

  const execOptions: ExecOptions = {
    ...options,
    timeout,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await execFileAsync(file, args, execOptions);
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      lastError = errnoError;

      // If it's a transient error and we have retries left, wait and retry
      if (isTransientError(errnoError) && attempt < maxRetries) {
        const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Non-transient error or out of retries
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw (
    lastError || new Error(`Command failed after ${maxRetries} retries: ${file} ${args.join(' ')}`)
  );
}

/**
 * @deprecated Use execAsyncWithRetry instead for better error handling.
 * Execute a shell command with git-safe environment and EBADF error handling.
 * Falls back to spawn if exec fails with EBADF (broken pipe) errors.
 * All commands have a default 2 minute timeout to prevent indefinite hangs.
 */
export async function execAsyncRobust(command: string, options?: ExecOptions): Promise<ExecResult> {
  // Delegate to the new retry-enabled function
  return execAsyncWithRetry(command, options);
}

// ============================================================================
// Keychain Access Detection Functions
// ============================================================================

/**
 * Get the configured credential helpers for a repository.
 * Checks local, global, and system git config.
 *
 * @param cwd - The repository path to check
 * @returns The credential helper names, or empty array if none configured
 */
export async function getCredentialHelpers(cwd?: string): Promise<string[]> {
  try {
    // Check local config first, then global/system
    const { stdout } = await execAsync('git config --get-all credential.helper', {
      cwd,
      timeout: 5000,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // No credential helper configured or git command failed
    return [];
  }
}

/**
 * Get the remote URL for a repository.
 *
 * @param cwd - The repository path
 * @param remoteName - The remote name (default: 'origin')
 * @returns The remote URL, or null if not found
 */
export async function getRemoteUrl(cwd: string, remoteName = 'origin'): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`git remote get-url ${remoteName}`, {
      cwd,
      timeout: 5000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a credential helper is one that triggers macOS keychain access.
 */
export function isKeychainCredentialHelper(helper: string | null): boolean {
  if (!helper) return false;
  const lowerHelper = helper.toLowerCase();
  return KEYCHAIN_CREDENTIAL_HELPERS.some(
    (kh) => lowerHelper.includes(kh.toLowerCase()) || lowerHelper === kh.toLowerCase(),
  );
}

/**
 * Check if a credential helper is a Git Credential Manager helper.
 */
export function isGcmCredentialHelper(helper: string | null): boolean {
  if (!helper) return false;
  const lowerHelper = helper.toLowerCase();
  return (
    lowerHelper === 'manager' ||
    lowerHelper === 'manager-core' ||
    lowerHelper === 'git-credential-manager' ||
    lowerHelper.includes('git-credential-manager')
  );
}

/**
 * Detect if a git network operation will likely trigger keychain access.
 *
 * This is used by the git services to decide whether a network operation should
 * enter the keychain consent path before running.
 *
 * @param cwd - The repository path
 * @param operation - The git operation (push, pull, fetch, clone)
 * @returns Risk assessment with details
 *
 * @example
 * ```typescript
 * const risk = await detectKeychainAccessRisk('/path/to/repo');
 * if (risk.willTriggerKeychain) {
 *   // Route through the keychain consent flow before continuing
 *   console.log(risk.reason);
 * }
 * ```
 */
export async function detectKeychainAccessRisk(
  cwd: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  operation: 'push' | 'pull' | 'fetch' | 'clone' = 'push',
): Promise<KeychainAccessRisk> {
  // Get remote URL
  const remoteUrl = await getRemoteUrl(cwd);

  // If no remote, no keychain access needed
  if (!remoteUrl) {
    return {
      willTriggerKeychain: false,
      credentialHelper: null,
      isHttpsRemote: false,
      remoteUrl: null,
      reason: 'No remote configured',
    };
  }

  // Check if it's an HTTPS remote
  const isHttps = isHttpsRemote(remoteUrl);

  // SSH remotes don't use credential helpers
  if (!isHttps) {
    return {
      willTriggerKeychain: false,
      credentialHelper: null,
      isHttpsRemote: false,
      remoteUrl,
      reason: 'SSH remotes use SSH keys, not credential helpers',
    };
  }

  // Get credential helpers (could be multiple)
  const credentialHelpers = await getCredentialHelpers(cwd);

  if (credentialHelpers.length === 0) {
    return {
      willTriggerKeychain: false,
      credentialHelper: null,
      isHttpsRemote: true,
      remoteUrl,
      reason: 'No credential helper configured - git will fail without credentials',
    };
  }

  const usesGcm = credentialHelpers.some((helper) => isGcmCredentialHelper(helper));
  const usesKeychain = credentialHelpers.some((helper) => isKeychainCredentialHelper(helper));
  const credentialHelper = credentialHelpers[0] ?? null;

  if (usesGcm) {
    return {
      willTriggerKeychain: false,
      credentialHelper,
      isHttpsRemote: true,
      remoteUrl,
      reason: `Using Git Credential Manager (${credentialHelper}) which does not require macOS keychain access dialogs`,
    };
  }

  if (!usesKeychain) {
    return {
      willTriggerKeychain: false,
      credentialHelper,
      isHttpsRemote: true,
      remoteUrl,
      reason: `Using credential helper "${credentialHelper}" which does not use macOS keychain`,
    };
  }

  // Cannot reliably detect when macOS will prompt for keychain access.
  // Until detection is reliable, do not trigger the preflight consent flow.
  return {
    willTriggerKeychain: false,
    credentialHelper,
    isHttpsRemote: true,
    remoteUrl,
    reason: `Using keychain-based credential helper "${credentialHelper}" - cannot reliably detect if macOS will prompt`,
  };
}

/**
 * Network operations that may trigger credential/keychain access
 */
export const GIT_NETWORK_OPERATIONS = ['push', 'pull', 'fetch', 'clone', 'ls-remote'] as const;
export type GitNetworkOperation = (typeof GIT_NETWORK_OPERATIONS)[number];

/**
 * Check if a git command is a network operation that may need credentials
 */
export function isNetworkOperation(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return GIT_NETWORK_OPERATIONS.some((op) => lowerCommand.includes(op));
}
