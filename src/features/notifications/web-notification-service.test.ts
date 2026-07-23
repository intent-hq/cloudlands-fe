import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockGetPlatform, mockPlayNotificationSound, mockBackendRequest } =
  vi.hoisted(() => {
    const mockState = {
      userPreferences: {
        enabled: true,
        soundEnabled: true,
        soundOnlyWhenUnfocused: false,
        volume: 0.5,
      },
      workspace: { activeWorkspaceId: null as string | null },
    };
    return {
      mockState,
      mockAppStore: { state: mockState, dispatch: vi.fn() },
      mockGetPlatform: vi.fn(() => 'web'),
      mockPlayNotificationSound: vi.fn(() => Promise.resolve()),
      mockBackendRequest: vi.fn(),
    };
  });

vi.mock('$store/renderer/store', () => ({
  store: mockAppStore,
}));

vi.mock('$lib/utils/platform-capabilities', () => ({
  getPlatform: mockGetPlatform,
}));

vi.mock('$lib/utils/notification-sound', () => ({
  playNotificationSound: mockPlayNotificationSound,
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mockBackendRequest,
}));

// Import after mocking
import {
  createWebNotificationMiddleware,
  handleWebAgentIdle,
  showTestWebNotification,
  requestWebNotificationPermission,
  __resetWebNotificationServiceForTesting,
} from './web-notification-service';
import { emitMockIpcEvent, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import type { AgentIdleEvent } from '$features/events/types';

/** Mock browser Notification API capturing constructor calls + instances. */
class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => MockNotification.permission);
  static instances: MockNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: { body?: string },
  ) {
    MockNotification.instances.push(this);
  }
}

function makeIdleEvent(overrides: Partial<AgentIdleEvent['data']> = {}, workspaceId = 'ws-1') {
  return {
    type: 'agent:idle',
    workspaceId,
    timestamp: new Date().toISOString(),
    data: { agentId: 'agent-1', agentName: 'My Agent', ...overrides },
  } as unknown as AgentIdleEvent;
}

