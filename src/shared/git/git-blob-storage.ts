/**
 * Git Blob Storage Utilities
 *
 * Helper functions for storing and retrieving arbitrary content as git blobs.
 * Uses git's object storage with custom refs to prevent garbage collection.
 *
 * All operations fail silently (return null) for graceful fallback.
 */

import {
  exec,
  spawn,
} from 'child_process';
import { promisify } from 'util';
import { createGitEnv } from './git-env';

const execAsync = promisify(exec);

/**
 * Check if a directory is inside a git repository.
 *
 * @param dir - Directory path to check
 * @returns true if dir is inside a git repository, false otherwise
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', {
      cwd: dir,
      encoding: 'utf-8',
      env: createGitEnv(),
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Store content as a git blob and create a ref to prevent garbage collection.
 * Creates a ref at refs/intent/blobs/<sha> to keep the blob alive.
 *
 * @param content - Content to store
 * @param repoRoot - Path to the git repository root
 * @returns The blob SHA if successful, null on any error
 */
export function storeBlob(content: string, repoRoot: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      // Use spawn to pipe content to git hash-object
      const hashObject = spawn('git', ['hash-object', '-w', '--stdin'], {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: createGitEnv(),
        windowsHide: true,
      });

      let stdout = '';

      hashObject.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      hashObject.on('error', () => {
        resolve(null);
      });

      hashObject.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        const sha = stdout.trim();
        if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
          resolve(null);
          return;
        }

        // Create a ref to prevent garbage collection
        const updateRef = spawn('git', ['update-ref', `refs/intent/blobs/${sha}`, sha], {
          cwd: repoRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createGitEnv(),
          windowsHide: true,
        });

        updateRef.on('error', () => {
          // update-ref failed; blob exists but is not GC-protected
          // Return null so callers retain inline content
          resolve(null);
        });

        updateRef.on('close', (refCode) => {
          // Only return sha if update-ref succeeded (exit code 0)
          // Otherwise blob may be GC'd and callers need to keep inline content
          resolve(refCode === 0 ? sha : null);
        });
      });

      // Handle stdin EPIPE errors (process may exit before consuming all input)
      hashObject.stdin.on('error', () => {
        // Benign: process exited before reading all stdin data.
        // The 'close' handler above will resolve with null on non-zero exit.
      });

      // Write content and close stdin
      hashObject.stdin.write(content);
      hashObject.stdin.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Retrieve content from a git blob by SHA.
 *
 * @param sha - The blob SHA to retrieve
 * @param repoRoot - Path to the git repository root
 * @returns The blob content if found, null on any error
 */
export function getBlob(sha: string, repoRoot: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      // Validate SHA format to prevent command injection
      if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
        resolve(null);
        return;
      }

      const catFile = spawn('git', ['cat-file', '-p', sha], {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: createGitEnv(),
        windowsHide: true,
      });

      let stdout = '';

      catFile.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      catFile.on('error', () => {
        resolve(null);
      });

      catFile.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }
        resolve(stdout);
      });
    } catch {
      resolve(null);
    }
  });
}
