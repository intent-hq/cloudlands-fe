import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

type ModelHandler = (event: IpcMainInvokeEvent, params?: { forceRefresh?: boolean }) => unknown;

const mocks = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: ModelHandler) => void>(),
  request: vi.fn(),
  getBackend: vi.fn(),
}));

// Keep the renderer client, both IPC routes, and wire mapping real. Only the
// Electron boundary and daemon transport are fake; no UI is exercised here.
vi.unmock('$lib/electron-bridge');
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClientForIpcEvent: mocks.getBackend,
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectProviderDisplayName: { select: () => 'Google Antigravity' },
}));

import { getProviderModels } from './provider-models.client';
import { setupAntigravityIPC } from '../antigravity/main/antigravity.ipc';

const event = { sender: { id: 730 } } as IpcMainInvokeEvent;
const wireModel = {
  id: 'gemini-3.7-flash-high',
  name: 'Flash High',
  provider: 'antigravity',
  isDefault: true,
};
const model = { value: wireModel.id, label: wireModel.name, isDefault: true };

beforeAll(async () => {
  await import('$store/renderer/seeders/model-catalog-bridge-seeder');
});

describe.each(['Electron', 'web'])('Antigravity provider model client via %s', (transport) => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getBackend.mockReturnValue({ client: { request: mocks.request } });
    setupAntigravityIPC();
    vi.stubGlobal(
      'window',
      transport === 'web'
        ? {}
        : {
            electronAPI: {
              invoke: async (channel: string, params?: { forceRefresh?: boolean }) => {
                const registration = mocks.handle.mock.calls.find(([name]) => name === channel);
                if (!registration) throw new Error(`No Electron handler: ${channel}`);
                return registration[1](event, params);
              },
            },
          },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('loads Antigravity models with forceRefresh=%s', async (forceRefresh) => {
    mocks.request.mockResolvedValue({ providerId: 'antigravity', models: [wireModel] });

    await expect(getProviderModels('antigravity', { forceRefresh })).resolves.toEqual({
      models: [model],
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('models.list', {
      providerId: 'antigravity',
      ...(forceRefresh ? { forceRefresh: true } : {}),
    });
    if (transport === 'Electron') expect(mocks.getBackend).toHaveBeenCalledWith(event);
  });

  it('preserves a stale catalog and its warning', async () => {
    mocks.request.mockResolvedValue({
      models: [wireModel],
      warning: 'Using the saved catalog',
      stale: true,
    });
    await expect(getProviderModels('antigravity')).resolves.toEqual({
      models: [model],
      warning: 'Using the saved catalog',
      stale: true,
    });
  });

  it('preserves an empty catalog warning without inventing models', async () => {
    mocks.request.mockResolvedValue({ models: [], warning: 'Sign in required' });
    await expect(getProviderModels('antigravity')).resolves.toEqual({
      models: [],
      warning: 'Sign in required',
    });
  });

  it('reports daemon transport failure with the provider name', async () => {
    mocks.request.mockRejectedValue(new Error('catalog unavailable'));
    await expect(getProviderModels('antigravity')).rejects.toThrow(
      'Google Antigravity: catalog unavailable',
    );
  });

  it('rejects unknown providers without invoking a transport', async () => {
    await expect(getProviderModels('not-a-provider')).rejects.toThrow(
      'not-a-provider: Unsupported model provider: not-a-provider',
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });

  if (transport === 'Electron') {
    it('fails closed when the invoking window has no live backend', async () => {
      mocks.getBackend.mockImplementation(() => {
        throw new Error('window backend unavailable');
      });
      await expect(getProviderModels('antigravity')).rejects.toThrow('window backend unavailable');
      expect(mocks.getBackend).toHaveBeenCalledWith(event);
      expect(mocks.request).not.toHaveBeenCalled();
    });
  }
});