/** agent.list result where only the idle agent exists (no suppression). */
const SOLO_AGENT_LIST = {
  agents: [{ id: 'agent-1', isStreaming: false, isResponding: false, metadata: {} }],
};

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('web-notification-service', () => {
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetWebNotificationServiceForTesting();
    resetMockIpcRouter();
    mockGetPlatform.mockReturnValue('web');
    mockState.userPreferences.enabled = true;
    mockState.userPreferences.soundEnabled = true;
    mockState.userPreferences.soundOnlyWhenUnfocused = false;
    mockState.userPreferences.volume = 0.5;
    mockState.workspace.activeWorkspaceId = null;
    MockNotification.permission = 'granted';
    MockNotification.instances = [];
    MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
    vi.stubGlobal('Notification', MockNotification);
    mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.list') return SOLO_AGENT_LIST;
      if (method === 'workspace.get') return { workspace: { title: 'My Workspace' } };
      return undefined;
    });
    hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    vi.unstubAllGlobals();
    resetMockIpcRouter();
  });

  describe('middleware installation', () => {
    it('listens on the relayed agent:idle channel on web', async () => {
      const middleware = createWebNotificationMiddleware();
      const next = vi.fn((action) => action);
      middleware({} as never)(next)({ type: 'boot' });

      emitMockIpcEvent('agent:idle', makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('registers nothing on electron (native pipeline unchanged)', async () => {
      mockGetPlatform.mockReturnValue('electron');
      const middleware = createWebNotificationMiddleware();
      const next = vi.fn((action) => action);
      middleware({} as never)(next)({ type: 'boot' });

      emitMockIpcEvent('agent:idle', makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('does not request permission at boot (lazy request only)', () => {
      MockNotification.permission = 'default';
      const middleware = createWebNotificationMiddleware();
      const next = vi.fn((action) => action);
      middleware({} as never)(next)({ type: 'boot' });

      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('passes through all actions', () => {
      const middleware = createWebNotificationMiddleware();
      const next = vi.fn((action) => action);
      const action = { type: 'test/action' };
      expect(middleware({} as never)(next)(action)).toBe(action);
      expect(next).toHaveBeenCalledWith(action);
    });
  });

  describe('trigger conditions (Electron NotificationService parity)', () => {
    it('shows a notification with the Electron title/body format', async () => {
      await handleWebAgentIdle(makeIdleEvent({ specialist: 'implementor', taskTitle: 'Fix bug' }));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('My Workspace - Implementor: Fix bug');
      expect(MockNotification.instances[0].options?.body).toBe('Task completed');
    });

    it('falls back to "Agent"/"Finished" without specialist/taskTitle/workspace title', async () => {
      mockBackendRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') return SOLO_AGENT_LIST;
        if (method === 'workspace.get') return { workspace: {} };
        return undefined;
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances[0].title).toBe('Agent');
      expect(MockNotification.instances[0].options?.body).toBe('Finished');
    });

    it('skips when notifications are disabled (store fallback)', async () => {
      mockState.userPreferences.enabled = false;
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest).not.toHaveBeenCalledWith('agent.list', expect.anything());
    });

    it('prefers fresh daemon notifications.enabled over the store (refreshPrefs parity)', async () => {
      mockState.userPreferences.enabled = true;
      mockBackendRequest.mockImplementation(async (method: string, params?: unknown) => {
        if (method === 'settings.get') {
          const path = (params as { path?: string })?.path;
          if (path === 'notifications.enabled') return { value: false };
          return {};
        }
        if (method === 'agent.list') return SOLO_AGENT_LIST;
        return undefined;
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('skips background agents (event fast path)', async () => {
      await handleWebAgentIdle(makeIdleEvent({ isBackground: true }));

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockBackendRequest).not.toHaveBeenCalledWith('agent.list', expect.anything());
    });

    it('skips background agents (agent.list metadata)', async () => {
      mockBackendRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') {
          return { agents: [{ id: 'agent-1', metadata: { isBackground: true } }] };
        }
        return undefined;
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('skips when other agents are still active in the workspace', async () => {
      mockBackendRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') {
          return {
            agents: [
              { id: 'agent-1', metadata: {} },
              { id: 'agent-2', isStreaming: true },
            ],
          };
        }
        return undefined;
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('enriches specialist from agent.list metadata when the payload lacks it', async () => {
      mockBackendRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') {
          return { agents: [{ id: 'agent-1', metadata: { specialist: 'verifier' } }] };
        }
        if (method === 'workspace.get') return { workspace: { title: 'WS' } };
        return undefined;
      });
      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances[0].title).toBe('WS - Verifier');
    });

    it('titles chief completions with the chat thread name and skips workspace.get', async () => {
      await handleWebAgentIdle(
        makeIdleEvent({ agentName: 'Morning check-in' }, CHIEF_WORKSPACE_ID),
      );

      expect(MockNotification.instances[0].title).toBe('Assistant — Morning check-in');
      expect(mockBackendRequest).not.toHaveBeenCalledWith('workspace.get', expect.anything());
    });

    it('suppresses the banner when focused viewing the workspace with soundOnlyWhenUnfocused (sound gate still runs and declines while focused)', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      mockState.workspace.activeWorkspaceId = 'ws-1';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(0);
      // Electron parity: notification:show is still sent, but the renderer
      // sound gate itself skips playback while focused with this setting on.
      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it('shows the banner when focused on a DIFFERENT workspace with soundOnlyWhenUnfocused', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      mockState.workspace.activeWorkspaceId = 'ws-other';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('shows the banner when focused viewing the workspace with soundOnlyWhenUnfocused OFF', async () => {
      mockState.workspace.activeWorkspaceId = 'ws-1';
      hasFocusSpy.mockReturnValue(true);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  describe('permission gating', () => {
    it('requests permission lazily at the first notification attempt', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('degrades silently when permission is denied (sound still plays)', async () => {
      MockNotification.permission = 'denied';

      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(MockNotification.instances).toHaveLength(0);
      expect(mockPlayNotificationSound).toHaveBeenCalled();
    });

    it('degrades silently when the user dismisses the request (stays default)', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => 'default' as NotificationPermission);

      await handleWebAgentIdle(makeIdleEvent());

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('coalesces concurrent permission prompts into one requestPermission call', async () => {
      MockNotification.permission = 'default';
      let resolvePrompt!: (value: NotificationPermission) => void;
      MockNotification.requestPermission = vi.fn(
        () => new Promise<NotificationPermission>((resolve) => (resolvePrompt = resolve)),
      );

      const first = handleWebAgentIdle(makeIdleEvent());
      const second = handleWebAgentIdle(makeIdleEvent({ agentId: 'agent-1' }, 'ws-2'));
      await flushAsync();
      resolvePrompt('granted');
      await Promise.all([first, second]);

      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances).toHaveLength(2);
    });
  });

  describe('click navigation', () => {
    it('focuses the tab and navigates to the workspace on click', async () => {
      const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
      await handleWebAgentIdle(makeIdleEvent());

      MockNotification.instances[0].onclick?.();
      await flushAsync();

      expect(focusSpy).toHaveBeenCalled();
      expect(goto).toHaveBeenCalledWith('/workspace/ws-1');
      expect(MockNotification.instances[0].close).toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it('opens the Assistant panel and selects the thread for chief clicks', async () => {
      vi.spyOn(window, 'focus').mockImplementation(() => {});
      await handleWebAgentIdle(makeIdleEvent({ agentName: 'Chat' }, CHIEF_WORKSPACE_ID));

      MockNotification.instances[0].onclick?.();
      await flushAsync();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('agent-1'));
      expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
      expect(goto).not.toHaveBeenCalled();
    });
  });

  describe('sound settings matrix', () => {
    it('plays at the configured volume', async () => {
      mockState.userPreferences.volume = 0.8;
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.8);
    });

    it('does not play when soundEnabled is off (banner still shows)', async () => {
      mockState.userPreferences.soundEnabled = false;
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('does not play when soundOnlyWhenUnfocused is on and the document has focus', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(true);
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it('plays when soundOnlyWhenUnfocused is on and the document is unfocused', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(false);
      await handleWebAgentIdle(makeIdleEvent());
      await flushAsync();

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });
  });

  describe('test notification + permission envelopes', () => {
    it('showTestWebNotification shows the Electron-parity test payload', async () => {
      const result = await showTestWebNotification();

      expect(result).toEqual({ success: true });
      expect(MockNotification.instances[0].title).toBe('Agent');
      expect(MockNotification.instances[0].options?.body).toBe('Test notification');
    });

    it('showTestWebNotification folds a denied permission to a shaped failure', async () => {
      MockNotification.permission = 'denied';
      const result = await showTestWebNotification();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('requestWebNotificationPermission returns { success, granted } envelopes', async () => {
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: true });

      __resetWebNotificationServiceForTesting();
      MockNotification.permission = 'denied';
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: false });
    });

    it('requestWebNotificationPermission surfaces a thrown requestPermission as { success: false, error }', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => {
        throw new Error('prompt already in progress');
      });

      expect(await requestWebNotificationPermission()).toEqual({
        success: false,
        error: 'prompt already in progress',
      });
    });
  });
});
