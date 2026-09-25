import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  playSound: vi.fn(),
  listeners: new Set<(notification: { method: string; params?: unknown }) => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  backendSubscribe: async () => ({ subscriptionId: 'notification-test' }),
  backendUnsubscribe: async () => {},
  onBackendNotification: (
    listener: (notification: { method: string; params?: unknown }) => void,
  ) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
  onBackendReconnected: () => () => {},
}));
vi.mock('$lib/utils/notification-sound', () => ({ playNotificationSound: mocks.playSound }));

import { store as appStore } from '$store/renderer/store';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { settingsHydrationSaga } from '$store/renderer/slices/settings-events/sagas/settings-hydration-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { notificationSettingsSaga } from '$store/renderer/slices/user-preferences/sagas/notification-settings-saga';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  resetNotificationSettings,
  setNotificationEnabled,
  setSoundEnabled,
  setVolume,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectNotificationVolume } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { playNotificationSoundPerSettings } from '$features/notifications/notification-sound-gate';
import NotificationSettings from '$lib/components/settings/NotificationSettings.svelte';

const values: Record<string, unknown> = {
  'notifications.enabled': true,
  'notifications.soundEnabled': true,
  'notifications.soundOnlyWhenUnfocused': false,
  'notifications.volume': 0.25,
};

function setting(path: string, value: unknown) {
  return {
    path,
    value,
    label: path,
    description: '',
    category: 'notifications',
    type: typeof value === 'number' ? 'number' : 'boolean',
    origin: 'file',
  };
}

function snapshot(volume = 0.25, revision = 10) {
  return { settings: [setting('notifications.volume', volume)], revision };
}

function getResponse(path: string) {
  const { value, origin, ...definition } = setting(path, values[path]);
  return { value, origin, definition, revision: 10 };
}

function emitVolume(value: unknown, revision: number, subscriptionId = 'notification-test') {
  for (const listener of mocks.listeners) {
    listener({
      method: 'events.event',
      params: {
        subscriptionId,
        event: {
          id: `volume-${revision}`,
          type: 'settings:changed',
          timestamp: '2026-09-25T00:00:00Z',
          data: { changes: [{ path: 'notifications.volume', value }], revision },
        },
      },
    });
  }
}

const volume = () => selectNotificationVolume.select(appStore.state);
const writes = () => mocks.request.mock.calls.filter(([method]) => method === 'settings.update');
let stops: Array<() => void>;

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  flushSync();
}

async function start() {
  stops.push(appStore.runSaga(notificationSettingsSaga));
  stops.push(appStore.runSaga(settingsHydrationSaga));
  stops.push(appStore.runSaga(daemonEventsSaga));
  await settle();
}

