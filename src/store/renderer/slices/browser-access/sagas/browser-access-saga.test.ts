/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '$store/renderer/store';
import {
  setLabsBrowserAccessEnabled,
  userPreferencesHydrated,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { enforceBrowserAccessLabsGate } from './browser-access-saga';

const ON = {
  available: true,
  enabled: true,
  port: 47120,
  running: true,
  error: null,
  accessKey: 'k'.repeat(43),
};

const originalApi = window.electronAPI;
let invoke: ReturnType<typeof vi.fn>;
let stopStore: () => void;

beforeEach(() => {
  invoke = vi.fn(async (channel: string) =>
    channel === 'browser-access:set-enabled' ? { ...ON, enabled: false, running: false } : ON,
  );
  window.electronAPI = { ...originalApi, invoke } as never;
  stopStore = store.init();
});

afterEach(() => {
  stopStore();
  window.electronAPI = originalApi;
});

describe('enforceBrowserAccessLabsGate', () => {
  it('turns off a server left running while the Labs flag is off', async () => {
    const { browserAccessSaga } = await import('./browser-access-saga');
    const stop = store.runSaga(browserAccessSaga);
    store.dispatch(setLabsBrowserAccessEnabled(false));
    store.dispatch(userPreferencesHydrated());
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('browser-access:set-enabled', { enabled: false }),
    );
    stop();
  });

  it('leaves the server alone while the Labs flag is on', async () => {
    store.dispatch(setLabsBrowserAccessEnabled(true));
    store.dispatch(userPreferencesHydrated());
    const stop = store.runSaga(enforceBrowserAccessLabsGate);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalled();
    stop();
  });
});
