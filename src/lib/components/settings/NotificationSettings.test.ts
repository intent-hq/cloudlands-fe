/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { runSaga } from 'redux-saga';
import { m } from '$shared/paraglide/messages.js';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  initialState,
  pickNotificationSoundRequested,
  setSoundPath,
  userPreferencesReducer,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { userPreferences: {} },
  play: vi.fn(),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock, createStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createStoreMockModule(
    createAppStoreMock({ state: () => mocks.state, dispatch: mocks.dispatch }),
  );
});
vi.mock('$lib/utils/notification-sound', () => ({ playNotificationSound: mocks.play }));
vi.mock('svelte-fa', async () => ({
  default: (await import('../ui/__tests__/mocks/Fa.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import { pickNotificationSoundWorker } from '$store/renderer/slices/user-preferences/sagas/notification-settings-saga';
import NotificationSettings from './NotificationSettings.svelte';

let nativeInvoke: ReturnType<typeof vi.fn>;
const picker = () =>
  screen.getByRole('button', { name: m.settings_notifications_chooseSound_ariaLabel() });
const reset = () =>
  screen.getByRole('button', { name: m.settings_notifications_clearSound_ariaLabel() });
beforeEach(() => {
  mocks.state.userPreferences = {
    ...initialState,
    soundEnabled: false,
    soundPath: '/old.mp3',
    volume: 0.3,
  };
  mocks.dispatch.mockImplementation((action) => {
    if (action.type === pickNotificationSoundRequested.type) {
      void runSaga({ dispatch: mocks.dispatch }, pickNotificationSoundWorker, action).toPromise();
    }
    mocks.state.userPreferences = userPreferencesReducer(
      mocks.state.userPreferences as typeof initialState,
      action,
    );
    (appStore as unknown as { emitState(): void }).emitState();
  });
  nativeInvoke = vi.fn(mockInvoke);
  vi.stubGlobal('electronAPI', { versions: { electron: '42.0.0' }, invoke: nativeInvoke });
  registerMockIpcHandler('notification:pick-sound', () => ({
    success: true,
    data: '/Users/me/音声.MP3',
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetMockIpcRouter();
});

describe('NotificationSettings', () => {
  it('picks local MP3 while muted, exposes its full path, previews it and clears it', async () => {
    render(NotificationSettings);
    picker().focus();
    expect(document.activeElement).toBe(picker());
    await fireEvent.click(picker());
    await waitFor(() =>
      expect(mocks.state.userPreferences).toMatchObject({
        soundPath: '/Users/me/音声.MP3',
        soundEnabled: false,
      }),
    );
    expect(nativeInvoke).toHaveBeenCalledExactlyOnceWith('notification:pick-sound', {});
    expect(screen.getByText('/Users/me/音声.MP3')).toBeTruthy();
    expect(screen.getByText('音声.MP3')).toBeTruthy();
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_notifications_testSound_ariaLabel() }),
    );
    expect(mocks.play).toHaveBeenLastCalledWith(0.3, '/Users/me/音声.MP3');
    await fireEvent.click(reset());
    expect(mocks.state.userPreferences).toMatchObject({ soundPath: '', soundEnabled: false });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_notifications_testSound_ariaLabel() }),
    );
    expect(mocks.play).toHaveBeenLastCalledWith(0.3, '');
  });

  it('preserves the choice on cancel and surfaces native errors without altering preferences', async () => {
    registerMockIpcHandler('notification:pick-sound', () => ({ success: true, data: null }));
    render(NotificationSettings);
    await fireEvent.click(picker());
    await waitFor(() => expect((picker() as HTMLButtonElement).disabled).toBe(false));
    expect(
      mocks.dispatch.mock.calls.filter(([action]) => action.type === setSoundPath.type),
    ).toEqual([]);
    registerMockIpcHandler('notification:pick-sound', () => ({ success: false }));
    await fireEvent.click(picker());
    await screen.findByRole('alert');
    expect(
      mocks.dispatch.mock.calls.filter(([action]) => action.type === setSoundPath.type),
    ).toEqual([]);
    expect(mocks.state.userPreferences).toMatchObject({ soundPath: '/old.mp3' });
  });

  it('does not offer a broken picker in plain browser mode, including the browser mock', async () => {
    vi.stubGlobal('electronAPI', { versions: { electron: '0.0.0-browser' }, invoke: nativeInvoke });
    render(NotificationSettings);
    expect(
      screen.queryByRole('button', { name: m.settings_notifications_chooseSound_ariaLabel() }),
    ).toBeNull();
    await fireEvent.click(reset());
    expect(nativeInvoke).not.toHaveBeenCalled();
    expect(mocks.state.userPreferences).toMatchObject({ soundPath: '' });
  });
});
