/**
 * Tests for the notification invoke bridge seeder: on web the settings-page
 * `notification:test` / `notification:requestPermission` invokes route to the
 * web notification service; on Electron they forward verbatim to the preload
 * bridge; bridge-less non-web builds fold to a shaped failure. Envelope
 * shapes ({ success, error? } / { success, granted?, error? }) match the
 * Electron ipcMain handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPlatform, mockShowTest, mockRequestPermission } = vi.hoisted(() => ({
  mockGetPlatform: vi.fn(() => 'web'),
  mockShowTest: vi.fn(async () => ({ success: true })),
  mockRequestPermission: vi.fn(async () => ({ success: true, granted: true })),
}));

vi.mock('$lib/utils/platform-capabilities', () => ({
  getPlatform: mockGetPlatform,
}));

vi.mock('$features/notifications/web-notification-service', () => ({
  showTestWebNotification: mockShowTest,
  requestWebNotificationPermission: mockRequestPermission,
}));

import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { registerNotificationBridge } from './notification-bridge-seeder';

const originalElectronAPI = (window as any).electronAPI;

describe('notification-bridge-seeder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockIpcRouter();
    mockGetPlatform.mockReturnValue('web');
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('routes notification:test to the web service on web', async () => {
    registerNotificationBridge();

    const result = await mockInvoke(IPC_CHANNELS.NOTIFICATION.TEST);

    expect(mockShowTest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('routes notification:requestPermission to the web service on web', async () => {
    mockRequestPermission.mockResolvedValueOnce({ success: true, granted: false });
    registerNotificationBridge();

    const result = await mockInvoke(IPC_CHANNELS.NOTIFICATION.REQUEST_PERMISSION);

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, granted: false });
  });

  it('forwards both channels verbatim to window.electronAPI.invoke on electron', async () => {
    mockGetPlatform.mockReturnValue('electron');
    const invokeSpy = vi.fn(async (channel: string) => ({ success: true, forwarded: channel }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerNotificationBridge();

    const testResult = await mockInvoke<{ forwarded: string }>(IPC_CHANNELS.NOTIFICATION.TEST);
    const permResult = await mockInvoke<{ forwarded: string }>(
      IPC_CHANNELS.NOTIFICATION.REQUEST_PERMISSION,
    );

    expect(testResult.forwarded).toBe(IPC_CHANNELS.NOTIFICATION.TEST);
    expect(permResult.forwarded).toBe(IPC_CHANNELS.NOTIFICATION.REQUEST_PERMISSION);
    expect(mockShowTest).not.toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('folds to the shaped not-available failure when non-web and bridge-less', async () => {
    mockGetPlatform.mockReturnValue('electron');
    (window as any).electronAPI = undefined;
    registerNotificationBridge();

    const result = await mockInvoke<{ success: boolean; error?: string }>(
      IPC_CHANNELS.NOTIFICATION.TEST,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Notifications are not available in this build');
  });
});
