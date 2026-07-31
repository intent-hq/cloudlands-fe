import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'web'), isElectron: vi.fn(() => false),
  backend: vi.fn(), sound: vi.fn(() => Promise.resolve()),
  navigate: vi.fn(() => Promise.resolve()), on: vi.fn(), offById: vi.fn(),
  callbacks: {} as Record<string, (data?: any) => void>,
}));
vi.mock('$lib/utils/platform-capabilities', () => ({ getPlatform: mocks.platform }));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backend }));
vi.mock('$features/notifications/notification-sound-gate', () => ({ playNotificationSoundPerSettings: mocks.sound }));
vi.mock('$features/notifications/notification-navigation', () => ({ handleNotificationNavigate: mocks.navigate }));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { emitMockIpcEvent, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { notificationIpcSaga, webNotificationSaga } from './notifications-saga';

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => MockNotification.permission);
  static instances: MockNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: { body?: string }) { MockNotification.instances.push(this); }
}

const state = () => ({
  userPreferences: { enabled: true, soundOnlyWhenUnfocused: false },
  workspace: { activeWorkspaceId: null },
});
const idle = (data: Record<string, unknown> = {}, workspaceId = 'ws-1') => ({
  type: 'agent:idle', workspaceId, timestamp: '2026-07-31T00:00:00Z',
  data: {
    agentId: 'agent-1', agentName: 'Builder', status: 'idle', isStreaming: false,
    isResponding: false, isWaitingForOtherAgents: false, ...data,
  },
});
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

