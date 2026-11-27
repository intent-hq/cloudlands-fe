/**
 * Electron main for the Intent apps E2E (test/electron-intent-apps.spec.ts):
 * the real app host (`IntentAppHost`, scheme, preload, bridge, IPC guard) on a
 * real administrator connection to the daemon at `INTENTD_SOCKET`. Not the
 * whole Intent app: the spec drives the library through `globalThis.__intentAppsE2e`.
 *
 * With `INTENT_APPS_E2E_REMOTE` (JSON `{ host, port, token, fingerprint }`) a
 * second host serves a "remote" machine: a second daemon reached over pinned
 * WSS with its owner token, as a saved remote connection is
 * (`__intentAppsE2e.remote`).
 */
import { app, ipcMain, protocol } from 'electron';
import { createBackendSocket } from '../../../src/features/backend/main/backend-connection';
import { JsonRpcClient } from '../../../src/features/backend/main/json-rpc-client';
import {
  IntentAppHost,
  type AppHostMachine,
} from '../../../src/features/intent-apps/main/app-host';
import type { BackendConnectionConfig } from '../../../src/features/backend/main/backend-connection';
import { requestRouted } from '../../../src/features/backend/main/transfer-connections';
import { readAppPackage } from '../../../src/features/intent-apps/main/app-package';
import {
  discardAppPackage,
  installUploadedPackage,
  uploadAppPackage,
  type PackageRequest,
} from '../../../src/features/intent-apps/main/app-package-install';
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
    const machine = (
      config: BackendConnectionConfig,
      identity?: AppHostMachine,
      backendId = 'local',
    ) => {
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
        identity,
      );
      host.registerIpc();
      // The package path of main (intent-apps.ipc.ts): chunks of a remote
      // machine ride a transfer connection, the rest the administrator connection.
      const packageRequest: PackageRequest = <T>(method: string, params: Record<string, unknown>) =>
        requestRouted<T>(client, method, params, { timeoutMs: 120_000 }, backendId);
      return {
        uploadPackage: async (path: string) =>
          uploadAppPackage(packageRequest, await readAppPackage(path)),
        installPackage: (uploadId: string, options: { replace?: boolean; dryRun?: boolean }) =>
          installUploadedPackage(packageRequest, uploadId, options),
        discardPackage: (uploadId: string) => discardAppPackage(packageRequest, uploadId),
        request: (method: string, params?: unknown, timeoutMs?: number) =>
          client.request(method, params, timeoutMs ? { timeoutMs } : undefined),
        hello: () => client.readHelloSnapshot(),
        open: (appId: string) => host.openApp(appId),
        openAppIds: () => host.openAppIds(),
      };
    };
    const local = machine({ transport: 'uds' as const, socketPath });
    const remoteSpec = process.env.INTENT_APPS_E2E_REMOTE;
    const remote = remoteSpec
      ? machine(
          { transport: 'wss', tls: true, ...JSON.parse(remoteSpec) },
          { key: 'e2e-remote', label: () => 'E2E remote' },
          'e2e-remote',
        )
      : null;
    (globalThis as Record<string, unknown>).__intentAppsE2e = { ...local, remote };
    console.log('intent-apps-e2e: main ready');
  })
  .catch((error: unknown) => {
    console.error('intent-apps-e2e: main setup failed', error);
  });
