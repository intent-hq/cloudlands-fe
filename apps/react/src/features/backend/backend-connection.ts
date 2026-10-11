import { IPC_CHANNELS } from '$shared/ipc-registry';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { electronAPI } from '$lib/client/live/electron-ipc-transport';
import { getWebDaemonStatusSource } from '$lib/client/live/web-daemon-status';
import type { ConnectionStatusExtras } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import type { BackendTransportInfo } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-types';

export interface BackendConnectionStatus extends ConnectionStatusExtras {
  status: string;
  transport?: BackendTransportInfo;
}

/** Observe the selected real transport; never install a browser preload substitute. */
export function onBackendConnectionStatus(
  handler: (status: BackendConnectionStatus) => void,
): () => void {
  resolveBackendTransport();
  if (!isElectronPlatform()) {
    const source = getWebDaemonStatusSource();
    if (!source) {
      handler({ status: 'disconnected' });
      return () => {};
    }
    const report = (status: string) =>
      handler({ status, transport: { mode: 'external-ws', target: source.getTarget() } });
    const stop = source.onStatusChange(report);
    report(source.getStatus());
    return stop;
  }

  const bridge = electronAPI();
  if (!bridge) {
    handler({ status: 'disconnected' });
    return () => {};
  }
  let active = true;
  let pushed = false;
  const channel = IPC_CHANNELS.BACKEND.STATUS;
  const listenerId = bridge.on(channel, (status: BackendConnectionStatus) => {
    pushed = true;
    if (active) handler(status);
  });
  // Match the source daemon-status owner: a newer push wins over the boot snapshot.
  void bridge.invoke(IPC_CHANNELS.BACKEND.GET_STATUS).then(
    (snapshot: BackendConnectionStatus & { sidecarStartupFailedReason?: string }) => {
      if (active && !pushed) handler({ ...snapshot, reason: snapshot.sidecarStartupFailedReason });
    },
    () => {
      if (active && !pushed) handler({ status: 'disconnected' });
    },
  );
  return () => {
    active = false;
    bridge.offById(channel, listenerId);
  };
}
