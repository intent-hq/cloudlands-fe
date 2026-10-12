import { expectsElectronPreloadBridge, isElectronPlatform } from '$lib/utils/platform-capabilities';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { getWebDaemonStatusSource } from '$lib/client/live/web-daemon-status';

/** Configuration is fixed before browser startup; resolving does not open the socket. */
export function hasBackendRuntimeTarget(): boolean {
  resolveBackendTransport();
  // A configured WebSocket starts disconnected and connects on its first request.
  // Preserve errors for an Electron renderer missing its expected preload.
  return (
    isElectronPlatform() || expectsElectronPreloadBridge() || getWebDaemonStatusSource() !== null
  );
}
