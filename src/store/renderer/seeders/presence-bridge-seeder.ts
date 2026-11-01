/**
 * Presence IPC bridge for `presence:report` (multiplayer w5).
 *
 * In Electron the report forwards verbatim to main, which merges every window
 * of a backend into one `presence.update` because the daemon connection is
 * pooled per backend (`PresenceAggregator`). Sending `presence.update` from
 * the renderer there would let each window replace the others' presence on
 * the shared connection. A bridge-less renderer (web build, tests) owns its
 * own daemon connection, so its report IS the connection's whole state and
 * goes straight to `presence.update`. A daemon without presence (`-32601`)
 * answers a `null` typing source, exactly like main does, so the saga
 * degrades the same way.
 *
 * Reports leave one at a time, in order: the browser transport answers
 * concurrent requests out of order and `presence.update` replaces the whole
 * state, so an older report must never land after a newer clear or switch.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';
import { expectsElectronPreloadBridge } from '$lib/utils/platform-capabilities';
import {
  PRESENCE_UNSUPPORTED_RPC_CODE,
  type PresenceReportParams,
  type PresenceReportResult,
  type PresenceUpdateResult,
} from '$shared/types/presence';

const { PRESENCE } = IPC_CHANNELS;

function isMethodNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if ((error as { code?: unknown }).code === 'METHOD_NOT_FOUND') return true;
    if ((error as { rpcCode?: unknown }).rpcCode === PRESENCE_UNSUPPORTED_RPC_CODE) return true;
  }
  return false;
}

async function forwardReport(params: PresenceReportParams): Promise<PresenceReportResult> {
  const bridge =
    typeof window !== 'undefined' && expectsElectronPreloadBridge()
      ? window.electronAPI
      : undefined;
  if (bridge && typeof bridge.invoke === 'function') {
    return (await bridge.invoke(PRESENCE.REPORT, params)) as PresenceReportResult;
  }
  try {
    const result = await backendRequest<PresenceUpdateResult>('presence.update', params);
    return { typingSource: result.typingSource };
  } catch (error) {
    if (isMethodNotFoundError(error)) return { typingSource: null };
    throw error;
  }
}

let lastReport: Promise<unknown> = Promise.resolve();

registerMockIpcHandler(PRESENCE.REPORT, (arg): Promise<PresenceReportResult> => {
  const params = arg as PresenceReportParams;
  const result = lastReport.then(() => forwardReport(params));
  lastReport = result.catch(() => undefined);
  return result;
});
