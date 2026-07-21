/**
 * Tests for the Pi IPC handlers.
 *
 * GET_MODELS is a thin call to the daemon's per-provider catalog
 * (`models.list { providerId: 'pi' }`, PROTOCOL §6.7); these tests assert the
 * wire request shape and the envelope mapping (data / warning / stale /
 * success:false on transport failure).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBackendRequest } = vi.hoisted(() => ({
  mockBackendRequest: vi.fn(),
}));

vi.mock('../pi-resolver', () => ({
  installPiMcpAdapter: vi.fn(),
  isPiMcpAdapterInstalled: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockBackendRequest }),
}));

// Capture the handler registered via ipcMain.handle so we can invoke it directly.
const registeredHandlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import {
  installPiMcpAdapter,
  isPiMcpAdapterInstalled,
} from '../pi-resolver';
import { PI_CHANNELS } from '../../../../shared/ipc/channels';
import { setupPiIPC } from '../pi.ipc';

describe('Pi GET_MODELS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackendRequest.mockReset();
    registeredHandlers.clear();
  });

  function getHandler() {
    setupPiIPC();
    const handler = registeredHandlers.get(PI_CHANNELS.GET_MODELS);
    expect(handler).toBeDefined();
    return handler!;
  }

  it('maps the daemon models.list rows into the success envelope', async () => {
    mockBackendRequest.mockResolvedValue({
      providerId: 'pi',
      models: [{ id: 'default', name: 'Default (Pi)', description: 'Use Pi default model' }],
      source: 'pi',
    });

    const response = await getHandler()({});

    expect(mockBackendRequest).toHaveBeenCalledWith('models.list', { providerId: 'pi' });
    expect(response).toEqual({
      success: true,
      data: [{ value: 'default', label: 'Default (Pi)', description: 'Use Pi default model' }],
    });
  });

  it('forwards forceRefresh and surfaces daemon warning/stale labeling', async () => {
    mockBackendRequest.mockResolvedValue({
      providerId: 'pi',
      models: [{ id: 'default', name: 'Default (Pi)' }],
      stale: true,
      warning: 'Pi probe failed; serving last-known model list',
    });

    const response = await getHandler()({}, { forceRefresh: true });

    expect(mockBackendRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'pi',
      forceRefresh: true,
    });
    expect(response.success).toBe(true);
    expect(response.stale).toBe(true);
    expect(response.warning).toBe('Pi probe failed; serving last-known model list');
  });

  it('surfaces wire/transport failure via { success: false, error }', async () => {
    mockBackendRequest.mockRejectedValue(new Error('daemon unreachable'));

    const response = await getHandler()({});

    expect(response.success).toBe(false);
    expect(response.error).toBe('daemon unreachable');
    expect(response.data).toBeUndefined();
  });
});

describe('Pi MCP adapter handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.clear();
  });

  it('returns adapter installation status from CHECK_MCP_ADAPTER', async () => {
    vi.mocked(isPiMcpAdapterInstalled).mockResolvedValue(true);

    setupPiIPC();
    const handler = registeredHandlers.get(PI_CHANNELS.CHECK_MCP_ADAPTER);
    expect(handler).toBeDefined();

    await expect(handler!({})).resolves.toBe(true);
  });

  it('returns install result from INSTALL_MCP_ADAPTER', async () => {
    const installResult = { success: true };
    vi.mocked(installPiMcpAdapter).mockResolvedValue(installResult);

    setupPiIPC();
    const handler = registeredHandlers.get(PI_CHANNELS.INSTALL_MCP_ADAPTER);
    expect(handler).toBeDefined();

    await expect(handler!({})).resolves.toEqual(installResult);
  });
});
