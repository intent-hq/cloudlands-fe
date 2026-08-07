import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, BrowserWindow } from 'electron';
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
import { workspaceService } from '../../workspace/main/workspace.service';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
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
      provider?: string;
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
  // T9: notification/status listeners register on the stable forwarders now.
  // Capture them in the same arrays the tests drive so delivery still works,
  // with disposers that detach on stop()/clearStatusRetry().
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    notificationListeners.push(handler);
    return () => {
      const idx = notificationListeners.indexOf(handler);
      if (idx !== -1) notificationListeners.splice(idx, 1);
    };
  },
  onBackendStatus: (handler: (status: string) => void) => {
    statusListeners.push(handler);
    return () => {
      const idx = statusListeners.indexOf(handler);
      if (idx !== -1) statusListeners.splice(idx, 1);
    };
  },
}));

const { mockNotificationIsSupported, mockNotificationInstances, mockShowShouldThrow } = vi.hoisted(
  () => ({
    mockNotificationIsSupported: { value: false },
    mockNotificationInstances: [] as Array<{
      opts?: unknown;
      handlers: Record<string, Function>;
      show: ReturnType<typeof vi.fn>;
    }>,
    mockShowShouldThrow: { value: false },
  }),
);

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
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  Notification: class {
    static isSupported() {
      return mockNotificationIsSupported.value;
    }

    handlers: Record<string, Function> = {};
    opts?: unknown;
    show = vi.fn(() => {
      if (mockShowShouldThrow.value) {
        throw new Error('show failed');
      }
    });

    constructor(opts?: unknown) {
      this.opts = opts;
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

// Dynamically imported by the notification-click fallback (no regular window
// live): opens a fresh app window on the workspace route.
const { createWindowForSessionMock, getMainWindowMock } = vi.hoisted(() => ({
  createWindowForSessionMock: vi.fn(),
  getMainWindowMock: vi.fn(() => null),
}));

vi.mock('../../../main/window', () => ({
  createWindowForSession: createWindowForSessionMock,
}));

vi.mock('../../../main/state', () => ({
  getMainWindow: getMainWindowMock,
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
    // A `notification` listener was attached via the stable forwarder.
    expect(notificationListeners.length).toBe(1);
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

    notificationListeners[0](buildEventsEventNotification({ subscriptionId: 'renderer-sub-99' }));
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
    const subscribeCalls = () => requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
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

    expect(notificationListeners).toHaveLength(0);
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

    const subscribeCalls = () => requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
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

    const subscribeCalls = () => requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');
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

    const subscribeCalls = () => requestMock.mock.calls.filter(([m]) => m === 'events.subscribe');

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
   * the app's focused window is currently VIEWING workspace-1 (the sound-only
   * gate: getFocusedWindowWorkspaceId() === event.workspaceId). The app is
   * frontmost in both cases — a BrowserWindow has focus.
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
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(mockWindow as never);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === mockWindow.id ? mockWindow : null) as never,
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
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('suppresses the OS banner but still sends notification:show (no navigateTarget) when the focused window views the workspace and soundOnlyWhenUnfocused=true', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(true);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    // OS banner suppressed…
    expect(mockNotificationInstances.length).toBe(0);
    // …but the renderer sound event is still delivered — sound-only, no toast.
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
    expect(vi.mocked(sendToWorkspaceWindows).mock.calls[0][2]).not.toHaveProperty('navigateTarget');
  });

  it('delivers an in-app toast (navigateTarget, no OS banner) when frontmost and viewing the workspace with soundOnlyWhenUnfocused=false (electron#51885)', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = false;
    installFocusedWindow(true);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(0);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({
        title: expect.any(String),
        body: expect.any(String),
        navigateTarget: { workspaceId: 'workspace-1' },
      }),
    );
  });

  it('delivers an in-app toast when frontmost but NOT viewing the workspace regardless of soundOnlyWhenUnfocused (electron#51885)', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(false);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(0);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({
        navigateTarget: { workspaceId: 'workspace-1' },
      }),
    );
  });

  it('shows the OS banner (no navigateTarget) when the app is not frontmost', async () => {
    settingsValues['notifications.soundOnlyWhenUnfocused'] = true;
    installFocusedWindow(false);
    // No focused window at all — app is backgrounded; the banner click works.
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({ title: expect.any(String), body: expect.any(String) }),
    );
    expect(vi.mocked(sendToWorkspaceWindows).mock.calls[0][2]).not.toHaveProperty('navigateTarget');
  });
});

