import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import type { HardwareConsoleStatus } from '$features/hardware-console/device/device-manager';
import { UNASSIGNED_KEY_PIN } from '$features/hardware-console/assignment/key-assignment';
import { store } from '$store/renderer/store';
import { hydrateHardwareConsoleKeyPins } from '$store/renderer/slices/hardware-console/hardware-console-slice';

declare global {
  interface Window {
    __homeMicroPreview?: { setConnected: (connected: boolean) => void };
  }
}

/** UI-only manager fixture: no device is opened and no assignment persistence saga runs. */
export function setupHomeMicroPreview(connected: boolean) {
  const manager = getHardwareConsoleManager();
  const originalStatus = Object.getOwnPropertyDescriptor(manager, 'status');
  const originalSubscribe = manager.onStatusChange;
  const previous = store.state.hardwareConsole;
  const listeners = new Set<(status: HardwareConsoleStatus) => void>();
  let status: HardwareConsoleStatus = connected ? 'connected' : 'disconnected';
  Object.defineProperty(manager, 'status', { configurable: true, get: () => status });
  manager.onStatusChange = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const setConnected = (value: boolean) => {
    status = value ? 'connected' : 'disconnected';
    listeners.forEach((listener) => listener(status));
  };
  const api = { setConnected };
  window.__homeMicroPreview = api;
  store.dispatch(
    hydrateHardwareConsoleKeyPins(
      [
        'home-review',
        'home-running',
        UNASSIGNED_KEY_PIN,
        'home-ready',
        'home-waiting',
        'home-complete',
      ],
      ['home-unread'],
    ),
  );
  return {
    setConnected,
    dispose: () => {
      manager.onStatusChange = originalSubscribe;
      if (originalStatus) Object.defineProperty(manager, 'status', originalStatus);
      else Reflect.deleteProperty(manager, 'status');
      listeners.forEach((listener) => listener(manager.status));
      listeners.clear();
      store.dispatch(
        hydrateHardwareConsoleKeyPins(previous.keyPins, previous.excludedWorkspaceIds),
      );
      if (window.__homeMicroPreview === api) delete window.__homeMicroPreview;
    },
  };
}
