import { compareToPinnedVersion } from '$shared/intentd-version-compare';
import type { UpdateBackendResult } from '$shared/types/connections';
import type { JsonRpcClient } from './json-rpc-client';
import { JsonRpcError } from './json-rpc-errors';

interface UpdateStatus {
  version?: string;
  exactUpdateSupported?: boolean;
  targetUpdate?: {
    targetVersion: string;
    state: 'installing' | 'restarting' | 'failed';
    message?: string;
  };
}

// docs/protocol/startup-readiness.md bounds the daemon's retry hint to 1-30s.
const STARTUP_RETRY_DEFAULT_MS = 1000;
const STARTUP_RETRY_MIN_MS = 1000;
const STARTUP_RETRY_MAX_MS = 30_000;
// After a terminal startup failure the sitter stops the new daemon and rolls
// back; give the restored daemon this long to report the install outcome.
const STARTUP_FAILURE_GRACE_MS = 2 * 60_000;
const UPDATE_DEADLINE_MS = 12 * 60_000;

type StartupReply =
  { kind: 'not-ready'; retryAfterMs: number } | { kind: 'failed'; message: string };

/**
 * Recognize the daemon's structured startup reply (`-32012`, see
 * docs/protocol/startup-readiness.md). A restarted daemon reconnects before it
 * is ready and answers every request, `system.status` included, with a
 * retryable `daemon-not-ready`; a terminal `daemon-startup-failed` means the
 * new version never became ready. Anything else is not a startup reply.
 */
function classifyStartupReply(error: unknown): StartupReply | undefined {
  if (!(error instanceof JsonRpcError) || error.rpcCode !== -32012) return undefined;
  const data = (error.data ?? {}) as {
    code?: unknown;
    retryable?: unknown;
    retryAfterMs?: unknown;
    startup?: { failure?: { message?: unknown } };
  };
  if (data.code === 'daemon-startup-failed') {
    const detail = data.startup?.failure?.message;
    return {
      kind: 'failed',
      message: typeof detail === 'string' && detail.trim() ? detail : error.message,
    };
  }
  if (data.code !== 'daemon-not-ready' || data.retryable !== true) return undefined;
  const hint =
    typeof data.retryAfterMs === 'number' && Number.isFinite(data.retryAfterMs)
      ? data.retryAfterMs
      : STARTUP_RETRY_DEFAULT_MS;
  return {
    kind: 'not-ready',
    retryAfterMs: Math.min(STARTUP_RETRY_MAX_MS, Math.max(STARTUP_RETRY_MIN_MS, hint)),
  };
}

/** Main supplies the bundle pin. An absent capability never falls back to a channel update. */
export async function updateDaemonToPin(
  client: Pick<JsonRpcClient, 'request' | 'getStatus'>,
  targetVersion: string | null,
  markPending: () => void,
  isCurrentClient: () => boolean = () => true,
): Promise<UpdateBackendResult> {
  if (client.getStatus() !== 'connected') return { ok: false, reason: 'not-connected' };
  if (!targetVersion) return { ok: false, reason: 'unsupported' };
  const status = await client.request<UpdateStatus>('system.status');
  if (status.exactUpdateSupported !== true) return { ok: false, reason: 'unsupported' };
  const comparison = compareToPinnedVersion(status.version ?? '', targetVersion);
  if (comparison === 'equal') return { ok: true };
  if (comparison !== 'older') return { ok: false, reason: 'unsupported' };
  if (client.getStatus() !== 'connected') return { ok: false, reason: 'not-connected' };
  // Mark before the request: a fast install can restart before its response arrives.
  markPending();
  let acceptanceError: unknown;
  let accepted: { ok: boolean; targetVersion: string } | undefined;
  try {
    accepted = await client.request('system.requestUpdate', { targetVersion });
  } catch (error) {
    if (error instanceof JsonRpcError) throw error;
    // A restart can close the connection before the acknowledgement arrives.
    // Reconcile with status; never resend an uncertain mutation.
    acceptanceError = error;
  }
  if (!acceptanceError && (accepted?.ok !== true || accepted.targetVersion !== targetVersion)) {
    throw new Error('Daemon did not acknowledge the exact update target'); // i18n-ignore (wire contract failure)
  }
  const deadline = Date.now() + UPDATE_DEADLINE_MS;
  // Sleep in short slices so a replaced connection or the deadline is noticed
  // promptly even during a long daemon-requested retry delay.
  const pause = async (ms: number) => {
    const until = Math.min(Date.now() + ms, deadline);
    while (Date.now() < until && isCurrentClient()) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())));
    }
  };
  let startupFailure: { message: string; giveUpAt: number } | undefined;
  while (Date.now() < deadline) {
    if (!isCurrentClient()) throw new Error('Device connection changed during update'); // i18n-ignore (update diagnostic)
    if (startupFailure && Date.now() >= startupFailure.giveUpAt) {
      return { ok: false, reason: 'failed', message: startupFailure.message };
    }
    if (client.getStatus() === 'connected') {
      let current: UpdateStatus;
      try {
        current = await client.request<UpdateStatus>('system.status');
      } catch (error) {
        const startup = classifyStartupReply(error);
        if (startup?.kind === 'not-ready') {
          // The restarted daemon is reachable but still starting; keep waiting.
          // A fresh attempt (retry or rollback) supersedes an earlier failure.
          startupFailure = undefined;
          markPending();
          await pause(startup.retryAfterMs);
          continue;
        }
        if (startup?.kind === 'failed') {
          // Wait (bounded) for the rollback daemon to report the real cause.
          startupFailure ??= {
            message: startup.message,
            giveUpAt: Date.now() + STARTUP_FAILURE_GRACE_MS,
          };
          await pause(1000);
          continue;
        }
        if (client.getStatus() === 'connected') throw error;
        await pause(1000);
        continue;
      }
      if (compareToPinnedVersion(current.version ?? '', targetVersion) === 'equal')
        return { ok: true };
      const update = current.targetUpdate;
      if (!update || update.targetVersion !== targetVersion) {
        if (acceptanceError) throw acceptanceError;
        throw new Error('Daemon reconnected without the requested version'); // i18n-ignore (wire contract failure)
      }
      if (update.state === 'failed') {
        return { ok: false, reason: 'failed', message: update.message };
      }
      if (update.state === 'installing') markPending();
    }
    await pause(1000);
  }
  if (startupFailure) return { ok: false, reason: 'failed', message: startupFailure.message };
  throw new Error('Timed out waiting for the requested daemon version'); // i18n-ignore (update diagnostic)
}
