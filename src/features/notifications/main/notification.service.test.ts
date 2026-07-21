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
import {
  NotificationService,
  __resetNotificationCacheForTesting,
  getNotificationService,
} from './notification.service';
// workspace-event-bus was deleted; notifications are now driven by Redux sagas
import {
  getFocusedWindowWorkspaceId,
  getWindowIdsForWorkspace,
  sendToWorkspaceWindows,
} from '../../system/main/system.ipc';
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
  statusListeners,
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
  const statusListeners: Array<(status: string) => void> = [];
  const reconnectHandlers: Array<() => void> = [];
  const clientOn = vi.fn((event: string, listener: (n: never) => void) => {
    if (event === 'notification') {
      notificationListeners.push(listener as (n: { method: string; params?: unknown }) => void);
    }
    if (event === 'status') {
      statusListeners.push(listener as (status: string) => void);
    }
  });
  const clientOff = vi.fn((event: string, listener: (n: never) => void) => {
    if (event === 'notification') {
      const idx = notificationListeners.indexOf(
        listener as (n: { method: string; params?: unknown }) => void,
      );
      if (idx !== -1) notificationListeners.splice(idx, 1);
    }
    if (event === 'status') {
      const idx = statusListeners.indexOf(listener as (status: string) => void);
      if (idx !== -1) statusListeners.splice(idx, 1);
    }
  });
  return {
    requestMock,
    agentListResponse,
    settingsValues,
    clientOn,
    clientOff,
    notificationListeners,
    statusListeners,
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
    getFocusedWindow: vi.fn(() => null),
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
  getFocusedWindowWorkspaceId: vi.fn(() => undefined),
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
    statusListeners.length = 0;
    reconnectHandlers.length = 0;
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('start() issues ONE events.subscribe for agent:idle with workspaceId omitted (PROTOCOL.md §6.1, all workspaces)', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    // Assert exact on-wire request shape (PROTOCOL.md §6.1) — workspaceId is
    // deliberately absent so the subscription covers every workspace.
    expect(requestMock).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['agent:idle'],
    });
    // A `notification` listener was attached to the daemon client.
    expect(clientOn).toHaveBeenCalledWith('notification', expect.any(Function));
    service.stop();
  });

  it('shows a notification when a §6.3-shaped agent:idle events.event arrives', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    expect(notificationListeners.length).toBe(1);
    notificationListeners[0](buildEventsEventNotification());
    await flush();

    expect(mockNotificationInstances.length).toBe(1);
    service.stop();
  });

  it('ignores events.event pushes for other subscription ids', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    notificationListeners[0](
      buildEventsEventNotification({ subscriptionId: 'renderer-sub-99' }),
    );
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('handles agent:idle events from ANY workspace via the single global subscription', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    notificationListeners[0](buildEventsEventNotification({ workspaceId: 'workspace-2' }));
    await flush();

    // Per-event routing: agent.list targets the EVENT's workspace.
    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-2' });
    expect(mockNotificationInstances.length).toBe(1);
    service.stop();
  });

  it('drops agent:idle events without a workspaceId (cannot be routed)', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    notificationListeners[0]({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-1',
        event: {
          id: 'evt-x',
          type: 'agent:idle',
          timestamp: new Date().toISOString(),
          data: { agentId: 'agent-self', agentName: 'Self Agent' },
        },
      },
    });
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('suppresses notifications for background agents flagged via agent.list metadata', async () => {
    agentListResponse.agents = [
      { id: 'agent-self', metadata: { isBackground: true, specialist: 'implementor' } },
    ];

    const service = new NotificationService();
    service.start();
    await flush();

    notificationListeners[0](buildEventsEventNotification());
    await flush();

    expect(mockNotificationInstances.length).toBe(0);
    service.stop();
  });

  it('re-issues events.subscribe after backend reconnect', async () => {
    const service = new NotificationService();
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
    });
    service.stop();
  });

  it('stop() detaches the listener and unsubscribes (PROTOCOL.md §6.2)', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    service.stop();
    await flush();

    expect(clientOff).toHaveBeenCalledWith('notification', expect.any(Function));
    expect(requestMock).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'ws-sub-1',
    });
  });

  it('discards and releases a subscribe that resolves after stop() (no stale subscriptionId)', async () => {
    // Make events.subscribe hang until we resolve it manually. Restore the
    // default implementation afterwards (clearAllMocks does not do this).
    const defaultImpl = requestMock.getMockImplementation();
    let resolveSubscribe!: (v: { subscriptionId: string }) => void;
    requestMock.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'events.subscribe') {
        return new Promise((r) => {
          resolveSubscribe = r;
        });
      }
      if (method === 'settings.get') {
        const path = (params as { path?: string } | undefined)?.path ?? '';
        return { path, value: settingsValues[path] ?? true };
      }
      if (method === 'agent.list') return agentListResponse;
      if (method === 'events.unsubscribe') return { success: true };
      return {};
    });

    const service = new NotificationService();
    service.start();
    await flush();

    // stop() runs while events.subscribe is still in flight.
    service.stop();
    await flush();

    // The stale subscribe resolves after teardown.
    resolveSubscribe({ subscriptionId: 'stale-sub-1' });
    await flush();

    // The stale id must be released, not adopted.
    expect(requestMock).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'stale-sub-1',
    });

    // stop() detached the notification listener, so stale-id events can no
    // longer reach the service at all.
    expect(notificationListeners).toHaveLength(0);
    expect(mockNotificationInstances.length).toBe(0);

    requestMock.mockImplementation(defaultImpl!);
  });

  it('releases the superseded subscription id when concurrent same-epoch subscribes both resolve', async () => {
    // Reconnect handler racing an armed status-retry: two subscribes in the
    // same epoch resolve with different ids — the second overwrites the first,
    // which must be unsubscribed instead of leaking daemon-side.
    const defaultImpl = requestMock.getMockImplementation();
    const pendingSubscribes: Array<(v: { subscriptionId: string }) => void> = [];
    requestMock.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'events.subscribe') {
        return new Promise((r) => {
          pendingSubscribes.push(r);
        });
      }
      return defaultImpl!(method, params);
    });

    const service = new NotificationService();
    service.start();
    await flush();
    (service as any).subscribeToIdleEvents();
    await flush();
    expect(pendingSubscribes).toHaveLength(2);

    pendingSubscribes[0]({ subscriptionId: 'sub-first' });
    await flush();
    pendingSubscribes[1]({ subscriptionId: 'sub-second' });
    await flush();

    expect(service['subscriptionId']).toBe('sub-second');
    expect(requestMock).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'sub-first',
    });

    service.stop();
    requestMock.mockImplementation(defaultImpl!);
  });

  it('retries events.subscribe on the first status→connected transition when the initial subscribe failed (initial-connect gap)', async () => {
    // Regression: start() before the daemon client's FIRST successful connect.
    // The initial subscribe rejects and `reconnected` never fires (it requires
    // an earlier connected state), so without the status-retry the service
    // stayed silent until an app relaunch.
    const defaultImpl = requestMock.getMockImplementation();
    let failSubscribe = true;
    requestMock.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'events.subscribe') {
        if (failSubscribe) throw new Error('Connection closed');
        return { subscriptionId: 'ws-sub-1' };
      }
      return defaultImpl!(method, params);
    });

    const service = new NotificationService();
    service.start();
    await flush();

    const subscribeCalls = () =>
      requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
    expect(subscribeCalls()).toHaveLength(1);
    expect(service['subscriptionId']).toBeUndefined();
    // A status listener was armed for the retry.
    expect(statusListeners.length).toBe(1);

    // Daemon connects for the first time → retry fires and succeeds.
    failSubscribe = false;
    statusListeners[0]('connected');
    await flush();

    expect(subscribeCalls()).toHaveLength(2);
    expect(subscribeCalls()[1][1]).toEqual({
      eventTypes: ['agent:idle'],
    });
    expect(service['subscriptionId']).toBe('ws-sub-1');
    // The retry listener detached itself after the connected transition.
    expect(statusListeners.length).toBe(0);

    // Idle events now produce notifications end-to-end.
    notificationListeners[0](buildEventsEventNotification());
    await flush();
    expect(mockNotificationInstances.length).toBe(1);

    service.stop();
    requestMock.mockImplementation(defaultImpl!);
  });

  it('does not double-subscribe when a connected transition arrives after a successful subscribe', async () => {
    const service = new NotificationService();
    service.start();
    await flush();

    const subscribeCalls = () =>
      requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
    expect(subscribeCalls()).toHaveLength(1);
    // Successful subscribe → no retry listener armed.
    expect(statusListeners.length).toBe(0);

    service.stop();
  });

  it('ignores non-connected status transitions and detaches the retry listener on stop()', async () => {
    const defaultImpl = requestMock.getMockImplementation();
    requestMock.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'events.subscribe') throw new Error('Connection closed');
      return defaultImpl!(method, params);
    });

    const service = new NotificationService();
    service.start();
    await flush();
    expect(statusListeners.length).toBe(1);

    const subscribeCalls = () =>
      requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');

    // connecting / disconnected must not trigger a retry.
    statusListeners[0]('connecting');
    statusListeners[0]('disconnected');
    await flush();
    expect(subscribeCalls()).toHaveLength(1);

    // stop() detaches the armed retry listener.
    service.stop();
    expect(statusListeners.length).toBe(0);

    requestMock.mockImplementation(defaultImpl!);
  });
});

