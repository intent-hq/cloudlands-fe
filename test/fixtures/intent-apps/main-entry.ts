/**
 * Electron main for the Intent apps E2E (test/electron-intent-apps.spec.ts):
 * the real app host (`IntentAppHost`, scheme, preload, bridge, IPC guard) on a
 * real administrator connection to the daemon at `INTENTD_SOCKET`. Not the
 * whole Intent app: the spec drives the library through `globalThis.__intentAppsE2e`.
 */
import { app, ipcMain, protocol } from 'electron';
import { createBackendSocket } from '../../../src/features/backend/main/backend-connection';
import { JsonRpcClient } from '../../../src/features/backend/main/json-rpc-client';
import { IntentAppHost } from '../../../src/features/intent-apps/main/app-host';
import { installIpcHandleAuthorization } from '../../../src/main/ipc-authorization';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'intent-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

// Headless hosts (xvfb) have no GPU.
app.disableHardwareAcceleration();
if (process.env.INTENT_APPS_E2E_PROFILE)
  app.setPath('userData', process.env.INTENT_APPS_E2E_PROFILE);

const socketPath = process.env.INTENTD_SOCKET;
const preloadPath = process.env.INTENT_APP_PRELOAD;
if (!socketPath || !preloadPath)
  throw new Error('INTENTD_SOCKET and INTENT_APP_PRELOAD are required');

app.on('window-all-closed', () => {
  // The spec closes the app itself.
});

void app
  .whenReady()
  .then(() => {
  installIpcHandleAuthorization(ipcMain);
  const config = { transport: 'uds' as const, socketPath };
  const client = new JsonRpcClient({
    config,
    helloParams: () => ({ clientName: 'intent-apps-e2e', clientVersion: '0.0.0' }),
  });
  client.start();
  const host = new IntentAppHost(
    {
      request: (method, params, timeoutMs) =>
        client.request(method, params, timeoutMs ? { timeoutMs } : undefined),
      ready: async () => {
        await client.readHelloSnapshot();
      },
      createSocket: () => createBackendSocket(config),
    },
    () => {},
    preloadPath,
  );
  host.registerIpc();
  (globalThis as Record<string, unknown>).__intentAppsE2e = {
    request: (method: string, params?: unknown, timeoutMs?: number) =>
      client.request(method, params, timeoutMs ? { timeoutMs } : undefined),
    hello: () => client.readHelloSnapshot(),
    open: (appId: string) => host.openApp(appId),
    openAppIds: () => host.openAppIds(),
  };
    console.log('intent-apps-e2e: main ready');
  })
  .catch((error: unknown) => {
    console.error('intent-apps-e2e: main setup failed', error);
  });
