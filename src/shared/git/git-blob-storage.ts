/**
 * Git Blob Storage Utilities
 *
 * Helper functions for storing and retrieving arbitrary content as git blobs.
 * Uses git's object storage with custom refs to prevent garbage collection.
 *
 * All operations fail silently (return null) for graceful fallback.
 */

import { Buffer } from 'node:buffer';
import { hostExecStream } from '../main/host-exec-stream';
import { createGitEnv } from './git-env';

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
 * Normalize a terminal `host:exec:exit` frame to a numeric exit code.
 */
function resolveExitCode(result: { ok: boolean; exitCode?: number }): number {
  if (typeof result.exitCode === 'number') return result.exitCode;
  return result.ok ? 0 : 1;
}

/**
 * Check if a directory is inside a git repository.
 *
 * @param dir - Directory path to check
 * @returns true if dir is inside a git repository, false otherwise
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    const handle = await hostExecStream('git', {
      args: ['rev-parse', '--git-dir'],
      cwd: dir,
      env: toHostEnv(createGitEnv()),
      timeoutMs: 5000,
    });
    const result = await handle.done;
    return resolveExitCode(result) === 0;
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
export async function storeBlob(content: string, repoRoot: string): Promise<string | null> {
  try {
    const env = toHostEnv(createGitEnv());

    // Pipe content to `git hash-object -w --stdin`: the initial stdin payload
    // rides in the request; endStdin() signals EOF so git reads to completion.
    const hashStdout: Buffer[] = [];
    const hashObject = await hostExecStream('git', {
      args: ['hash-object', '-w', '--stdin'],
      cwd: repoRoot,
      env,
      stdin: content,
      onStdout: (chunk: Buffer) => hashStdout.push(chunk),
    });
    // A failed EOF write is benign: the child may have already exited and closed
    // the pipe; `done` still settles from the terminal exit frame.
    try {
      await hashObject.endStdin();
    } catch {
      // ignore — process may have exited before consuming all stdin
    }
    const hashResult = await hashObject.done;
    if (resolveExitCode(hashResult) !== 0) {
      return null;
    }

    const sha = Buffer.concat(hashStdout).toString().trim();
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
      return null;
    }

    // Create a ref to prevent garbage collection.
    const updateRef = await hostExecStream('git', {
      args: ['update-ref', `refs/intent/blobs/${sha}`, sha],
      cwd: repoRoot,
      env,
    });
    const refResult = await updateRef.done;
    // Only return sha if update-ref succeeded (exit code 0). Otherwise the blob
    // may be GC'd and callers need to keep inline content.
    return resolveExitCode(refResult) === 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve content from a git blob by SHA.
 *
 * @param sha - The blob SHA to retrieve
 * @param repoRoot - Path to the git repository root
 * @returns The blob content if found, null on any error
 */
export async function getBlob(sha: string, repoRoot: string): Promise<string | null> {
  try {
    // Validate SHA format to prevent command injection
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
      return null;
    }

    const stdoutChunks: Buffer[] = [];
    const catFile = await hostExecStream('git', {
      args: ['cat-file', '-p', sha],
      cwd: repoRoot,
      env: toHostEnv(createGitEnv()),
      onStdout: (chunk: Buffer) => stdoutChunks.push(chunk),
    });
    const result = await catFile.done;
    if (resolveExitCode(result) !== 0) {
      return null;
    }
    return Buffer.concat(stdoutChunks).toString();
  } catch {
    return null;
  }
}