describe('notification sagas', () => {
  beforeEach(() => {
    vi.clearAllMocks(); resetMockIpcRouter(); mocks.platform.mockReturnValue('web');
    mocks.isElectron.mockReturnValue(false); mocks.callbacks = {};
    MockNotification.permission = 'granted'; MockNotification.instances = [];
    MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
    vi.stubGlobal('Notification', MockNotification);
    mocks.on.mockImplementation((channel, callback) => { mocks.callbacks[channel] = callback; return `id:${channel}`; });
    Object.assign(window, { electronAPI: { on: mocks.on, offById: mocks.offById } });
    mocks.backend.mockImplementation(async (method, params) => {
      if (method === 'settings.get') return { path: params.path, value: params.path === 'notifications.enabled' ? true : false, origin: 'default', definition: { path: params.path, type: 'boolean' }, wire_only: 'drop' };
      if (method === 'agent.list') return { agents: [{ id: 'agent-1', isStreaming: false, isResponding: false, metadata: { isBackground: false } }], wire_only: 'drop' };
      if (method === 'workspace.get') return { workspace: { id: params.workspaceId, title: 'My Space', repository_path: '/wire-only' } };
      throw new Error(`unexpected ${method}`);
    });
  });
  afterEach(() => { resetMockIpcRouter(); vi.unstubAllGlobals(); delete (window as any).electronAPI; });

  it('handles native sound/navigation in FIFO order and cleans up both listeners', async () => {
    mocks.isElectron.mockReturnValue(true);
    const task = runSaga({ dispatch: vi.fn(), getState: state }, notificationIpcSaga);
    mocks.callbacks['notification:show']({ title: 'Agent', body: 'Done', timestamp: 't', snake_case: 'ignored' });
    mocks.callbacks['notification:navigate']({ workspaceId: 'ws-1', chief: false, agentId: 'agent-1', snake_case: 'ignored' });
    await flush();
    expect(mocks.sound.mock.calls).toEqual([[]]);
    expect(mocks.navigate.mock.calls).toEqual([[{ workspaceId: 'ws-1', chief: false, agentId: 'agent-1', snake_case: 'ignored' }]]);
    task.cancel(); await task.toPromise();
    expect(mocks.offById.mock.calls).toEqual([
      ['notification:show', 'id:notification:show'],
      ['notification:navigate', 'id:notification:navigate'],
    ]);
  });

  it('does not let a native sound failure block click navigation', async () => {
    mocks.isElectron.mockReturnValue(true);
    mocks.sound.mockRejectedValueOnce(new Error('sound unavailable'));
    const task = runSaga({ dispatch: vi.fn(), getState: state }, notificationIpcSaga);
    mocks.callbacks['notification:show']({ title: 'Agent' });
    mocks.callbacks['notification:navigate']({ workspaceId: 'ws-1' });
    await flush();
    expect(mocks.navigate.mock.calls).toEqual([[{ workspaceId: 'ws-1' }]]);
    expect(task.isRunning()).toBe(true);
    task.cancel(); await task.toPromise();
  });

  it('performs exact web wire reads, shows one notification, and routes clicks', async () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const task = runSaga({ dispatch: vi.fn(), getState: state }, webNotificationSaga);
    emitMockIpcEvent('agent:idle', idle({ specialist: 'implementor', taskTitle: 'Ship', wire_only: 'preserve' }));
    await flush();
    expect(mocks.backend.mock.calls).toEqual([
      ['settings.get', { path: 'notifications.enabled' }],
      ['settings.get', { path: 'notifications.soundOnlyWhenUnfocused' }],
      ['agent.list', { workspaceId: 'ws-1' }],
      ['workspace.get', { workspaceId: 'ws-1' }],
    ]);
    expect(MockNotification.instances.map(({ title, options }) => ({ title, options }))).toEqual([
      { title: 'My Space - Implementor: Ship', options: { body: 'Task completed' } },
    ]);
    MockNotification.instances[0].onclick?.(); await flush();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(mocks.navigate.mock.calls).toEqual([[{ workspaceId: 'ws-1' }]]);
    expect(MockNotification.instances[0].close.mock.calls).toEqual([[]]);
    task.cancel(); await task.toPromise(); focus.mockRestore();
  });

  it('covers disabled, background, waiting, active-agent, and focused suppression paths', async () => {
    const current = state();
    const task = runSaga({ dispatch: vi.fn(), getState: () => current }, webNotificationSaga);
    mocks.backend.mockImplementation(async (method, params) => {
      if (method === 'settings.get') return { value: params.path === 'notifications.enabled' ? false : true };
      throw new Error('unexpected');
    });
    emitMockIpcEvent('agent:idle', idle()); await flush();
    expect(MockNotification.instances).toEqual([]);

    mocks.backend.mockImplementation(async (method, params) => {
      if (method === 'settings.get') return { value: params.path === 'notifications.enabled' ? true : false };
      if (method === 'agent.list') return { agents: [{ id: 'other', isStreaming: true, isResponding: false }] };
      throw new Error('unexpected');
    });
    emitMockIpcEvent('agent:idle', idle({ isBackground: true }));
    emitMockIpcEvent('agent:idle', idle({ isWaitingForOtherAgents: true }));
    emitMockIpcEvent('agent:idle', idle()); await flush();
    expect(MockNotification.instances).toEqual([]);

    current.workspace.activeWorkspaceId = 'ws-1';
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mocks.backend.mockImplementation(async (method, params) => {
      if (method === 'settings.get') return { value: true };
      if (method === 'agent.list') return { agents: [{ id: 'agent-1', isStreaming: false, isResponding: false }] };
      if (method === 'workspace.get') return { workspace: { id: params.workspaceId, title: 'Space' } };
    });
    emitMockIpcEvent('agent:idle', idle()); await flush();
    expect(MockNotification.instances).toEqual([]);
    expect(mocks.sound).toHaveBeenCalledTimes(1);
    task.cancel(); await task.toPromise();
  });

  it('falls back after settings failure, coalesces permission prompts, and silently skips denial', async () => {
    let resolvePermission!: (permission: NotificationPermission) => void;
    MockNotification.permission = 'default';
    MockNotification.requestPermission = vi.fn(() => new Promise((resolve) => { resolvePermission = resolve; }));
    const current = state();
    mocks.backend.mockImplementation(async (method, params) => {
      if (method === 'settings.get') throw new Error('offline');
      if (method === 'agent.list') return { agents: [{ id: 'agent-1', isStreaming: false, isResponding: false }] };
      if (method === 'workspace.get') return { workspace: { id: params.workspaceId, title: 'Space' } };
    });
    const task = runSaga({ dispatch: vi.fn(), getState: () => current }, webNotificationSaga);
    emitMockIpcEvent('agent:idle', idle({}, 'ws-1'));
    emitMockIpcEvent('agent:idle', idle({}, 'ws-2'));
    await flush();
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    resolvePermission('denied'); await flush();
    expect(MockNotification.instances).toEqual([]);
    expect(mocks.sound).toHaveBeenCalledTimes(2);
    task.cancel(); await task.toPromise();
  });

  it('closes active browser notifications, removes the web listener, and honors platform no-ops', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, webNotificationSaga);
    emitMockIpcEvent('agent:idle', idle()); await flush();
    const notification = MockNotification.instances[0];
    task.cancel(); await task.toPromise();
    expect(notification.close.mock.calls).toEqual([[]]);
    emitMockIpcEvent('agent:idle', idle()); await flush();
    expect(MockNotification.instances).toHaveLength(1);

    mocks.platform.mockReturnValue('electron');
    await runSaga({ dispatch: vi.fn(), getState: state }, webNotificationSaga).toPromise();
    mocks.platform.mockReturnValue('web');
    await runSaga({ dispatch: vi.fn(), getState: state }, notificationIpcSaga).toPromise();
    expect(mocks.on.mock.calls).toEqual([]);
  });
});