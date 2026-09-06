import { BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { ANTIGRAVITY_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { getBackendClientForIpcEvent } from '../../backend/main/backend.ipc';
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';
import type { AntigravitySetupResult } from '../../../shared/types/antigravity-setup';
import { AntigravitySetupSession } from './setup-session';

const setupRequest = z.object({
  action: z.enum(['status', 'start', 'login', 'cancel']),
  operationId: z.string().max(100).optional(),
});
const sessions = new Map<WebContents, AntigravitySetupSession>();
const boundSenders = new WeakSet<WebContents>();

function closeSetup(sender: WebContents, expected?: AntigravitySetupSession): void {
  if (expected && sessions.get(sender) !== expected) return;
  sessions.get(sender)?.dispose();
  sessions.delete(sender);
}

export function setupAntigravityIPC() {
  ipcMain.handle(
    ANTIGRAVITY_CHANNELS.GET_MODELS,
    async (event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('antigravity', params, event),
  );
  ipcMain.handle(ANTIGRAVITY_CHANNELS.CLOSE_SETUP, (event) => {
    if (event.senderFrame === event.sender.mainFrame) closeSetup(event.sender);
  });
  ipcMain.handle(
    ANTIGRAVITY_CHANNELS.SETUP,
    async (event, payload: unknown): Promise<AntigravitySetupResult> => {
      const parsed = setupRequest.safeParse(payload);
      if (
        !parsed.success ||
        event.sender.isDestroyed() ||
        event.senderFrame !== event.sender.mainFrame ||
        !BrowserWindow.fromWebContents(event.sender)
      ) {
        return { ok: false, code: 'invalidOperation' };
      }
      let requestedSession: AntigravitySetupSession | undefined;
      try {
        const { backendId, client } = getBackendClientForIpcEvent(event);
        const config = client.getConfig();
        if (backendId !== LOCAL_CONNECTION_ID || config.transport !== 'uds') {
          closeSetup(event.sender);
          return { ok: false, code: 'remoteHost' };
        }
        if (process.platform !== 'darwin' || process.arch !== 'arm64') {
          return { ok: false, code: 'unsupportedHost' };
        }
        let session = sessions.get(event.sender);
        if (!session) {
          session = new AntigravitySetupSession(
            config,
            () => {
              if (event.sender.isDestroyed()) return false;
              try {
                const current = getBackendClientForIpcEvent(event);
                return current.backendId === backendId && current.client === client;
              } catch {
                return false;
              }
            },
            (url) => shell.openExternal(url),
          );
          sessions.set(event.sender, session);
          if (!boundSenders.has(event.sender)) {
            boundSenders.add(event.sender);
            event.sender.once('destroyed', () => closeSetup(event.sender));
          }
        }
        requestedSession = session;
        const result = await session.request(parsed.data.action, parsed.data.operationId);
        if (!result.ok && ['connectionLost', 'backendChanged'].includes(result.code)) {
          closeSetup(event.sender, session);
        }
        return result;
      } catch {
        closeSetup(event.sender, requestedSession);
        return { ok: false, code: 'connectionLost' };
      }
    },
  );
}
