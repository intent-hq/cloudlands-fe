/**
 * Remote machines — IPC registration (main process).
 *
 * Binds the remote-machine relay (`remote-machine-relay.ts`) to Electron IPC.
 * The current backend is the daemon bound to the invoking window; the machine
 * is a live pooled owner connection (never a guest session). The executor
 * token stays inside the relay — results carry only the saved machine row or
 * a failure code.
 */

import { ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type {
  RemoteMachineExposeParams,
  RemoteMachineUnexposeParams,
} from '$shared/types/remote-machines';
import * as connectionsStore from './desktop-connections-store';
import {
  connectBackendClient,
  getBackendClientForConnection,
  getBackendClientForIpcEvent,
  getLocalBackendClient,
  resolveBackendRecord,
} from './backend.ipc';
import { createNodeInvites, type NodeInvites } from './node-invites';
import {
  createRemoteMachineRelay,
  type RemoteMachineBackend,
  type RemoteMachineRelay,
} from './remote-machine-relay';

const logger = new Logger('RemoteMachinesIPC');
const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;

let handlersRegistered = false;
let relay: RemoteMachineRelay | null = null;
let nodeInvites: NodeInvites | null = null;

/** Held `intent://node` links, shared by the paste row and the OS link handler. */
export function getNodeInvites(): NodeInvites {
  nodeInvites ??= createNodeInvites();
  return nodeInvites;
}

function getRelay(): RemoteMachineRelay {
  relay ??= createRemoteMachineRelay({
    localConnectionId: LOCAL_CONNECTION_ID,
    getMachineClient: (id) =>
      id === LOCAL_CONNECTION_ID ? getLocalBackendClient() : getBackendClientForConnection(id),
    isOwnerConnection: async (id) =>
      id === LOCAL_CONNECTION_ID || (await resolveBackendRecord(id))?.kind === 'owner',
    logger: {
      info: (msg, meta) => logger.info(msg, meta),
      warn: (msg, meta) => logger.warn(msg, meta),
    },
  });
  return relay;
}

function currentBackend(event: Electron.IpcMainInvokeEvent): RemoteMachineBackend {
  const { backendId, client } = getBackendClientForIpcEvent(event);
  return {
    connectionId: backendId,
    client,
    supportsRemoteMachines: client.getNodeCapabilities()?.remoteMachines === 1,
  };
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * A node never opens a window, so nothing else keeps its pooled client up:
 * connect it before the relay needs it. A failure leaves the relay to report
 * `machine-not-connected`.
 */
async function ensureNodeClient(connectionId: string): Promise<void> {
  if (connectionId === LOCAL_CONNECTION_ID || getBackendClientForConnection(connectionId)) return;
  const saved = (await connectionsStore.list()).find((c) => c.id === connectionId);
  if (saved?.daemonMode !== 'node') return;
  try {
    await connectBackendClient(connectionId);
  } catch (error) {
    logger.warn('Could not connect the node to make it available', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Register the remote-machine IPC handlers (idempotent). */
export function registerRemoteMachinesHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(CHANNELS.EXPOSE, async (event, params: RemoteMachineExposeParams) => {
    if (!params || !text(params.machineConnectionId))
      return { success: false, code: 'failed', message: 'machineConnectionId is required' }; // i18n-ignore (IPC contract)
    const enableListener =
      params.enableListener === 'wss' || params.enableListener === 'tailcat'
        ? params.enableListener
        : undefined;
    await ensureNodeClient(params.machineConnectionId);
    return getRelay().expose(
      {
        machineConnectionId: params.machineConnectionId,
        ...(enableListener ? { enableListener } : {}),
      },
      currentBackend(event),
    );
  });

  ipcMain.handle(CHANNELS.UNEXPOSE, async (event, params: RemoteMachineUnexposeParams) => {
    if (!params || !text(params.machineId))
      return { success: false, code: 'failed', message: 'machineId is required' }; // i18n-ignore (IPC contract)
    return getRelay().unexpose(
      {
        machineId: params.machineId,
        ...(text(params.machineConnectionId)
          ? { machineConnectionId: params.machineConnectionId }
          : {}),
        ...(params.stopAgents === true ? { stopAgents: true } : {}),
      },
      currentBackend(event),
    );
  });

  ipcMain.handle(CHANNELS.INVITE_INSPECT, (_event, params: { uri?: unknown } | undefined) =>
    getNodeInvites().inspect(params?.uri),
  );

  ipcMain.handle(
    CHANNELS.INVITE_CLAIM,
    async (event, params: { pendingId?: unknown } | undefined) => {
      if (!text(params?.pendingId)) return { ok: false, code: 'expired' };
      let backend: RemoteMachineBackend;
      try {
        backend = currentBackend(event);
      } catch {
        getNodeInvites().discard(params.pendingId);
        return { ok: false, code: 'failed' };
      }
      return getNodeInvites().claim(params.pendingId, backend.client);
    },
  );

  ipcMain.handle(CHANNELS.INVITE_DISCARD, (_event, params: { pendingId?: unknown } | undefined) => {
    if (text(params?.pendingId)) getNodeInvites().discard(params.pendingId);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.MACHINE_FINGERPRINT, async (_event, connectionId: unknown) =>
    text(connectionId) ? getRelay().machineFingerprint(connectionId) : null,
  );
}
