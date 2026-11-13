/**
 * Every known provider gets a `<provider>:get-models` main-process handler
 * from the one setup call startup makes (`src/main/index.ts`). A provider
 * missing here has no models in the desktop model picker.
 */
import { describe, expect, it, vi } from 'vitest';

const handle = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getAppPath: vi.fn(() => '/tmp/app'),
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  ipcMain: { handle, removeHandler: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: vi.fn(),
  getBackendClientForIpcEvent: vi.fn(),
}));

import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';
import { setupProviderModelsIPC } from './provider-models.ipc';

describe('setupProviderModelsIPC', () => {
  setupProviderModelsIPC();
  const registered = handle.mock.calls.map(([channel]) => channel as string);

  it.each(Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID).filter((id) => id !== 'mock'))(
    'registers %s:get-models',
    (providerId) => {
      expect(registered).toContain(`${providerId}:get-models`);
    },
  );
});
