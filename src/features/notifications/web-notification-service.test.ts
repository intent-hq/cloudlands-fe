import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSound = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('./notification-sound-gate', () => ({
  playNotificationSoundPerSettings: mockSound,
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

// Import after mocking
import {
  __resetWebNotificationServiceForTesting,
  requestWebNotificationPermission,
  showTestWebNotification,
} from './web-notification-service';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => MockNotification.permission);
  static instances: MockNotification[] = [];
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public title: string,
    public options?: { body?: string },
  ) {
    MockNotification.instances.push(this);
  }
}

describe('web notification bridge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSettingsReadCacheForTests();
    __resetWebNotificationServiceForTesting();
    MockNotification.permission = 'granted';
    MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
    MockNotification.instances = [];
    vi.stubGlobal('Notification', MockNotification);
  });

  it('shows the test notification after permission is granted', async () => {
    expect(await showTestWebNotification()).toEqual({ success: true });
    expect(MockNotification.instances).toEqual([
      expect.objectContaining({ title: 'Agent', options: { body: 'Test notification' } }),
    ]);
    expect(mockSound).toHaveBeenCalledTimes(1);
  });

  it('returns a shaped failure when permission is denied', async () => {
    MockNotification.permission = 'denied';
    expect(await showTestWebNotification()).toEqual({
      success: false,
      error: expect.any(String),
    });
    expect(MockNotification.instances).toEqual([]);
  });

  it('returns granted and denied permission envelopes', async () => {
    expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: true });
    __resetWebNotificationServiceForTesting();
    MockNotification.permission = 'denied';
    expect(await requestWebNotificationPermission()).toEqual({ success: true, granted: false });
  });

  it('surfaces a permission request failure', async () => {
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
