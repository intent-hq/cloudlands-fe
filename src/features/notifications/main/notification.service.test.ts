import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  app,
  BrowserWindow,
} from 'electron';
import { NotificationService, __resetNotificationCacheForTesting } from './notification.service';
// workspace-event-bus was deleted; notifications are now driven by Redux sagas
import { getWindowIdsForWorkspace, sendToWorkspaceWindows } from '../../system/main/system.ipc';
import type { AgentIdleEvent } from '../../events/types';

vi.mock('../../../shared/logger', () => ({
  Logger: class {

    constructor(_category?: string) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Method-aware daemon-client stub: routes `settings.get` to a configurable
// per-path `notifications.*` fixture, `agent.list` to a configurable
// PROTOCOL.md §5.5-shaped AgentLite[] fixture (defaults to empty), and
// `events.subscribe` / `events.unsubscribe` to §6.1/§6.2-shaped responses.
// `clientOn` captures the `notification` listener the service attaches so
// tests can push PROTOCOL.md §6.3-shaped `events.event` notifications.
const {
  requestMock,
  agentListResponse,
  settingsValues,
  clientOn,
  clientOff,
  notificationListeners,
  reconnectHandlers,
} = vi.hoisted(() => {
  const agentListResponse: {
    agents: Array<{
      id?: string;
      isStreaming?: boolean;
      isResponding?: boolean;
      metadata?: { isBackground?: boolean; specialist?: string };
    }>;
  } = { agents: [] };
  const settingsValues: Record<string, unknown> = {};
  const requestMock = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'settings.get') {
      const path = (params as { path?: string } | undefined)?.path ?? '';
      return { path, value: settingsValues[path] ?? true };
    }
    if (method === 'agent.list') {
      return agentListResponse;
    }
    if (method === 'events.subscribe') {
      return { subscriptionId: 'ws-sub-1' };
    }
    if (method === 'events.unsubscribe') {
      return { success: true };
    }
    return {};
  });
  const notificationListeners: Array<(n: { method: string; params?: unknown }) => void> = [];
  const reconnectHandlers: Array<() => void> = [];
  const clientOn = vi.fn((event: string, listener: (n: never) => void) => {
    if (event === 'notification') {
      notificationListeners.push(listener as (n: { method: string; params?: unknown }) => void);
    }
  });
  const clientOff = vi.fn();
  return {
    requestMock,
    agentListResponse,
    settingsValues,
    clientOn,
    clientOff,
    notificationListeners,
    reconnectHandlers,
  };
});

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock, on: clientOn, off: clientOff }),
  onBackendReconnected: (handler: () => void) => {
    reconnectHandlers.push(handler);
    return vi.fn();
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

/** Let queued microtasks (promise chains) settle. */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** PROTOCOL.md §6.3-shaped `events.event` push for an agent:idle event. */
function buildEventsEventNotification(
  overrides: Partial<{
    subscriptionId: string;
    workspaceId: string;
    data: Record<string, unknown>;
  }> = {},
) {
  return {
    method: 'events.event',
    params: {
      subscriptionId: overrides.subscriptionId ?? 'ws-sub-1',
      event: {
        id: 'evt-1',
        type: 'agent:idle',
        workspaceId: overrides.workspaceId ?? 'workspace-1',
        timestamp: new Date().toISOString(),
        data: {
          agentId: 'agent-self',
          agentName: 'Self Agent',
          ...overrides.data,
        },
      },
    },
  };
}

describe('NotificationService daemon agent:idle subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationCacheForTesting();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
    agentListResponse.agents = [];
    notificationListeners.length = 0;
    reconnectHandlers.length = 0;
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('start() issues events.subscribe for agent:idle scoped to the workspace (PROTOCOL.md §6.1)', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    // Assert exact on-wire request shape (PROTOCOL.md §6.1).
    expect(requestMock).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['agent:idle'],
      workspaceId: 'workspace-1',
    });
    // A `notification` listener was attached to the daemon client.
    expect(clientOn).toHaveBeenCalledWith('notification', expect.any(Function));
    service.stop();
  });

  it('shows a notification when a §6.3-shaped agent:idle events.event arrives', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    expect(notificationListeners.length).toBe(1);
    notificationListeners[0](buildEventsEventNotification());
    await flush();

    expect(mockNotificationInstances.length).toBe(1);
    service.stop();
  });

  it('ignores events.event pushes for other subscription ids', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    notificationListeners[0](
      buildEventsEventNotification({ subscriptionId: 'renderer-sub-99' }),
    );
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('ignores agent:idle events for other workspaces', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    notificationListeners[0](buildEventsEventNotification({ workspaceId: 'workspace-2' }));
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('suppresses notifications for background agents flagged via agent.list metadata', async () => {
    agentListResponse.agents = [
      { id: 'agent-self', metadata: { isBackground: true, specialist: 'implementor' } },
    ];

    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    notificationListeners[0](buildEventsEventNotification());
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('re-issues events.subscribe after backend reconnect', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    expect(reconnectHandlers.length).toBe(1);
    const subscribeCalls = () =>
      requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
    expect(subscribeCalls()).toHaveLength(1);

    reconnectHandlers[0]();
    await flush();

    expect(subscribeCalls()).toHaveLength(2);
    expect(subscribeCalls()[1][1]).toEqual({
      eventTypes: ['agent:idle'],
      workspaceId: 'workspace-1',
    });
    service.stop();
  });

  it('stop() detaches the listener and unsubscribes (PROTOCOL.md §6.2)', async () => {
    const service = new NotificationService('workspace-1');
    service.start();
    await flush();

    service.stop();
    await flush();

    expect(clientOff).toHaveBeenCalledWith('notification', expect.any(Function));
    expect(requestMock).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'ws-sub-1',
    });
  });
});

