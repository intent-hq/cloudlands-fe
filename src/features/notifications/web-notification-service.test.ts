import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockPlayNotificationSound } = vi.hoisted(() => ({
  mockState: {
    userPreferences: {
      enabled: true,
      soundEnabled: true,
      soundOnlyWhenUnfocused: false,
      volume: 0.5,
    },
  },
  mockPlayNotificationSound: vi.fn(() => Promise.resolve()),
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: mockState, dispatch: vi.fn() },
}));

vi.mock('$lib/utils/notification-sound', () => ({
  playNotificationSound: mockPlayNotificationSound,
}));

import {
  showTestWebNotification,
  requestWebNotificationPermission,
  __resetWebNotificationServiceForTesting,
} from './web-notification-service';

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
    public options?: { body?: string; tag?: string },
  ) {
    MockNotification.instances.push(this);
  }
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('web-notification-service', () => {
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetWebNotificationServiceForTesting();
    MockNotification.permission = 'granted';
    MockNotification.instances = [];
    MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
    vi.stubGlobal('Notification', MockNotification);
    hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  describe('test notification', () => {
    it('shows the Electron-parity test payload without a tag and plays the sound', async () => {
      const result = await showTestWebNotification();
      await flushAsync();

      expect(result).toEqual({ success: true });
      expect(MockNotification.instances[0].title).toBe('Agent');
      expect(MockNotification.instances[0].options?.body).toBe('Test notification');
      expect(MockNotification.instances[0].options).not.toHaveProperty('tag');
      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it('requests permission lazily on the first attempt', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

      expect(await showTestWebNotification()).toEqual({ success: true });
      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('folds a denied permission to a shaped failure', async () => {
      MockNotification.permission = 'denied';
      const result = await showTestWebNotification();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(MockNotification.instances).toHaveLength(0);
    });

    it('focuses the tab and closes the notification on click', async () => {
      const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
      await showTestWebNotification();

      MockNotification.instances[0].onclick?.();

      expect(focus).toHaveBeenCalledTimes(1);
      expect(MockNotification.instances[0].close).toHaveBeenCalledTimes(1);
      focus.mockRestore();
    });
  });

  describe('permission request', () => {
    it('returns { success, granted } envelopes', async () => {
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: true });

      __resetWebNotificationServiceForTesting();
      MockNotification.permission = 'denied';
      expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: false });
    });

    it('surfaces a thrown requestPermission as { success: false, error }', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn(async () => {
        throw new Error('prompt already in progress');
      });

      expect(await requestWebNotificationPermission()).toEqual({
        success: false,
        error: 'prompt already in progress',
      });
    });

    it('coalesces concurrent prompts into one requestPermission call', async () => {
      MockNotification.permission = 'default';
      let resolvePrompt!: (value: NotificationPermission) => void;
      MockNotification.requestPermission = vi.fn(
        () => new Promise<NotificationPermission>((resolve) => (resolvePrompt = resolve)),
      );

      const first = requestWebNotificationPermission();
      const second = showTestWebNotification();
      await flushAsync();
      resolvePrompt('granted');

      expect(await first).toEqual({ success: true, granted: true });
      expect(await second).toEqual({ success: true });
      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    });
  });
});