describe('NotificationService frontmost in-app delivery (electron#51885)', () => {
  function buildIdleEvent(workspaceId = 'workspace-1', agentId = 'agent-self'): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId,
      timestamp: new Date().toISOString(),
      data: {
        agentId,
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
      isFocused: () => true,
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
    // Baseline: app not frontmost, event workspace not open anywhere, focused
    // window not viewing it. Individual tests install a focused window.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('frontmost: creates NO OS Notification and sends notification:show with navigateTarget to workspace windows', async () => {
    const focusedWindow = createMockWindow(41);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow as never);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([41]);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(0);
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'workspace-1',
      'notification:show',
      expect.objectContaining({
        title: expect.any(String),
        body: expect.any(String),
        navigateTarget: { workspaceId: 'workspace-1' },
      }),
    );
  });

  it('frontmost with the workspace open nowhere: navigateTarget payload falls back to the focused window', async () => {
    const focusedWindow = createMockWindow(42);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent('workspace-closed'));

    expect(mockNotificationInstances.length).toBe(0);
    expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
    expect(focusedWindow.webContents.send).toHaveBeenCalledWith(
      'notification:show',
      expect.objectContaining({
        navigateTarget: { workspaceId: 'workspace-closed' },
      }),
    );
  });

  it('not frontmost: shows the OS banner and notification:show carries NO navigateTarget', async () => {
    const onlyWindow = createMockWindow(43);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    const showCalls = onlyWindow.webContents.send.mock.calls.filter(
      ([channel]) => channel === 'notification:show',
    );
    expect(showCalls).toHaveLength(1);
    expect(showCalls[0][1]).not.toHaveProperty('navigateTarget');
  });

  it('frontmost chief completion: navigateTarget carries the chief flag and agentId', async () => {
    const focusedWindow = createMockWindow(44);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent(CHIEF_WORKSPACE_ID, 'chief-agent-1'));

    expect(mockNotificationInstances.length).toBe(0);
    expect(focusedWindow.webContents.send).toHaveBeenCalledWith(
      'notification:show',
      expect.objectContaining({
        navigateTarget: {
          workspaceId: CHIEF_WORKSPACE_ID,
          chief: true,
          agentId: 'chief-agent-1',
        },
      }),
    );
  });

  it('showTestNotification still shows a real OS banner even when frontmost', () => {
    const focusedWindow = createMockWindow(45);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([focusedWindow] as never);

    const service = new NotificationService();
    const result = service.showTestNotification();

    expect(result.success).toBe(true);
    expect(mockNotificationInstances.length).toBe(1);
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
    // mockReturnValue survives clearAllMocks — reset leftovers from the
    // frontmost-delivery suite above.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
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

  it('opens a fresh window instead of focusing when mainWindow is destroyed', async () => {
    const mockWindow = createMockWindow(false);
    // Override isDestroyed to return true
    mockWindow.isDestroyed = () => true;
    // No other window is live: the click-time re-pick finds nothing.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);

    triggerNotificationClick('workspace-1', mockWindow);
    await flush();

    expect(mockFocus).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockWebContentsSend).not.toHaveBeenCalled();
    // The click falls back to opening a new app window on the workspace route.
    expect(createWindowForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/workspace/workspace-1' }),
      true,
    );
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

describe('NotificationService click-target selection excludes the HUD window', () => {
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

  function makeWindow(id: number, url: string) {
    return {
      id,
      webContents: {
        send: vi.fn(),
        isDestroyed: () => false,
        getURL: () => url,
      },
      focus: vi.fn(),
      show: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      isFocused: () => false,
      isDestroyed: () => false,
    };
  }

  const HUD_URL = 'http://127.0.0.1:5190/hud';
  const MAIN_URL = 'http://127.0.0.1:5190/';

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

  it('never picks the HUD window even when it has the workspace open and is focused — the main window gets the navigate', async () => {
    const hudWindow = makeWindow(1, HUD_URL);
    const regularWindow = makeWindow(2, MAIN_URL);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([hudWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === 1 ? hudWindow : id === 2 ? regularWindow : null) as never,
    );
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(hudWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([hudWindow, regularWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    expect(regularWindow.focus).toHaveBeenCalled();
    expect(regularWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
    expect(hudWindow.focus).not.toHaveBeenCalled();
    expect(hudWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
  });

  it('prefers a non-HUD workspace window over the focused window', async () => {
    const hudWindow = makeWindow(1, HUD_URL);
    const workspaceWindow = makeWindow(2, `http://127.0.0.1:5190/workspace/workspace-1`);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([hudWindow.id, workspaceWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === 1 ? hudWindow : id === 2 ? workspaceWindow : null) as never,
    );
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(hudWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([hudWindow, workspaceWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    expect(workspaceWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
    expect(hudWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
  });

  it('opens a fresh main window when the HUD is the only live window (never navigates the HUD)', async () => {
    const hudWindow = makeWindow(1, HUD_URL);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([hudWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === 1 ? hudWindow : null) as never,
    );
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(hudWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([hudWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();
    await flush();

    expect(hudWindow.focus).not.toHaveBeenCalled();
    expect(hudWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
    expect(createWindowForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/workspace/workspace-1' }),
      true,
    );
  });

  it('opens a fresh main window on the workspace route when NO windows are live at all', async () => {
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(BrowserWindow.fromId).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();
    await flush();

    expect(createWindowForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/workspace/workspace-1' }),
      true,
    );
  });

  it('with multiple workspace windows one of them is picked — never the focused HUD', async () => {
    const hudWindow = makeWindow(1, HUD_URL);
    const workspaceWindowA = makeWindow(2, `http://127.0.0.1:5190/workspace/workspace-1`);
    const workspaceWindowB = makeWindow(3, `http://127.0.0.1:5190/workspace/workspace-1`);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([
      hudWindow.id,
      workspaceWindowA.id,
      workspaceWindowB.id,
    ]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) =>
        (id === 1
          ? hudWindow
          : id === 2
            ? workspaceWindowA
            : id === 3
              ? workspaceWindowB
              : null) as never,
    );
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(hudWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      hudWindow,
      workspaceWindowA,
      workspaceWindowB,
    ] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    const navigated = [workspaceWindowA, workspaceWindowB].filter((w) =>
      w.webContents.send.mock.calls.some(
        ([channel]: [string]) => channel === 'notification:navigate',
      ),
    );
    expect(navigated).toHaveLength(1);
    expect(hudWindow.focus).not.toHaveBeenCalled();
    expect(hudWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
    expect(createWindowForSessionMock).not.toHaveBeenCalled();
  });

  it('re-picks at click time when the show-time target navigated to /hud meanwhile (dedupe-held clicks stay HUD-safe)', async () => {
    // The notification can sit in the notification center long after show;
    // the #572 native-id replacement path also re-fires clicks on the LATEST
    // instance. If the captured target window has since navigated to /hud,
    // the click must re-run the picker instead of navigating the HUD.
    let targetUrl = MAIN_URL;
    const morphingWindow = {
      ...makeWindow(1, MAIN_URL),
      webContents: {
        send: vi.fn(),
        isDestroyed: () => false,
        getURL: () => targetUrl,
      },
    };
    const otherWindow = makeWindow(2, `http://127.0.0.1:5190/workspace/other`);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([morphingWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === 1 ? morphingWindow : id === 2 ? otherWindow : null) as never,
    );
    // App not frontmost at show time — otherwise the electron#51885 gate
    // delivers an in-app toast instead of the OS banner under test here.
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([morphingWindow, otherWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());
    expect(mockNotificationInstances.length).toBe(1);

    // The captured window becomes the HUD before the user clicks.
    targetUrl = HUD_URL;
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    mockNotificationInstances[0].handlers['click']();

    expect(morphingWindow.focus).not.toHaveBeenCalled();
    expect(morphingWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
    expect(otherWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
  });

  it('a #572 replacement notification click also goes through the picker (never the HUD)', async () => {
    const hudWindow = makeWindow(1, HUD_URL);
    const regularWindow = makeWindow(2, MAIN_URL);
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([hudWindow.id]);
    vi.mocked(BrowserWindow.fromId).mockImplementation(
      (id: number) => (id === 1 ? hudWindow : id === 2 ? regularWindow : null) as never,
    );
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(hudWindow as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([hudWindow, regularWindow] as never);

    const service = new NotificationService();
    // Two idles from the same agent share the native id (#572): the second
    // instance natively replaces the first, and ITS click handler is the
    // live one — it must route through the picker like the first.
    await service.handleAgentIdle(buildIdleEvent());
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(2);
    expect((mockNotificationInstances[0].opts as { id?: string }).id).toBe(
      (mockNotificationInstances[1].opts as { id?: string }).id,
    );
    mockNotificationInstances[1].handlers['click']();

    expect(regularWindow.focus).toHaveBeenCalled();
    expect(regularWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
    expect(hudWindow.focus).not.toHaveBeenCalled();
    expect(hudWindow.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.anything(),
    );
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
    // Not frontmost — this suite asserts the OS-banner path.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
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
    agentListResponse.agents = [{ id: 'agent-self', isStreaming: true, isResponding: false }];

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

  it('suppresses via the isWaitingForOtherAgents fast path without consulting agent.list', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent({ isWaitingForOtherAgents: true }));

    // Fast path fires before the agent.list gate — no §5.5 read at all.
    expect(requestMock).not.toHaveBeenCalledWith('agent.list', expect.anything());
    expect(mockNotificationInstances.length).toBe(0);
  });

  it('does not suppress when isWaitingForOtherAgents is false', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent({ isWaitingForOtherAgents: false }));

    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
    expect(mockNotificationInstances.length).toBe(1);
  });

  it('does not suppress when isWaitingForOtherAgents is absent (older daemons)', async () => {
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

describe('NotificationService chief-of-staff special-case', () => {
  function buildChiefIdleEvent(overrides: Partial<AgentIdleEvent['data']> = {}): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId: CHIEF_WORKSPACE_ID,
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'chief-agent-1',
        agentName: 'Morning planning',
        isBackground: false,
        ...overrides,
      } as AgentIdleEvent['data'],
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
    // No window has the chief "workspace" open — the global service falls
    // back to the focused (or any) window.
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('titles chief notifications "Assistant — <chat name>" without fetching a workspace title', async () => {
    const onlyWindow = createMockWindow(21);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildChiefIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    expect(mockNotificationInstances[0].opts).toEqual({
      title: 'Assistant — Morning planning',
      body: 'Finished',
      id: `${CHIEF_WORKSPACE_ID}:chief-agent-1`,
    });
    // The chief workspace is virtual — no workspace title lookup.
    expect(workspaceService.getWorkspace).not.toHaveBeenCalled();
  });

  it('truncates long chief chat names like existing titles', async () => {
    const onlyWindow = createMockWindow(22);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);
    const longName = 'a'.repeat(50);

    const service = new NotificationService();
    await service.handleAgentIdle(buildChiefIdleEvent({ agentName: longName }));

    expect(mockNotificationInstances.length).toBe(1);
    expect(mockNotificationInstances[0].opts).toEqual({
      title: `Assistant — ${'a'.repeat(37)}...`,
      body: 'Finished',
      id: `${CHIEF_WORKSPACE_ID}:chief-agent-1`,
    });
  });

  it('click sends notification:navigate with chief flag and agentId (no bare workspace payload)', async () => {
    const onlyWindow = createMockWindow(23);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildChiefIdleEvent());

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    expect(onlyWindow.show).toHaveBeenCalled();
    expect(onlyWindow.focus).toHaveBeenCalled();
    expect(onlyWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: CHIEF_WORKSPACE_ID,
      chief: true,
      agentId: 'chief-agent-1',
    });
  });

  it('non-chief clicks keep the bare { workspaceId } payload (regression)', async () => {
    const onlyWindow = createMockWindow(24);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle({
      type: 'agent:idle',
      workspaceId: 'workspace-1',
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'agent-self',
        agentName: 'Self Agent',
        isBackground: false,
      },
    } as AgentIdleEvent);

    expect(mockNotificationInstances.length).toBe(1);
    mockNotificationInstances[0].handlers['click']();

    expect(onlyWindow.webContents.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'workspace-1',
    });
  });
});

describe('NotificationService native id-based replacement', () => {
  function buildIdleEvent(workspaceId = 'workspace-1', agentId = 'agent-self'): AgentIdleEvent {
    return {
      type: 'agent:idle',
      workspaceId,
      timestamp: new Date().toISOString(),
      data: {
        agentId,
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
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  it('constructs agent-idle notifications with id = `workspaceId:agentId`', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent('workspace-1', 'agent-self'));

    expect(mockNotificationInstances.length).toBe(1);
    expect(mockNotificationInstances[0].opts).toEqual(
      expect.objectContaining({ id: 'workspace-1:agent-self' }),
    );
  });

  it('repeat idles from the same agent reuse the SAME id (native OS replacement, no manual close)', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(2);
    const [first, second] = mockNotificationInstances;
    expect((first.opts as { id?: string }).id).toBe('workspace-1:agent-self');
    expect((second.opts as { id?: string }).id).toBe('workspace-1:agent-self');
    // Both notifications were shown — replacement is delegated to the OS via
    // the shared id, never emulated with close()-before-show.
    expect(first.show).toHaveBeenCalledTimes(1);
    expect(second.show).toHaveBeenCalledTimes(1);
  });

  it('distinct agents and workspaces produce distinct ids (never replace each other)', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent('workspace-1', 'agent-a'));
    await service.handleAgentIdle(buildIdleEvent('workspace-1', 'agent-b'));
    await service.handleAgentIdle(buildIdleEvent('workspace-2', 'agent-a'));

    expect(mockNotificationInstances.length).toBe(3);
    const ids = mockNotificationInstances.map((n) => (n.opts as { id?: string }).id);
    expect(ids).toEqual(['workspace-1:agent-a', 'workspace-1:agent-b', 'workspace-2:agent-a']);
    expect(new Set(ids).size).toBe(3);
  });

  it('showTestNotification passes NO id (random-UUID fallback, never replaces)', () => {
    const onlyWindow = createMockWindow(31);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    service.showTestNotification();

    expect(mockNotificationInstances.length).toBe(1);
    expect(mockNotificationInstances[0].opts).not.toHaveProperty('id');
  });

  it('evicts the replaced same-id notification from activeNotifications even when the OS never fires close (leak regression)', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());
    await service.handleAgentIdle(buildIdleEvent());
    await service.handleAgentIdle(buildIdleEvent());

    // Three same-id idles, no 'close' events at all: only the latest instance
    // may be retained — replaced ones are evicted at replacement time.
    expect(mockNotificationInstances.length).toBe(3);
    expect((service as any).activeNotifications.size).toBe(1);
    expect((service as any).notificationsById.size).toBe(1);

    // Closing the survivor drains both structures completely.
    mockNotificationInstances[2].handlers['close']();
    expect((service as any).activeNotifications.size).toBe(0);
    expect((service as any).notificationsById.size).toBe(0);
  });

  it('distinct-id notifications never evict each other from activeNotifications', async () => {
    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent('workspace-1', 'agent-a'));
    await service.handleAgentIdle(buildIdleEvent('workspace-1', 'agent-b'));

    expect((service as any).activeNotifications.size).toBe(2);
    expect((service as any).notificationsById.size).toBe(2);
  });

  it('sends the notification:show sound event for EVERY shown notification, including same-id repeats', async () => {
    // App not frontmost (no focused window) so the banner path runs; the
    // sound event falls back to getAllWindows()[0].
    const onlyWindow = createMockWindow(32);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());
    await service.handleAgentIdle(buildIdleEvent());

    expect(mockNotificationInstances.length).toBe(2);
    const soundCalls = onlyWindow.webContents.send.mock.calls.filter(
      ([channel]) => channel === 'notification:show',
    );
    expect(soundCalls).toHaveLength(2);
  });
});

describe('NotificationService structured notification:show payload', () => {
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
    // App not frontmost — the OS-banner path runs and notification:show
    // falls back to getAllWindows()[0].
    vi.mocked(getWindowIdsForWorkspace).mockReturnValue([]);
    vi.mocked(getFocusedWindowWorkspaceId).mockReturnValue(undefined);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null as never);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  afterEach(() => {
    mockNotificationIsSupported.value = false;
    agentListResponse.agents = [];
  });

  function showPayload(window: ReturnType<typeof createMockWindow>) {
    const calls = window.webContents.send.mock.calls.filter(
      ([channel]) => channel === 'notification:show',
    );
    expect(calls).toHaveLength(1);
    return calls[0][1] as Record<string, unknown>;
  }

  it('workspace notifications carry structured parts (untruncated) while title/body stay unchanged', async () => {
    const onlyWindow = createMockWindow(51);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);
    agentListResponse.agents = [
      { id: 'agent-self', provider: 'claude-code', metadata: { specialist: 'spec-writer' } },
    ];
    const longTaskTitle = 't'.repeat(50);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent({ taskTitle: longTaskTitle }));

    const payload = showPayload(onlyWindow);
    // Existing concatenated (truncated) title/body are byte-identical.
    expect(payload.title).toBe(`Test Workspace - Coordinator: ${'t'.repeat(37)}...`);
    expect(payload.body).toBe('Task completed');
    // Structured parts are untruncated — the renderer truncates via CSS.
    expect(payload.structured).toEqual({
      workspaceTitle: 'Test Workspace',
      specialist: 'spec-writer',
      specialistDisplayName: 'Coordinator',
      taskTitle: longTaskTitle,
      provider: 'claude-code',
      // Seeds AuggieAvatar's deterministic gradient colors in the toast.
      agentId: 'agent-self',
    });
  });

  it('omits optional structured fields when unavailable (no task, unknown agent → no provider)', async () => {
    const onlyWindow = createMockWindow(52);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle(buildIdleEvent());

    const payload = showPayload(onlyWindow);
    expect(payload.structured).toEqual({
      workspaceTitle: 'Test Workspace',
      specialistDisplayName: 'Agent',
      agentId: 'agent-self',
    });
  });

  it('chief notifications carry NO structured field', async () => {
    const onlyWindow = createMockWindow(53);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([onlyWindow] as never);

    const service = new NotificationService();
    await service.handleAgentIdle({
      type: 'agent:idle',
      workspaceId: CHIEF_WORKSPACE_ID,
      timestamp: new Date().toISOString(),
      data: {
        agentId: 'chief-agent-1',
        agentName: 'Morning planning',
        isBackground: false,
      },
    } as AgentIdleEvent);

    const payload = showPayload(onlyWindow);
    expect(payload).not.toHaveProperty('structured');
  });
});
