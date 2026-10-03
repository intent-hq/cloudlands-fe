import { app, powerMonitor, Notification } from 'electron';
import { m } from '../../../shared/paraglide/messages.js';
import type { ConnectionStatus, JsonRpcClient } from '../../backend/main/json-rpc-client';
import { DesktopExecutor, type DesktopConnection } from './desktop-executor';
import {
  DesktopHelperTransport,
  DesktopNativeAdapter,
  desktopNativeAvailable,
} from './desktop-native';
import { desktopFailure } from './desktop-validation';
import { getDesktopOverlay } from './desktop-overlay';
import { DesktopReportStore } from './desktop-stop-reports';

let runtime: { executor: DesktopExecutor; reports: DesktopReportStore } | undefined;
function getRuntime() {
  if (!runtime) {
    const transport = new DesktopHelperTransport();
    const reports = new DesktopReportStore(undefined, () => {
      if (Notification.isSupported())
        new Notification({
          title: m.desktop_stopReportFailed_title(),
          body: m.desktop_stopReportFailed_description(),
        }).show();
    });
    const executor = new DesktopExecutor(
      new DesktopNativeAdapter(transport.request),
      getDesktopOverlay(),
      reports,
    );
    runtime = { executor, reports };
    const suspended = () => {
      void executor.invalidate('unsupported_environment').catch(() => {});
    };
    powerMonitor.on('suspend', suspended);
    powerMonitor.on('resume', suspended);
    powerMonitor.on('lock-screen', () => {
      void executor.invalidate('screen_locked').catch(() => {});
    });
    app.on('before-quit', () => {
      void executor.invalidate('disconnected', false).catch(() => {});
    });
  }
  return runtime;
}

/** Registered only on the pooled execution connection; no renderer IPC exposes
 * this executor or its credentials. Connection object identity prevents replay. */
export function registerDesktopExecReverseHandler(
  client: JsonRpcClient,
  backendId: string,
  supplied?: ReturnType<typeof getRuntime>,
): () => void {
  if (!supplied && !desktopNativeAvailable())
    return client.registerMethod('desktop.control', () => {
      throw desktopFailure(
        'desktop-unsupported',
        'Native desktop control is unavailable on this installation',
        'not_started',
      );
    });
  // Lazy runtime construction avoids OS initialization when importing backend IPC.
  let current: ReturnType<typeof getRuntime> | undefined = supplied;
  const connection: DesktopConnection = {
    backendId,
    saveAsset: (params) => client.request('note.saveAsset', params),
    revoke: (params) => client.request('desktop.revoke', params),
  };
  const sendReport = (
    params: Parameters<DesktopReportStore['connect']>[2] extends (p: infer P) => unknown
      ? P
      : never,
  ) => client.request('desktop.revoke', params);
  const registration = client.registerMethod('desktop.control', (params) => {
    current ??= getRuntime();
    if (client.getStatus() !== 'connected')
      throw new Error('Desktop execution connection is offline');
    return current.executor.handle(connection, params);
  });
  let generation = 0;
  const status = (state: ConnectionStatus) => {
    const observed = ++generation;
    if (state === 'connected') {
      current ??= getRuntime();
      void client
        .request<{ id: string }>('principal.me')
        .then((principal) => {
          if (generation === observed && typeof principal.id === 'string')
            current?.reports.connect(backendId, principal.id, sendReport);
        })
        .catch(() => {});
    } else {
      current?.executor.disconnect(connection);
      current?.reports.disconnect(backendId, sendReport);
    }
  };
  client.on('status', status);
  if (client.getStatus() === 'connected') status('connected');
  return () => {
    registration();
    client.removeListener('status', status);
    current?.executor.disconnect(connection);
    current?.reports.disconnect(backendId, sendReport);
  };
}
