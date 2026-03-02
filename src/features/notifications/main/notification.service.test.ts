import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { NotificationService } from './notification.service';
import { getWorkspaceEventBus } from '../../events/main/workspace-event-bus';
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

const { mockNotificationIsSupported, mockNotificationInstances } = vi.hoisted(() => ({
  mockNotificationIsSupported: { value: false },
  mockNotificationInstances: [] as Array<{ handlers: Record<string, Function>; show: ReturnType<typeof vi.fn> }>,
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
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
    show = vi.fn();

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

vi.mock('../../events/main/workspace-event-bus', () => ({
  getWorkspaceEventBus: vi.fn(),
}));

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

  it('unsubscribes previous listener before resubscribing on repeated start()', () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();

    const subscribe = vi
      .fn()
      .mockReturnValueOnce({ unsubscribe: unsubscribeFirst })
      .mockReturnValueOnce({ unsubscribe: unsubscribeSecond });

    vi.mocked(getWorkspaceEventBus).mockReturnValue({ subscribe } as any);

    const service = new NotificationService('workspace-1');

    service.start();
    service.start();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(unsubscribeSecond).not.toHaveBeenCalled();
  });

  it('keeps only latest subscription active after repeated start()', () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();

    const subscribe = vi
      .fn()
      .mockReturnValueOnce({ unsubscribe: unsubscribeFirst })
      .mockReturnValueOnce({ unsubscribe: unsubscribeSecond });

    vi.mocked(getWorkspaceEventBus).mockReturnValue({ subscribe } as any);

    const service = new NotificationService('workspace-1');

    service.start();
    service.start();
    service.stop();

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationService showNotification click behavior', () => {
  let mockWebContentsSend: ReturnType<typeof vi.fn>;
  let mockFocus: ReturnType<typeof vi.fn>;
  let mockRestore: ReturnType<typeof vi.fn>;
  let mockIsMinimized: ReturnType<typeof vi.fn>;

  function createMockWindow(isMinimized = false) {
    mockWebContentsSend = vi.fn();
    mockFocus = vi.fn();
    mockRestore = vi.fn();
    mockIsMinimized = vi.fn(() => isMinimized);

    return {
      id: 1,
      webContents: { send: mockWebContentsSend, isDestroyed: () => false },
      focus: mockFocus,
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

    const subscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
    vi.mocked(getWorkspaceEventBus).mockReturnValue({ subscribe } as any);

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
});