describe('NotificationService focus gate (soundOnlyWhenUnfocused)', () => {
  function buildIdleEvent(): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId: 'workspace-1',
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'agent-self',
        agentName: 'Self Agent',
        isBackground: false,
      },
    } as AgentIdleEvent;
  }

  function installFocusedWindow(isFocused: boolean) {
    const mockWindow = {
      id: 1,
      webContents: { send: vi.fn(), isDestroyed: () => false },
      focus: vi.fn(),
      show: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      isFocused: () => isFocused,
      isDestroyed: () => false,
    };
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([mockWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation((id: number) =>
      (id === mockWindow.id ? mockWindow : null) as never,
    );
    return mockWindow;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationCacheForTesting();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
    agentListResponse.agents = [];
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('suppresses the OS banner but still sends notification:show when focused and soundOnlyWhenUnfocused=true', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(true);

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    // OS banner suppressed…
    expect(mockNotificationInstances.length).toBe(0);
    // …but the renderer sound event is still delivered.
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
  });

  it('shows the OS banner even when focused if soundOnlyWhenUnfocused=false', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = false;
    installFocusedWindow(true);

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
  });

  it('shows the OS banner when unfocused regardless of soundOnlyWhenUnfocused', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(false);

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
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

describe('NotificationService handleAgentIdle suppression via agent.list', () => {
  function buildIdleEvent(overrides: Partial<AgentIdleEvent['data']> = {}): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId: 'workspace-1',
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'agent-self',
        agentName: 'Self Agent',
        isBackground: false,
        ...overrides,
      } as AgentIdleEvent['data'],
    } as AgentIdleEvent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationCacheForTesting();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
    agentListResponse.agents = [];
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('suppresses notification when another agent in the workspace is streaming', async () => {
    agentListResponse.agents = [
      { id: 'agent-self', isStreaming: false, isResponding: false },
      { id: 'agent-other', isStreaming: true, isResponding: false },
    ];

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    // Assert exact on-wire request shape (PROTOCOL.md §5.5).
    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    // No notification constructed because suppression fired.
    expect(mockNotificationInstances.length).toBe(0);
  });

  it('does not suppress when the only active agent in the list is the idling agent itself', async () => {
    agentListResponse.agents = [
      { id: 'agent-self', isStreaming: true, isResponding: false },
    ];

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    // Notification proceeds — the idling agent's own residual flag is not a
    // suppression trigger.
    expect(mockNotificationInstances.length).toBe(1);
  });

  it('does not suppress when agent.list returns an empty list', async () => {
    agentListResponse.agents = [];

    const service = new NotificationService('workspace-1');
    await service.handleAgentIdle(buildIdleEvent());

    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    expect(mockNotificationInstances.length).toBe(1);
  });
});