describe('getNotificationService app-wide singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationCacheForTesting();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
    agentListResponse.agents = [];
    notificationListeners.length = 0;
    statusListeners.length = 0;
    reconnectHandlers.length = 0;
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
  });

  it('returns the same instance on every call', () => {
    const service = getNotificationService();
    expect(getNotificationService()).toBe(service);
  });

  it('start() is idempotent — calling twice issues only one events.subscribe', async () => {
    const service = getNotificationService();
    service.start();
    await flush();
    service.start();
    await flush();

    const subscribeCalls = requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
    expect(subscribeCalls).toHaveLength(1);
    service.stop();
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

  /**
   * Install a window with workspace-1 open. `viewingFocused` controls whether
   * the app's focused window is currently VIEWING workspace-1 (the new gate:
   * getFocusedWindowWorkspaceId() === event.workspaceId).
   */
  function installFocusedWindow(viewingFocused: boolean) {
    const mockWindow = {
      id: 1,
      webContents: { send: vi.fn(), isDestroyed: () => false },
      focus: vi.fn(),
      show: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      isFocused: () => viewingFocused,
      isDestroyed: () => false,
    };
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([mockWindow.id]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(
      viewingFocused ? 'workspace-1' : undefined,
    );
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

  it('suppresses the OS banner but still sends notification:show when the focused window views the workspace and soundOnlyWhenUnfocused=true', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(true);

    const service = new NotificationService();
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

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
  });

  it('shows the OS banner when the focused window is NOT viewing the workspace regardless of soundOnlyWhenUnfocused', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(false);

    const service = new NotificationService();
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
    const service = new NotificationService();
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
    const service = new NotificationService();
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
    const service = new NotificationService();

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
    const service = new NotificationService();

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
    const service = new NotificationService();

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
    const service = new NotificationService();

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

    const service = new NotificationService();
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

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    // Notification proceeds — the idling agent's own residual flag is not a
    // suppression trigger.
    expect(mockNotificationInstances.length).toBe(1);
  });

  it('does not suppress when agent.list returns an empty list', async () => {
    agentListResponse.agents = [];

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    expect(mockNotificationInstances.length).toBe(1);
  });
});

