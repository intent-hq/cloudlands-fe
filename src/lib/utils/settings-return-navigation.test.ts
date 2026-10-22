import { runSaga, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { menuIpcSaga } from '$store/renderer/slices/app-layout/sagas/menu-ipc-saga';
import { voiceSettingsToastAction } from '$features/hardware-console/voice/voice-setup-toast';
import { navigateToRoute } from './navigation.client';
import {
  getSettingsPreviousPath,
  navigateBackFromSettings,
  navigateToSettings,
} from './workspace-navigation';

const { workspaceItems } = vi.hoisted(() => ({
  workspaceItems: { value: [] as Array<{ id: string; status: string }> },
}));

vi.mock('$lib/electron-bridge', () => ({ isElectron: () => true }));
vi.mock('$lib/utils/keyboardShortcuts', () => ({ isFocusInTerminal: () => false }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: { select: () => workspaceItems.value },
}));

describe('Settings return navigation', () => {
  let menuTask: Task | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    workspaceItems.value = [
      { id: 'archived', status: 'Archived' },
      { id: 'deleted', status: 'Deleted' },
      { id: 'available', status: 'Active' },
    ];
    window.history.replaceState({}, '', '/workspace/current?selectedNoteId=spec#overview');
    vi.mocked(goto).mockImplementation(async (url) => {
      window.history.pushState({}, '', url);
    });
  });

  afterEach(async () => {
    menuTask?.cancel();
    await menuTask?.toPromise();
    menuTask = undefined;
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.mocked(goto).mockReset();
    vi.restoreAllMocks();
  });

  it.each([null, '/workspace/new', '/workspace/old'])(
    'native-menu Settings replaces previous state %s with the actual origin',
    async (previous) => {
      if (previous) sessionStorage.setItem('settings-previous-path', previous);
      const handlers = new Map<string, (payload: unknown) => void>();
      vi.spyOn(window.electronAPI, 'on').mockImplementation((channel, handler) => {
        handlers.set(channel, handler);
        return `listener:${channel}`;
      });
      menuTask = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, menuIpcSaga);

      handlers.get('navigate')?.('/settings');
      await vi.waitFor(() => expect(window.location.pathname).toBe('/settings'));
      await navigateBackFromSettings();

      expect(goto).toHaveBeenLastCalledWith('/workspace/current?selectedNoteId=spec#overview');
    },
  );

  it('generic Settings deep links preserve their URL and the full return destination', async () => {
    await navigateToRoute('/settings?tab=connections#voice');
    expect(goto).toHaveBeenLastCalledWith('/settings?tab=connections#voice');
    await navigateBackFromSettings();
    expect(goto).toHaveBeenLastCalledWith('/workspace/current?selectedNoteId=spec#overview');
  });

  it('preserves the original destination through all in-app Settings-only navigation', async () => {
    await navigateToSettings({ tab: 'agents', specialist: 'reviewer & co' });
    expect(window.location.search).toBe(
      '?tab=agents&specialist=reviewer+%26+co&workspaceId=current',
    );
    await navigateToSettings({ tab: 'connections' });
    await navigateToSettings({ hash: 'voice' });
    await navigateToSettings();
    await navigateToRoute('/settings?tab=advanced#hardware');
    await navigateBackFromSettings();
    expect(goto).toHaveBeenLastCalledWith('/workspace/current?selectedNoteId=spec#overview');
  });

  it('voice toast from Settings does not replace the original destination', async () => {
    await navigateToSettings();
    voiceSettingsToastAction().onClick();
    await vi.waitFor(() => expect(window.location.hash).toBe('#voice'));
    await navigateBackFromSettings();
    expect(goto).toHaveBeenLastCalledWith('/workspace/current?selectedNoteId=spec#overview');
  });

  it.each([null, '/settings', '/settings?tab=agents#specialists', '/settings/', '/'])(
    'uses an available workspace for missing or unusable origin %s',
    async (previous) => {
      window.history.replaceState({}, '', '/settings');
      if (previous) sessionStorage.setItem('settings-previous-path', previous);
      expect(getSettingsPreviousPath()).toBe('/workspace/available');
      await navigateBackFromSettings();
      expect(goto).toHaveBeenLastCalledWith('/workspace/available');
    },
  );

  it('keeps intentional workspace-creation entry even when a workspace exists', async () => {
    window.history.replaceState({}, '', '/workspace/new');
    await navigateToSettings();
    await navigateBackFromSettings();
    expect(goto).toHaveBeenLastCalledWith('/workspace/new');
  });

  it('uses workspace creation when there are no available workspaces', async () => {
    workspaceItems.value = [{ id: 'archived', status: 'Archived' }];
    window.history.replaceState({}, '', '/settings');
    await navigateBackFromSettings();
    expect(goto).toHaveBeenLastCalledWith('/workspace/new');
  });

  it('HUD Settings requests neither navigate nor change the return destination', async () => {
    await navigateToSettings();
    window.history.replaceState({}, '', '/hud');
    vi.mocked(goto).mockClear();
    await navigateToRoute('/settings');
    await navigateToSettings();
    expect(goto).not.toHaveBeenCalled();
    expect(getSettingsPreviousPath()).toBe('/workspace/current?selectedNoteId=spec#overview');
  });
});
