import { IPC_CHANNELS } from '$shared/ipc-registry';
import { emitMockIpcEvent } from '$shared/ipc-mock-router';
import type { TransferProgressEvent } from '$shared/types/workspace-transfer';

const MiB = 1024 * 1024;
/** `workspace.transfer.plan` estimates by workspace. */
const SIZES: Record<string, number> = {
  'multi-a': 1 * MiB,
  'multi-b': 2 * MiB,
  'multi-c': 0.5 * MiB,
  'multi-d': 4 * MiB,
};
/** Workspaces whose `transfer:start` fails. */
const FAILS: Record<string, string> = { 'multi-c': 'the destination ran out of disk space' };

interface BulkTransferRelayCall {
  channel: string;
  params: unknown;
}

declare global {
  interface Window {
    __homeBulkTransfer?: {
      calls: () => BulkTransferRelayCall[];
      /** Let every held and future `transfer:start` finish. */
      release: () => void;
    };
  }
}

/**
 * Scripts `workspace.transfer.plan` and the `transfer:*` relay channels, and
 * emits `transfer:progress` through the mock IPC router. Each
 * `transfer:start` reports half its archive relayed, then holds until
 * `release()` so tests can inspect the running state.
 */
export function setupBulkTransferRelay(): () => void {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Bulk transfer preview bridge is unavailable');
  const calls: BulkTransferRelayCall[] = [];
  let held = true;
  let waiting: Array<(result: unknown) => void> = [];

  const progress = (event: TransferProgressEvent) =>
    emitMockIpcEvent(IPC_CHANNELS.TRANSFER.PROGRESS, event);

  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      if (channel === IPC_CHANNELS.BACKEND.REQUEST) {
        const request = payload as { method?: string; params?: { workspaceId?: string } };
        if (request?.method === 'workspace.transfer.plan') {
          const workspaceId = request.params?.workspaceId ?? '';
          return { ok: true, result: { plan: { totalSizeBytes: SIZES[workspaceId] ?? 0 } } };
        }
        return previous.invoke(channel, payload);
      }
      if (channel === IPC_CHANNELS.TRANSFER.START) {
        calls.push({ channel, params: payload });
        const { workspaceId } = payload as { workspaceId: string };
        if (FAILS[workspaceId]) return { success: false, error: FAILS[workspaceId] };
        const size = SIZES[workspaceId] ?? MiB;
        progress({
          workspaceId,
          phase: 'building',
          stage: 'bundling-git',
          bytesDown: 0,
          bytesUp: 0,
          chunksDone: 0,
        });
        progress({
          workspaceId,
          phase: 'relaying',
          bytesTotal: size,
          bytesDown: size,
          bytesUp: 0,
          chunksTotal: 2,
          chunksDone: 1,
        });
        if (!held) return { success: true, interruptedAgents: ['agent-1'] };
        return new Promise((resolve) => waiting.push(resolve));
      }
      if (channel === IPC_CHANNELS.TRANSFER.FINALIZE) {
        calls.push({ channel, params: payload });
        return { success: true };
      }
      if (channel === IPC_CHANNELS.TRANSFER.CANCEL) {
        calls.push({ channel, params: payload });
        for (const resolve of waiting) resolve({ success: false, error: 'cancelled' });
        waiting = [];
        return { success: true };
      }
      return previous.invoke(channel, payload);
    },
  };

  window.__homeBulkTransfer = {
    calls: () => structuredClone(calls),
    release: () => {
      held = false;
      for (const resolve of waiting) resolve({ success: true, interruptedAgents: ['agent-1'] });
      waiting = [];
    },
  };

  return () => {
    delete window.__homeBulkTransfer;
    window.electronAPI = previous;
  };
}
