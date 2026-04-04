/**
 * Safe Git Operations
 *
 * Secure wrapper for git operations that prevents command injection
 * and path traversal vulnerabilities.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { Logger } from '../../../../shared/logger';
import { createGitEnv } from '../../../../shared/git/git-env';

const logger = new Logger('SafeGitOperations');

export interface GitCommandOptions {
  cwd: string;
  maxBuffer?: number;
  timeout?: number;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a git command safely without shell interpretation
 *
 * @param args Git command arguments (e.g., ['status', '--porcelain'])
 * @param options Execution options
 * @returns Command output
 */
export async function execGitCommand(
  args: string[],
  options: GitCommandOptions,
): Promise<GitCommandResult> {
  // Validate working directory exists and is accessible (ASYNC)
  const normalizedCwd = path.resolve(options.cwd);

  // Check if directory exists and is valid
  try {
    const stats = await fsPromises.stat(normalizedCwd);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${options.cwd}`);
    }
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException;
    if (errnoError.code === 'ENOENT') {
      throw new Error(`Working directory does not exist: ${options.cwd}`);
    }
    throw error;
  }

  // Prevent obvious path traversal attempts
  if (normalizedCwd.includes('../..') || normalizedCwd.includes('..\\..')) {
    throw new Error(`Suspicious path traversal attempt: ${options.cwd}`);
  }

  return new Promise((resolve, reject) => {
    // Spawn git process without shell
    const child = spawn('git', args, {
      cwd: normalizedCwd,
      shell: false, // CRITICAL: Never use shell to prevent injection
      windowsHide: true,
      env: {
        // Disable credential helpers for polling/diff operations to avoid keychain prompts.
        ...createGitEnv(undefined, { credentialHelper: 'disable' }),
        // Disable git hooks that could execute arbitrary code
        GIT_HOOKS_PATH: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    });

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;
    const maxBuffer = options.maxBuffer || 10 * 1024 * 1024; // 10MB default

    // Set timeout if specified
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (options.timeout) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Git command timed out after ${options.timeout}ms`));
      }, options.timeout);
    }

    // Collect stdout
    child.stdout.on('data', (data) => {
      stdoutSize += data.length;
      if (stdoutSize > maxBuffer) {
        child.kill('SIGTERM');
        reject(new Error(`stdout exceeded buffer limit of ${maxBuffer} bytes`));
        return;
      }
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr.on('data', (data) => {
      stderrSize += data.length;
      if (stderrSize > maxBuffer) {
        child.kill('SIGTERM');
        reject(new Error(`stderr exceeded buffer limit of ${maxBuffer} bytes`));
        return;
      }
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    // Handle process error
    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });
  });
}

/**
 * Validate and sanitize file paths
 *
 * @param filePath Path to validate
 * @param workspacePath Workspace root path
 * @returns Sanitized relative path
 */
export function sanitizeFilePath(filePath: string, workspacePath: string): string {
  // Normalize paths
  const normalizedWorkspace = path.resolve(workspacePath);
  const normalizedFile = path.resolve(workspacePath, filePath);

  // Check for path traversal
  if (!normalizedFile.startsWith(normalizedWorkspace)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  // Return relative path
  return path.relative(normalizedWorkspace, normalizedFile);
}

/**
 * Safe git status command
 */
export async function gitStatus(
  workspacePath: string,
  options?: { all?: boolean },
): Promise<GitCommandResult> {
  const args = ['status', '--porcelain'];
  if (options?.all) {
    args.push('-uall');
  }

  return execGitCommand(args, { cwd: workspacePath });
}

/**
 * Safe git diff command
 */
export async function gitDiff(
  workspacePath: string,
  filePath?: string,
  options?: { staged?: boolean; numstat?: boolean },
): Promise<GitCommandResult> {
  const args = ['diff'];

  if (options?.staged) {
    args.push('--cached');
  }

  if (options?.numstat) {
    args.push('--numstat');
  }

  if (filePath) {
    // Sanitize file path
    const safePath = sanitizeFilePath(filePath, workspacePath);
    args.push('--', safePath);
  }

  return execGitCommand(args, {
    cwd: workspacePath,
    maxBuffer: 50 * 1024 * 1024, // 50MB for diffs
  });
}

/**
 * Safe git check-ignore command
 */
export async function gitCheckIgnore(workspacePath: string, filePath: string): Promise<boolean> {
  try {
    const safePath = sanitizeFilePath(filePath, workspacePath);
    const result = await execGitCommand(['check-ignore', safePath], { cwd: workspacePath });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Safe git rev-parse command
 */
export async function gitRevParse(
  workspacePath: string,
  ref: string = 'HEAD',
): Promise<string | null> {
  try {
    // Validate ref to prevent injection
    if (!/^[a-zA-Z0-9\-_/.]+$/.test(ref)) {
      throw new Error(`Invalid git ref: ${ref}`);
    }

    const result = await execGitCommand(['rev-parse', ref], { cwd: workspacePath });

    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch (error) {
    logger.error('Failed to rev-parse:', error);
    return null;
  }
}

/**
 * Safe git branch command
 */
export async function gitCurrentBranch(workspacePath: string): Promise<string | null> {
  try {
    const result = await execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
    });

    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch (error) {
    logger.error('Failed to get current branch:', error);
    return null;
  }
}

/**
 * Batch git diff for multiple files
 */
export async function gitDiffBatch(
  workspacePath: string,
  filePaths: string[],
  options?: { staged?: boolean },
): Promise<Map<string, GitCommandResult>> {
  const results = new Map<string, GitCommandResult>();

  // Process files in parallel with concurrency limit
  const BATCH_SIZE = 5;
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (filePath) => {
      try {
        const result = await gitDiff(workspacePath, filePath, options);
        results.set(filePath, result);
      } catch (error) {
        logger.error(`Failed to get diff for ${filePath}:`, error);
        results.set(filePath, {
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        });
      }
    });

    await Promise.all(promises);
  }

  return results;
}

/**
 * Check if git is available
 */
export async function isGitAvailable(workspacePath: string): Promise<boolean> {
  try {
    const result = await execGitCommand(['--version'], { cwd: workspacePath, timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if directory is a git repository
 */
export async function isGitRepository(workspacePath: string): Promise<boolean> {
  try {
    // First check if directory exists (ASYNC)
    try {
      await fsPromises.access(workspacePath);
    } catch {
      logger.debug('Directory does not exist', { workspacePath });
      return false;
    }

    // Check if .git directory exists (quick check - ASYNC)
    const gitDir = path.join(workspacePath, '.git');
    try {
      await fsPromises.access(gitDir);
    } catch {
      logger.debug('No .git directory found', { workspacePath });
      return false;
    }

    // Verify with git command
    const result = await execGitCommand(['rev-parse', '--git-dir'], {
      cwd: workspacePath,
      timeout: 5000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
