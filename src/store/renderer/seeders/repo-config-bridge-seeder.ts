/**
 * Repo-config IPC bridge — serves `setup-scripts:read-repo-config`, the
 * pre-workspace probe for a repo's committed `.intent/config.json`.
 *
 * The new-workspace modal needs the repo config BEFORE any workspace exists,
 * so the daemon's workspaceId-scoped `repoConfig.get` RPC (PROTOCOL §5.33)
 * cannot serve it. Like the `git-tracking:get-remote-url` picker probe in
 * git-bridge-seeder.ts, this reads path-based through the daemon-owned exec
 * (`host.exec`, §5.14) so the renderer never touches the disk itself.
 *
 * The read is tolerant by contract (mirrors intentd's `read_repo_config`):
 * a missing/unreadable file folds to `{ success: true, data: { content:
 * null } }`, never an error — only transport failures produce the
 * `{ success: false, error }` envelope, which the caller
 * (`$features/setup-scripts/repo-config.ts`) also folds to "no config".
 * Content parsing/validation stays in that caller.
 *
 * Handlers are registered at import time (host-bridge idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

const READ_TIMEOUT_MS = 10_000;

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── setup-scripts:read-repo-config ──

registerMockIpcHandler(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, async (arg) => {
  const repoPath = asRecord(arg).repoPath;
  if (typeof repoPath !== 'string' || !repoPath) {
    return { success: false, error: 'repoPath is required' };
  }
  try {
    // Path-based (`cat`): the initializer probes repos that predate any
    // workspace, so no workspace cwd guard applies. Daemon hosts are POSIX;
    // if the command is unavailable the failure folds to "no config" at the
    // call site, same as a missing file.
    const result = await backendRequest<HostExecResult>('host.exec', {
      command: 'cat',
      args: [`${repoPath}/.intent/config.json`],
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      // Missing `.intent/config.json` is the common case — a soft empty
      // result, not an error.
      return { success: true, data: { content: null } };
    }
    return { success: true, data: { content: result.stdout } };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});
