import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockIsElectron, mockPlayNotificationSound, mockToast } =
  vi.hoisted(() => {
    const mockState = {
      userPreferences: {
        enabled: true,
        soundEnabled: true,
        soundOnlyWhenUnfocused: false,
        volume: 0.5,
      },
    };
    return {
      mockState,
      mockAppStore: { state: mockState, dispatch: vi.fn() },
      mockIsElectron: vi.fn(() => true),
      mockPlayNotificationSound: vi.fn(() => Promise.resolve()),
      mockToast: vi.fn(),
    };
  });

vi.mock('$store/renderer/store', () => ({
  store: mockAppStore,
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: mockIsElectron,
}));

vi.mock('$lib/utils/notification-sound', () => ({
  playNotificationSound: mockPlayNotificationSound,
}));

vi.mock('svelte-sonner', () => ({
  toast: mockToast,
}));

// Wrap the real navigation routing in a spy so tests can assert the exact
// payload handed to handleNotificationNavigate while keeping its behavior.
vi.mock('$features/notifications/notification-navigation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$features/notifications/notification-navigation')>();
  return {
    ...actual,
    handleNotificationNavigate: vi.fn(actual.handleNotificationNavigate),
  };
});

// Import after mocking
import { createNotificationIpcMiddleware } from './notification-ipc-service';
import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

