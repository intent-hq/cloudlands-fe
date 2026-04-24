import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, BrowserWindow } from 'electron';
import { NotificationService } from './notification.service';
// workspace-event-bus was deleted; notifications are now driven by Redux sagas
import { getWindowIdsForWorkspace } from '../../system/main/system.ipc';

vi.mock('../../../shared/logger', () => ({
  Logger: class {
     
    constructor(_category?: string) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('electron-store', () => ({
  default: class {
     
    constructor(_options?: unknown) {}
    get = vi.fn(() => ({ enabled: true, showWhenFocused: false }));
  },
}));

const { mockNotificationIsSupported, mockNotificationInstances, mockShowShouldThrow } = vi.hoisted(() => ({
  mockNotificationIsSupported: { value: false },
  mockNotificationInstances: [] as Array<{ handlers: Record<string, Function>; show: ReturnType<typeof vi.fn> }>,
  mockShowShouldThrow: { value: false },
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    show: vi.fn(),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp/test'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    isReady: vi.fn(() => true),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(() => null),
  },
  Notification: class {
    static isSupported() {
      return mockNotificationIsSupported.value;
    }

    handlers: Record<string, Function> = {};
    show = vi.fn(() => {
      if (mockShowShouldThrow.value) {
        throw new Error('show failed');
      }
    });

     
    constructor(_opts?: unknown) {
      mockNotificationInstances.push(this as any);
    }

    on(event: string, handler: Function) {
      this.handlers[event] = handler;
    }
  },
}));

vi.mock('../../agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn(() => ({
      getActiveStreams: vi.fn(() => []),
    })),
  },
}));

// workspace-event-bus mock removed — module was deleted

vi.mock('../../system/main/system.ipc', () => ({
  getWindowIdsForWorkspace: vi.fn(() => []),
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('../../workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(() => Promise.resolve({ ok: true, data: { title: 'Test Workspace' } })),
  },
}));

describe('NotificationService start lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('start() is a no-op (saga-driven)', () => {
    const service = new NotificationService('workspace-1');
    // start() should not throw; it's a no-op now (events delivered via Redux sagas)
    expect(() => service.start()).not.toThrow();
  });

  it('stop() is a no-op (saga-driven)', () => {
    const service = new NotificationService('workspace-1');
    service.start();
    // stop() should not throw; it's a no-op now
    expect(() => service.stop()).not.toThrow();
  });
});

