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
import {
  getBackendClientForConnection,
  getBackendClientForIpcEvent,
  getLocalBackendClient,
  resolveBackendRecord,
} from './backend.ipc';
import {
  createRemoteMachineRelay,
  type RemoteMachineBackend,
  type RemoteMachineRelay,
} from './remote-machine-relay';

const logger = new Logger('RemoteMachinesIPC');
const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;

let handlersRegistered = false;
let relay: RemoteMachineRelay | null = null;

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

  ipcMain.handle(CHANNELS.MACHINE_FINGERPRINT, async (_event, connectionId: unknown) =>
    text(connectionId) ? getRelay().machineFingerprint(connectionId) : null,
  );
}
