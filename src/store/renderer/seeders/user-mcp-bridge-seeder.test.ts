import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import * as m from '$shared/paraglide/messages.js';
import { registerUserMcpBridge } from './user-mcp-bridge-seeder';

const payload = { serverId: 'srv-figma', url: 'https://mcp.figma.com/mcp' };
const originalElectronAPI = window.electronAPI;

describe('user-mcp-bridge-seeder', () => {
  beforeEach(() => resetMockIpcRouter());

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards interactive authentication to the Electron preload bridge', async () => {
    const response = { success: true, data: { success: true } };
    const invoke = vi.fn().mockResolvedValue(response);
    window.electronAPI = {
      versions: { electron: '35.0.0' },
      invoke,
    } as typeof window.electronAPI;
    registerUserMcpBridge();

    await expect(mockInvoke('user-mcp:authenticate', payload)).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('user-mcp:authenticate', payload);
  });

  it('returns a shaped failure without a native Electron bridge', async () => {
    const invoke = vi.fn();
    window.electronAPI = {
      versions: { electron: '0.0.0-browser' },
      invoke,
    } as typeof window.electronAPI;
    registerUserMcpBridge();

    await expect(mockInvoke('user-mcp:authenticate', payload)).resolves.toEqual({
      success: false,
      error: m.mcp_management_authFailed_error(),
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