describe('NotificationService showNotification click behavior', () => {
  let mockWebContentsSend: ReturnType<typeof vi.fn>;
  let mockFocus: ReturnType<typeof vi.fn>;
  let mockRestore: ReturnType<typeof vi.fn>;
  let mockIsMinimized: ReturnType<typeof vi.fn>;

  let mockShow: ReturnType<typeof vi.fn>;

  function createMockWindow(isMinimized = false) {
    mockWebContentsSend = vi.fn();
    mockFocus = vi.fn();
    mockRestore = vi.fn();
    mockIsMinimized = vi.fn(() => isMinimized);
    mockShow = vi.fn();

    return {
      id: 1,
      webContents: { send: mockWebContentsSend, isDestroyed: () => false },
      focus: mockFocus,
      show: mockShow,
      restore: mockRestore,
      isMinimized: mockIsMinimized,
      isFocused: () => false,
      isDestroyed: () => false,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
  });

  /**
   * Helper: call the private showNotification method directly,
   * then trigger the click handler on the created Notification.
   */
  function triggerNotificationClick(workspaceId: string, mockWindow: any) {
    const service = new NotificationService(workspaceId);
    // Access private method via bracket notation
    (service as any).showNotification(
      { title: 'Test', body: 'Test notification' },
      mockWindow,
      workspaceId,
    );

    // Get the created notification instance and trigger click
    expect(mockNotificationInstances.length).toBeGreaterThan(0);
    const notification = mockNotificationInstances[mockNotificationInstances.length - 1];
    expect(notification.handlers['click']).toBeDefined();
    notification.handlers['click']();
  }

  it('sends notification:navigate IPC on click with correct workspaceId', () => {
    const mockWindow = createMockWindow(false);
    triggerNotificationClick('workspace-1', mockWindow);

    expect(mockWebContentsSend).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
    expect(mockFocus).toHaveBeenCalled();
  });

  it('restores minimized window on click', () => {
    const mockWindow = createMockWindow(true);
    triggerNotificationClick('workspace-1', mockWindow);

    expect(mockRestore).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
    // restore should be called before focus
    const restoreOrder = mockRestore.mock.invocationCallOrder[0];
    const focusOrder = mockFocus.mock.invocationCallOrder[0];
    expect(restoreOrder).toBeLessThan(focusOrder);
  });

  it('does not send notification:navigate when no workspaceId', () => {
    const mockWindow = createMockWindow(false);

    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([mockWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation((id: number) =>
      id === mockWindow.id ? mockWindow : null,
    );
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow]);

    // Use showTestNotification which calls showNotification without workspaceId
    const service = new NotificationService('workspace-1');
    service.showTestNotification();

    expect(mockNotificationInstances.length).toBeGreaterThan(0);
    const notification = mockNotificationInstances[mockNotificationInstances.length - 1];
    notification.handlers['click']();

    expect(mockWebContentsSend).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
  });

  it('does nothing when mainWindow is destroyed', () => {
    const mockWindow = createMockWindow(false);
    // Override isDestroyed to return true
    mockWindow.isDestroyed = () => true;

    triggerNotificationClick('workspace-1', mockWindow);

    expect(mockFocus).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockWebContentsSend).not.toHaveBeenCalled();
  });

  it('does not send IPC when webContents is destroyed', () => {
    const mockWindow = createMockWindow(false);
    // Override webContents.isDestroyed to return true
    mockWindow.webContents.isDestroyed = () => true;

    triggerNotificationClick('workspace-1', mockWindow);

    expect(mockFocus).toHaveBeenCalled();
    expect(mockWebContentsSend).not.toHaveBeenCalled();
  });

  it('stores notification in activeNotifications set and removes after click', () => {
    const mockWindow = createMockWindow(false);
    const service = new NotificationService('workspace-1');

    (service as any).showNotification(
      { title: 'Test', body: 'Test notification' },
      mockWindow,
      'workspace-1',
    );

    // Notification should be stored in the set
    expect((service as any).activeNotifications.size).toBe(1);

    // Trigger click
    const notification = mockNotificationInstances[mockNotificationInstances.length - 1];
    notification.handlers['click']();

    // Notification should be removed from the set
    expect((service as any).activeNotifications.size).toBe(0);
  });

  it('removes notification from activeNotifications set after close', () => {
    const mockWindow = createMockWindow(false);
    const service = new NotificationService('workspace-1');

    (service as any).showNotification(
      { title: 'Test', body: 'Test notification' },
      mockWindow,
      'workspace-1',
    );

    expect((service as any).activeNotifications.size).toBe(1);

    // Trigger close
    const notification = mockNotificationInstances[mockNotificationInstances.length - 1];
    notification.handlers['close']();

    expect((service as any).activeNotifications.size).toBe(0);
  });

  it('removes notification from activeNotifications set after failed event', () => {
    const mockWindow = createMockWindow(false);
    const service = new NotificationService('workspace-1');

    (service as any).showNotification(
      { title: 'Test', body: 'Test notification' },
      mockWindow,
      'workspace-1',
    );

    expect((service as any).activeNotifications.size).toBe(1);

    const notification = mockNotificationInstances[mockNotificationInstances.length - 1];
    notification.handlers['failed']({}, 'some error');

    expect((service as any).activeNotifications.size).toBe(0);
  });

  it('removes notification from activeNotifications set when show() throws', () => {
    const mockWindow = createMockWindow(false);
    const service = new NotificationService('workspace-1');

    mockShowShouldThrow.value = true;
    try {
      (service as any).showNotification(
        { title: 'Test', body: 'Test notification' },
        mockWindow,
        'workspace-1',
      );
    } finally {
      mockShowShouldThrow.value = false;
    }

    // Notification should have been removed from the set after show() threw
    expect((service as any).activeNotifications.size).toBe(0);
  });

  it('calls mainWindow.show() before mainWindow.focus() on click', () => {
    const mockWindow = createMockWindow(false);
    triggerNotificationClick('workspace-1', mockWindow);

    expect(mockShow).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();

    // show should be called before focus
    const showOrder = mockShow.mock.invocationCallOrder[0];
    const focusOrder = mockFocus.mock.invocationCallOrder[0];
    expect(showOrder).toBeLessThan(focusOrder);
  });

  it('calls app.show() on macOS when notification is clicked', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    try {
      const mockWindow = createMockWindow(false);
      triggerNotificationClick('workspace-1', mockWindow);

      expect(app.show).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('does not call app.show() on non-macOS platforms', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const mockWindow = createMockWindow(false);
      triggerNotificationClick('workspace-1', mockWindow);

      expect(app.show).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
