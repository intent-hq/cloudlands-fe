/**
 * One-shot arbitrary execution proxied to the daemon (`host.exec`,
 * PROTOCOL.md §5.14).
 *
 * The FE no longer spawns workspace-adjacent commands itself: every arbitrary
 * exec call-site forwards a JSON-RPC request to the running daemon, which owns
 * argv-based (no shell), tree-killed one-shot execution on whichever host the
 * workspace targets (local or remote). Long-running / streaming processes stay
 * on `script.*` / `terminal.*` (§5.8, §12) — this helper is one-shot only.
 *
 * Callers pass an `argv` array (`command` + `args`) — no shell interpolation.
 * `cwd` requires `workspaceId` so the daemon can enforce lexical within-workspace
 * containment; `env` values are merged on top of the daemon's host PATH and are
 * secret-safe (never logged / never echoed on the wire).
 */
import { Logger } from '../logger';
import { getBackendClient } from '../../features/backend/main/backend.ipc';

const logger = new Logger('HostExec');

export interface HostExecOptions {
  /** Positional arguments passed to `command`. No shell interpolation. */
  args?: string[];
  /** Working directory; requires `workspaceId` and must be inside its root. */
  cwd?: string;
  /** Extra env vars merged on top of the daemon's host env. Secret-safe. */
  env?: Record<string, string>;
  /** Wall-clock timeout in ms; the daemon reaps the whole process tree on hit. */
  timeoutMs?: number;
  /** Required when `cwd` is set so the daemon can enforce containment. */
  workspaceId?: string;
}

export interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Present and `true` when the daemon reaped the child on `timeoutMs`. */
  timedOut?: boolean;
}

/**
 * Invoke `host.exec` on the daemon and return the captured buffers. Rejects
 * with the RPC error on wire/transport failure so callers can decide between
 * degrading gracefully and surfacing the error — see PROTOCOL.md §5.14 for the
 * `-32602` (bad params) / `-32603` (cwd outside workspace) surface.
 */
export async function hostExec(
  command: string,
  options: HostExecOptions = {},
): Promise<HostExecResult> {
  const params: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    workspaceId?: string;
  } = { command };
  if (options.args && options.args.length > 0) {
    params.args = options.args;
  }
  if (typeof options.cwd === 'string' && options.cwd.length > 0) {
    params.cwd = options.cwd;
  }
  if (options.env && Object.keys(options.env).length > 0) {
    params.env = options.env;
  }
  if (typeof options.timeoutMs === 'number') {
    params.timeoutMs = options.timeoutMs;
  }
  if (typeof options.workspaceId === 'string' && options.workspaceId.length > 0) {
    params.workspaceId = options.workspaceId;
  }

  try {
    return await getBackendClient().request<HostExecResult>('host.exec', params);
  } catch (error) {
    logger.debug('host.exec request failed', {
      command,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
