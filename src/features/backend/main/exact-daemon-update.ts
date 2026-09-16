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
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    if (!isCurrentClient()) throw new Error('Device connection changed during update'); // i18n-ignore (update diagnostic)
    if (client.getStatus() === 'connected') {
      let current: UpdateStatus;
      try {
        current = await client.request<UpdateStatus>('system.status');
      } catch (error) {
        if (client.getStatus() === 'connected') throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (current.version === targetVersion) return { ok: true };
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the requested daemon version'); // i18n-ignore (update diagnostic)
}