describe('NotificationService fallbacks for workspaces with no open window', () => {
  function buildIdleEvent(workspaceId = 'workspace-closed'): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId,
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'agent-self',
        agentName: 'Self Agent',
        isBackground: false,
      },
    } as AgentIdleEvent;
  }

  function createMockWindow(id: number) {
    return {
      id,
      webContents: { send: vi.fn(), isDestroyed: () => false },
      focus: vi.fn(),
      show: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      isFocused: () => false,
      isDestroyed: () => false,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationCacheForTesting();
    mockNotificationIsSupported.value = true;
    mockNotificationInstances.length = 0;
    agentListResponse.agents = [];
    for (const key of Object.keys(settingsValues)) delete settingsValues[key];
    // The event's workspace is not open in ANY window, and no focused window
    // is viewing it.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('sound fallback: notification:show is sent to the focused window when the workspace has no open window', async () => {
    const focusedWindow = createMockWindow(11);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([focusedWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    // No workspace-targeted delivery — the workspace has no open window…
    expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
    // …so the renderer sound event falls back to the focused window.
    expect(focusedWindow.webContents.send).toHaveBeenCalledWith(
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
  });

  it('navigation fallback: click targets getFocusedWindow() ?? getAllWindows()[0] and sends notification:navigate with the event workspaceId', async () => {
    // No focused window → the ?? branch picks getAllWindows()[0].
    const onlyWindow = createMockWindow(12);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent('workspace-closed'));

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    expect(onlyWindow.show).toHaveBeenCalled();
    expect(onlyWindow.focus).toHaveBeenCalled();
    expect(onlyWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-closed',
    });
  });
});