describe('createNotificationIpcMiddleware', () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  const setupMiddleware = () => {
    const middleware = createNotificationIpcMiddleware();
    middleware({} as any)(next);
    const showHandler = mockOn.mock.calls.find((c) => c[0] === 'notification:show')?.[1];
    const navigateHandler = mockOn.mock.calls.find((c) => c[0] === 'notification:navigate')?.[1];
    return { showHandler, navigateHandler };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    mockState.userPreferences.soundEnabled = true;
    mockState.userPreferences.soundOnlyWhenUnfocused = false;
    mockState.userPreferences.volume = 0.5;
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => 'listener-id-123');
    (window as any).electronAPI = { on: mockOn };
    hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    delete (window as any).electronAPI;
  });

  it('registers notification:show and notification:navigate listeners on creation', () => {
    setupMiddleware();

    expect(mockOn).toHaveBeenCalledWith('notification:show', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('notification:navigate', expect.any(Function));
  });

  it('does not register listeners outside Electron', () => {
    mockIsElectron.mockReturnValue(false);
    setupMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  describe('notification:show (sound gate)', () => {
    it('plays the sound at the configured volume when sound is enabled', async () => {
      mockState.userPreferences.volume = 0.8;
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.8);
    });

    it('does not play the sound when soundEnabled is off', async () => {
      mockState.userPreferences.soundEnabled = false;
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it('does not play the sound when soundOnlyWhenUnfocused is on and document has focus', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(true);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it('plays the sound when soundOnlyWhenUnfocused is on and document is unfocused', async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(false);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it('plays the sound while focused when soundOnlyWhenUnfocused is off', async () => {
      hasFocusSpy.mockReturnValue(true);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it('swallows sound playback failures', async () => {
      mockPlayNotificationSound.mockRejectedValueOnce(new Error('boom'));
      const { showHandler } = setupMiddleware();

      await expect(showHandler({ title: 'Agent' })).resolves.toBeUndefined();
    });
  });

  describe('notification:show (frontmost in-app toast)', () => {
    const clickToastAction = async () => {
      const options = mockToast.mock.calls[0][1] as {
        action: { label: string; onClick: () => void };
      };
      options.action.onClick();
      await vi.mocked(handleNotificationNavigate).mock.results[0].value;
    };

    it('shows a toast with the notification title/body when navigateTarget is present', async () => {
      const { showHandler } = setupMiddleware();

      await showHandler({
        title: 'Agent',
        body: 'Finished',
        timestamp: 't',
        navigateTarget: { workspaceId: 'ws-123' },
      });

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        'Agent',
        expect.objectContaining({
          description: 'Finished',
          action: expect.objectContaining({
            label: expect.any(String),
            onClick: expect.any(Function),
          }),
        }),
      );
      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it('does not show a toast when navigateTarget is absent', async () => {
      const { showHandler } = setupMiddleware();

      await showHandler({ title: 'Agent', body: 'Finished', timestamp: 't' });

      expect(mockToast).not.toHaveBeenCalled();
      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it('clicking the toast action navigates with the exact payload', async () => {
      const { showHandler } = setupMiddleware();

      await showHandler({
        title: 'Agent',
        body: 'Finished',
        timestamp: 't',
        navigateTarget: { workspaceId: 'ws-123' },
      });
      await clickToastAction();

      expect(handleNotificationNavigate).toHaveBeenCalledWith({ workspaceId: 'ws-123' });
      expect(goto).toHaveBeenCalledWith('/workspace/ws-123');
    });

    it('clicking a chief toast opens the Assistant panel with the thread selected', async () => {
      const { showHandler } = setupMiddleware();

      await showHandler({
        title: 'Assistant',
        body: 'Finished',
        timestamp: 't',
        navigateTarget: {
          workspaceId: CHIEF_WORKSPACE_ID,
          chief: true,
          agentId: 'chief-agent-1',
        },
      });
      await clickToastAction();

      expect(handleNotificationNavigate).toHaveBeenCalledWith({
        workspaceId: CHIEF_WORKSPACE_ID,
        chief: true,
        agentId: 'chief-agent-1',
      });
      expect(mockAppStore.dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('chief-agent-1'));
      expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
      expect(goto).not.toHaveBeenCalled();
    });

    it('still shows the toast when the sound gate suppresses the sound', async () => {
      mockState.userPreferences.soundEnabled = false;
      const { showHandler } = setupMiddleware();

      await showHandler({
        title: 'Agent',
        body: 'Finished',
        timestamp: 't',
        navigateTarget: { workspaceId: 'ws-123' },
      });

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledTimes(1);
    });
  });

  describe('notification:navigate', () => {
    it('navigates to the emitting workspace', async () => {
      const { navigateHandler } = setupMiddleware();

      await navigateHandler({ workspaceId: 'ws-123' });

      expect(goto).toHaveBeenCalledWith('/workspace/ws-123');
    });

    it('ignores payloads without a workspaceId', async () => {
      const { navigateHandler } = setupMiddleware();

      await navigateHandler({});
      await navigateHandler(undefined);
      await navigateHandler(null);

      expect(goto).not.toHaveBeenCalled();
    });

    it('swallows navigation failures', async () => {
      vi.mocked(goto).mockRejectedValueOnce(new Error('nav failed'));
      const { navigateHandler } = setupMiddleware();

      await expect(navigateHandler({ workspaceId: 'ws-123' })).resolves.toBeUndefined();
    });

    describe('chief-of-staff payloads', () => {
      it('opens the Assistant panel and selects the thread instead of navigating', async () => {
        const { navigateHandler } = setupMiddleware();

        await navigateHandler({
          workspaceId: CHIEF_WORKSPACE_ID,
          chief: true,
          agentId: 'chief-agent-1',
        });

        expect(mockAppStore.dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('chief-agent-1'));
        expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
        expect(goto).not.toHaveBeenCalled();
      });

      it('opens the Assistant panel without thread selection when agentId is missing', async () => {
        const { navigateHandler } = setupMiddleware();

        await navigateHandler({ workspaceId: CHIEF_WORKSPACE_ID, chief: true });

        expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
        expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
        expect(goto).not.toHaveBeenCalled();
      });

      it('treats the chief virtual workspace id as chief even without the flag', async () => {
        const { navigateHandler } = setupMiddleware();

        await navigateHandler({ workspaceId: CHIEF_WORKSPACE_ID });

        expect(mockAppStore.dispatch).toHaveBeenCalledWith(openPanel('chief'));
        expect(goto).not.toHaveBeenCalled();
      });

      it('swallows dispatch failures', async () => {
        mockAppStore.dispatch.mockImplementationOnce(() => {
          throw new Error('dispatch boom');
        });
        const { navigateHandler } = setupMiddleware();

        await expect(
          navigateHandler({ workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'a-1' }),
        ).resolves.toBeUndefined();
        expect(goto).not.toHaveBeenCalled();
      });

      it('non-chief payloads still navigate to the workspace route (regression)', async () => {
        const { navigateHandler } = setupMiddleware();

        await navigateHandler({ workspaceId: 'ws-regular' });

        expect(goto).toHaveBeenCalledWith('/workspace/ws-regular');
        expect(mockAppStore.dispatch).not.toHaveBeenCalled();
      });
    });
  });

  it('passes through all actions', () => {
    const middleware = createNotificationIpcMiddleware();
    const chain = middleware({} as any)(next);

    const action = { type: 'test/action' };
    const result = chain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