describe('notification volume through daemon events and settings hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetSettingsReadCacheForTests();
    stops = [appStore.init()];
    mocks.request.mockImplementation(async (method: string, params?: { path: string }) => {
      if (method === 'settings.list') return snapshot();
      if (method === 'settings.get') return getResponse(params!.path);
      if (method === 'settings.update') return { applied: [], revision: 12 };
      throw new Error(`Unexpected request: ${method}`);
    });
  });

  afterEach(() => {
    cleanup();
    stops.reverse().forEach((stop) => stop());
    vi.useRealTimers();
  });

  it('updates the mounted slider and sound state without writes, then preserves volume on a local toggle', async () => {
    await start();
    render(NotificationSettings);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('25');

    emitVolume(0.75, 11);
    await vi.advanceTimersByTimeAsync(150);
    flushSync();
    expect(volume()).toBe(0.75);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('75');
    await fireEvent.click(screen.getByRole('button', { name: /test.*sound/i }));
    await playNotificationSoundPerSettings();
    expect(mocks.playSound.mock.calls).toEqual([[0.75], [0.75]]);
    expect(writes()).toEqual([]);

    appStore.dispatch(setNotificationEnabled(false));
    await vi.advanceTimersByTimeAsync(100);
    expect(writes()).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'notifications.enabled', value: false },
            { path: 'notifications.soundEnabled', value: true },
            { path: 'notifications.soundOnlyWhenUnfocused', value: false },
            { path: 'notifications.volume', value: 0.75 },
          ],
        },
      ],
    ]);
  });

  it('applies the daemon reset default without an echo and retains it on the next local edit', async () => {
    await start();
    emitVolume(0.75, 11);
    emitVolume(0.5, 12);
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.5);
    expect(writes()).toEqual([]);
    appStore.dispatch(setSoundEnabled(false));
    await vi.advanceTimersByTimeAsync(100);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].changes).toContainEqual({ path: 'notifications.volume', value: 0.5 });
  });

  it('keeps duplicate and older events harmless and rejects another subscription', async () => {
    await start();
    emitVolume(0.75, 11);
    emitVolume(0.75, 11);
    emitVolume(0.1, 10);
    emitVolume(0.2, 20, 'another-backend-subscription');
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.75);
    expect(writes()).toEqual([]);
  });

  it('uses the existing numeric clamp and ignores non-number hydration values', async () => {
    await start();
    emitVolume(2, 11);
    await settle();
    expect(volume()).toBe(1);
    emitVolume(-1, 12);
    await settle();
    expect(volume()).toBe(0);
    emitVolume(0.75, 13);
    for (const [index, invalid] of ['0.1', null, {}, true].entries())
      emitVolume(invalid, 14 + index);
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.75);
    expect(writes()).toEqual([]);
  });

  it('applies a buffered live event after a delayed startup snapshot', async () => {
    let resolveSnapshot!: (value: ReturnType<typeof snapshot>) => void;
    mocks.request.mockImplementation(async (method: string, params?: { path: string }) => {
      if (method === 'settings.list')
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      if (method === 'settings.get') return getResponse(params!.path);
      throw new Error(`Unexpected request: ${method}`);
    });
    await start();
    emitVolume(0.75, 11);
    resolveSnapshot(snapshot());
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.75);
    expect(writes()).toEqual([]);
  });

  it('does not restore stale volume when notification startup reads finish after a live event', async () => {
    const pending: Array<() => void> = [];
    mocks.request.mockImplementation(async (method: string, params?: { path: string }) => {
      if (method === 'settings.list') return snapshot();
      if (method === 'settings.get')
        return new Promise((resolve) => {
          pending.push(() => resolve(getResponse(params!.path)));
        });
      throw new Error(`Unexpected request: ${method}`);
    });
    await start();
    emitVolume(0.75, 11);
    pending.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.75);
    expect(writes()).toEqual([]);
  });

  it('hydrates startup and a newly selected backend without writing back', async () => {
    mocks.request.mockImplementation(async (method: string, params?: { path: string }) => {
      if (method === 'settings.list') return snapshot(0.75, 1);
      if (method === 'settings.get') return getResponse(params!.path);
      throw new Error(`Unexpected request: ${method}`);
    });
    await start();
    expect(volume()).toBe(0.75);
    emitVolume(0.1, 20);
    appStore.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(volume()).toBe(0.75);
    emitVolume(0.5, 2);
    await settle();
    expect(volume()).toBe(0.5);
    expect(writes()).toEqual([]);
  });

  it('still persists user volume edits and resets', async () => {
    await start();
    appStore.dispatch(setVolume(0.9));
    await vi.advanceTimersByTimeAsync(100);
    expect(writes()[0][1].changes).toContainEqual({ path: 'notifications.volume', value: 0.9 });
    appStore.dispatch(resetNotificationSettings());
    await vi.advanceTimersByTimeAsync(100);
    expect(writes()[1][1].changes).toContainEqual({ path: 'notifications.volume', value: 0.5 });
  });

  it('retains a pending local toggle write when volume hydration arrives during the debounce', async () => {
    await start();
    appStore.dispatch(setNotificationEnabled(false));
    await vi.advanceTimersByTimeAsync(50);
    emitVolume(0.75, 11);
    await vi.advanceTimersByTimeAsync(50);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].changes).toContainEqual({ path: 'notifications.enabled', value: false });
    expect(writes()[0][1].changes).toContainEqual({ path: 'notifications.volume', value: 0.75 });
  });
});
