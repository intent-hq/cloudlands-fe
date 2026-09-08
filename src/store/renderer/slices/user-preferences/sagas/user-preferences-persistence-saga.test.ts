import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  applyLanguagePreference: vi.fn(),
  isElectron: vi.fn(() => true),
}));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getJSON: mocks.getJSON,
    getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
    setJSON: mocks.setJSON,
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    keysWithPrefix: vi.fn(),
  },
}));
vi.mock('$lib/i18n/locale', () => ({
  applyLanguagePreference: mocks.applyLanguagePreference,
  resolvePreferenceToLocale: vi.fn(),
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));

import {
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  hydrateActivityLogPresets,
  hydrateShortcutOverrides,
  initialState,
  saveActivityLogPreset,
  setAgentFontStyle,
  setChatAuroraEnabled,
  setCodeFontFamily,
  setGroupByRepo,
  setGithubLinkDefaultAction,
  setHasCompletedProviderSetup,
  setLanguagePreference,
  setNoteFontStyle,
  setShowArchived,
  setShowReasoningBlocks,
  setShellTransparencyEnabled,
  setShortcutOverride,
  setSpellcheckEnabled,
  setSystemFonts,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleChatAurora,
  toggleShowArchived,
  toggleShowReasoningBlocks,
  toggleShellTransparency,
  toggleSpellcheck,
  userPreferencesReducer,
} from '../user-preferences-slice';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  hydrateUserPreferencesWorker,
  loadSystemFontsWorker,
  persistLanguagePreferenceWorker,
  userPreferencesPersistenceSaga,
} from './user-preferences-persistence-saga';

const preset = {
  name: 'Errors',
  filters: {
    showFileChanges: true,
    showAgentActivity: false,
    showSystemEvents: true,
    showErrors: true,
    searchQuery: 'error',
    dateRange: 'today',
    actorFilter: '',
  },
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startPreferenceStore() {
  const channel = stdChannel();
  let userPreferences = initialState;
  const dispatch = (action: unknown) => {
    userPreferences = userPreferencesReducer(userPreferences, action as never);
    channel.put(action as never);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ userPreferences }) },
    userPreferencesPersistenceSaga,
  );
  return {
    dispatch,
    getUserPreferences: () => userPreferences,
    stop: async () => {
      task.cancel();
      await task.toPromise();
    },
  };
}

describe('userPreferencesPersistenceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isElectron.mockReturnValue(true);
    mocks.getJSON.mockReturnValue(undefined);
    mocks.setJSON.mockReturnValue(undefined);
    vi.mocked(window.electronAPI.invoke).mockReset();
    vi.mocked(window.electronAPI.invoke).mockResolvedValue({
      success: false,
      error: 'not available',
    });
  });

  it('loads system fonts at startup through the exact IPC request', async () => {
    const fonts = ['Helvetica Neue', 'JetBrains Mono', 'Cascadia Code'];
    vi.mocked(window.electronAPI.invoke).mockResolvedValue({ success: true, data: fonts });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: () => ({}) }, userPreferencesPersistenceSaga);
    await settle();

    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([
      [SYSTEM_CHANNELS.LIST_FONTS, undefined],
    ]);
    expect(dispatch.mock.calls).toEqual([[setSystemFonts(fonts)]]);
    task.cancel();
    await task.toPromise();
  });

  it('skips system font IPC outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: () => ({}) }, loadSystemFontsWorker).toPromise();

    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([]);
    expect(dispatch.mock.calls).toEqual([]);
  });

  it('keeps failed system font loading paths non-fatal', async () => {
    const dispatch = vi.fn();
    vi.mocked(window.electronAPI.invoke).mockResolvedValueOnce({ success: false, error: 'closed' });
    await runSaga({ dispatch, getState: () => ({}) }, loadSystemFontsWorker).toPromise();

    vi.mocked(window.electronAPI.invoke).mockResolvedValueOnce({
      success: true,
      data: ['Mono', 42],
    });
    await runSaga({ dispatch, getState: () => ({}) }, loadSystemFontsWorker).toPromise();

    vi.mocked(window.electronAPI.invoke).mockRejectedValueOnce(new Error('closed'));
    await runSaga({ dispatch, getState: () => ({}) }, loadSystemFontsWorker).toPromise();

    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([
      [SYSTEM_CHANNELS.LIST_FONTS, undefined],
      [SYSTEM_CHANNELS.LIST_FONTS, undefined],
      [SYSTEM_CHANNELS.LIST_FONTS, undefined],
    ]);
    expect(dispatch.mock.calls).toEqual([]);
  });

  it('hydrates every valid legacy storage shape exactly once', async () => {
    const stored: Record<string, unknown> = {
      'note-spellcheck-settings': { enabled: true },
      'workspace-list:showArchived': true,
      'workspace-list:groupByRepo': false,
      'workspace-list:completedProviderSetup': true,
      'chat:showReasoningBlocks': true,
      'chat:auroraEnabled': false,
      'appearance:shellTransparencyEnabled': false,
      'agent-font-settings': { fontStyle: 'monospace' },
      'note-font-settings': { fontStyle: 'sans' },
      'code-font-settings': { fontFamily: 'Monaco' },
      activityLogPresets: [preset],
      'language-preference': 'de',
      'github-links:defaultAction': 'copy-link',
    };
    mocks.getJSON.mockImplementation((key: string) => stored[key]);
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUserPreferencesWorker).toPromise();

    expect(mocks.getJSON.mock.calls).toEqual([
      ...Object.keys(stored).map((key) => [key]),
      ['keyboard-shortcut-overrides'],
    ]);
    expect(dispatch.mock.calls).toEqual([
      [setSpellcheckEnabled(true)],
      [setShowArchived(true)],
      [setGroupByRepo(false)],
      [setHasCompletedProviderSetup(true)],
      [setShowReasoningBlocks(true)],
      [setChatAuroraEnabled(false)],
      [setShellTransparencyEnabled(false)],
      [setAgentFontStyle('monospace')],
      [setNoteFontStyle('sans')],
      [setCodeFontFamily('Monaco')],
      [hydrateActivityLogPresets([preset])],
      [setLanguagePreference('de')],
      [setGithubLinkDefaultAction('copy-link')],
    ]);
    expect(mocks.applyLanguagePreference.mock.calls).toEqual([]);
  });

  it('persists an agent font action and restores it in a fresh store', async () => {
    const stored: Record<string, unknown> = {};
    mocks.getJSON.mockImplementation((key: string) => stored[key]);
    mocks.setJSON.mockImplementation((key: string, value: unknown) => {
      stored[key] = value;
    });
    const first = startPreferenceStore();
    await settle();

    first.dispatch(setAgentFontStyle('monospace'));
    await settle();
    expect(stored['agent-font-settings']).toEqual({ fontStyle: 'monospace' });
    await first.stop();

    const fresh = startPreferenceStore();
    await settle();
    expect(fresh.getUserPreferences().agentFontStyle).toBe('monospace');
    await fresh.stop();
  });

  it('persists a note font cycle and restores serif in a fresh store', async () => {
    const stored: Record<string, unknown> = {};
    mocks.getJSON.mockImplementation((key: string) => stored[key]);
    mocks.setJSON.mockImplementation((key: string, value: unknown) => {
      stored[key] = value;
    });
    const first = startPreferenceStore();
    await settle();

    first.dispatch(cycleNoteFontStyle());
    await settle();
    expect(first.getUserPreferences().noteFontStyle).toBe('serif');
    expect(stored['note-font-settings']).toEqual({ fontStyle: 'serif' });
    await first.stop();

    const fresh = startPreferenceStore();
    await settle();
    expect(fresh.getUserPreferences().noteFontStyle).toBe('serif');
    await fresh.stop();
  });

  it('persists a code font action and restores it in a fresh store', async () => {
    const stored: Record<string, unknown> = {};
    mocks.getJSON.mockImplementation((key: string) => stored[key]);
    mocks.setJSON.mockImplementation((key: string, value: unknown) => {
      stored[key] = value;
    });
    const first = startPreferenceStore();
    await settle();

    first.dispatch(setCodeFontFamily('JetBrains Mono'));
    await settle();
    expect(stored['code-font-settings']).toEqual({ fontFamily: 'JetBrains Mono' });
    await first.stop();

    const fresh = startPreferenceStore();
    await settle();
    expect(fresh.getUserPreferences().codeFontFamily).toBe('JetBrains Mono');
    await fresh.stop();
  });

  it('ignores missing and malformed stored values', async () => {
    mocks.getJSON.mockImplementation((key: string) => {
      if (key === 'note-spellcheck-settings') return { enabled: 'yes' };
      if (key === 'agent-font-settings') return { fontStyle: 'serif' };
      if (key === 'activityLogPresets') return [{ name: 1, filters: null }];
      if (key === 'language-preference') return ' ';
      if (key === 'github-links:defaultAction') return 'launch-missiles';
      return undefined;
    });
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUserPreferencesWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
  });

  it('hydrates and persists shortcut overrides through the preference storage', async () => {
    mocks.getJSON.mockImplementation((key: string) =>
      key === 'keyboard-shortcut-overrides'
        ? { 'global.settings': 'mod+shift+,', invalid: 'mod+x' }
        : undefined,
    );
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: () => ({}) }, hydrateUserPreferencesWorker).toPromise();
    expect(dispatch.mock.calls).toContainEqual([
      hydrateShortcutOverrides({ 'global.settings': 'mod+shift+,', invalid: 'mod+x' }),
    ]);

    const channel = stdChannel();
    const state = {
      userPreferences: { shortcutOverrides: { 'global.settings': 'mod+shift+,' } },
    };
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state },
      userPreferencesPersistenceSaga,
    );
    await settle();
    mocks.setJSON.mockClear();
    channel.put(setShortcutOverride('global.settings', 'mod+shift+,'));
    await settle();
    expect(mocks.setJSON.mock.calls).toEqual([
      ['keyboard-shortcut-overrides', { 'global.settings': 'mod+shift+,' }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists every audited trigger using exact legacy keys and post-state values', async () => {
    const state = {
      userPreferences: {
        spellcheckEnabled: true,
        showArchived: true,
        groupByRepo: false,
        hasCompletedProviderSetup: true,
        showReasoningBlocks: true,
        chatAuroraEnabled: false,
        shellTransparencyEnabled: false,
        agentFontStyle: 'monospace',
        noteFontStyle: 'sans',
        codeFontFamily: 'Monaco',
        activityLogPresets: [preset],
        languagePreference: 'de',
        githubLinkDefaultAction: 'start-workspace',
      },
    };
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state },
      userPreferencesPersistenceSaga,
    );
    await settle();
    mocks.setJSON.mockClear();
    vi.mocked(window.electronAPI.invoke).mockClear();

    const actions = [
      setSpellcheckEnabled(true),
      toggleSpellcheck(),
      setShowArchived(true),
      toggleShowArchived(),
      setGroupByRepo(false),
      toggleGroupByRepo(),
      setHasCompletedProviderSetup(true),
      toggleHasCompletedProviderSetup(),
      setShowReasoningBlocks(true),
      toggleShowReasoningBlocks(),
      setChatAuroraEnabled(false),
      toggleChatAurora(),
      setShellTransparencyEnabled(false),
      toggleShellTransparency(),
      setAgentFontStyle('monospace'),
      setNoteFontStyle('sans'),
      cycleNoteFontStyle(),
      setCodeFontFamily('Monaco'),
      saveActivityLogPreset(preset),
      deleteActivityLogPreset(0),
      setLanguagePreference('de'),
      setGithubLinkDefaultAction('start-workspace'),
    ];
    for (const action of actions) {
      channel.put(action);
      await settle();
    }

    expect(mocks.setJSON.mock.calls).toEqual([
      ['note-spellcheck-settings', { enabled: true }],
      ['note-spellcheck-settings', { enabled: true }],
      ['workspace-list:showArchived', true],
      ['workspace-list:showArchived', true],
      ['workspace-list:groupByRepo', false],
      ['workspace-list:groupByRepo', false],
      ['workspace-list:completedProviderSetup', true],
      ['workspace-list:completedProviderSetup', true],
      ['chat:showReasoningBlocks', true],
      ['chat:showReasoningBlocks', true],
      ['chat:auroraEnabled', false],
      ['chat:auroraEnabled', false],
      ['appearance:shellTransparencyEnabled', false],
      ['appearance:shellTransparencyEnabled', false],
      ['agent-font-settings', { fontStyle: 'monospace' }],
      ['note-font-settings', { fontStyle: 'sans' }],
      ['note-font-settings', { fontStyle: 'sans' }],
      ['code-font-settings', { fontFamily: 'Monaco' }],
      ['activityLogPresets', [preset]],
      ['activityLogPresets', [preset]],
      ['language-preference', 'de'],
      ['github-links:defaultAction', 'start-workspace'],
    ]);
    expect(mocks.applyLanguagePreference.mock.calls).toEqual([['de']]);
    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([
      ['app:set-language-preference', { preference: 'de' }],
    ]);
    task.cancel();
    await task.toPromise();
  });
  it('skips main-process language IPC outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await runSaga(
      {
        dispatch: vi.fn(),
        getState: () => ({ userPreferences: { languagePreference: 'system' } }),
      },
      persistLanguagePreferenceWorker,
      setLanguagePreference('system'),
    ).toPromise();

    expect(mocks.applyLanguagePreference.mock.calls).toEqual([['system']]);
    expect(mocks.setJSON.mock.calls).toEqual([['language-preference', 'system']]);
    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([]);
  });

  it('cancels an active main-process language IPC call without late work', async () => {
    let resolve!: () => void;
    vi.mocked(window.electronAPI.invoke).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const task = runSaga(
      {
        dispatch: vi.fn(),
        getState: () => ({ userPreferences: { languagePreference: 'de' } }),
      },
      persistLanguagePreferenceWorker,
      setLanguagePreference('de'),
    );
    await settle();

    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([
      ['app:set-language-preference', { preference: 'de' }],
    ]);
    task.cancel();
    resolve();
    await task.toPromise();
    await settle();

    expect(task.isCancelled()).toBe(true);
    expect(mocks.setJSON.mock.calls).toEqual([['language-preference', 'de']]);
    expect(vi.mocked(window.electronAPI.invoke).mock.calls).toEqual([
      ['app:set-language-preference', { preference: 'de' }],
    ]);
  });

  it('ignores unrelated actions and keeps storage and IPC failures non-fatal', async () => {
    mocks.setJSON.mockImplementation(() => {
      throw new Error('quota');
    });
    vi.mocked(window.electronAPI.invoke).mockRejectedValue(new Error('closed'));
    const channel = stdChannel();
    const state = {
      userPreferences: {
        spellcheckEnabled: true,
        showArchived: false,
        groupByRepo: true,
        hasCompletedProviderSetup: false,
        agentFontStyle: 'sans',
        noteFontStyle: 'sans',
        codeFontFamily: 'system-default',
        activityLogPresets: [],
        languagePreference: 'system',
      },
    };
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => state },
      userPreferencesPersistenceSaga,
    );
    await settle();
    mocks.setJSON.mockClear();
    channel.put({ type: 'unrelated/action' });
    channel.put(setSpellcheckEnabled(true));
    channel.put(setLanguagePreference('system'));
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([
      ['note-spellcheck-settings', { enabled: true }],
      ['language-preference', 'system'],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels pending hydration without late dispatches', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getJSON.mockReturnValue(new Promise((done) => (resolve = done)));
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: () => ({}) }, userPreferencesPersistenceSaga);
    task.cancel();
    resolve({ enabled: true });
    await task.toPromise();
    await settle();

    expect(dispatch.mock.calls).toEqual([]);
  });

  describe('backend-scoped completedProviderSetup key', () => {
    const stateFor = (activeId: string, hasCompletedProviderSetup = true) => ({
      connections: { activeId, windowBackendId: activeId },
      userPreferences: { hasCompletedProviderSetup },
    });

    it('hydrates and persists the flag under the bare key on the local backend', async () => {
      mocks.getJSON.mockImplementation((key: string) =>
        key === 'workspace-list:completedProviderSetup' ? true : undefined,
      );
      const dispatch = vi.fn();
      await runSaga(
        { dispatch, getState: () => stateFor('local') },
        hydrateUserPreferencesWorker,
      ).toPromise();
      expect(dispatch.mock.calls).toContainEqual([setHasCompletedProviderSetup(true)]);

      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => stateFor('local') },
        userPreferencesPersistenceSaga,
      );
      await settle();
      mocks.setJSON.mockClear();
      channel.put(setHasCompletedProviderSetup(true));
      await settle();
      expect(mocks.setJSON.mock.calls).toEqual([['workspace-list:completedProviderSetup', true]]);
      task.cancel();
      await task.toPromise();
    });

    it('hydrates and persists the flag under the namespaced key on a remote backend', async () => {
      const remoteKey = 'backend:remote-1:workspace-list:completedProviderSetup';
      mocks.getJSON.mockImplementation((key: string) => (key === remoteKey ? true : undefined));
      const dispatch = vi.fn();
      await runSaga(
        { dispatch, getState: () => stateFor('remote-1') },
        hydrateUserPreferencesWorker,
      ).toPromise();
      expect(dispatch.mock.calls).toContainEqual([setHasCompletedProviderSetup(true)]);
      expect(mocks.getJSON.mock.calls).toContainEqual([remoteKey]);
      expect(mocks.getJSON.mock.calls).not.toContainEqual([
        'workspace-list:completedProviderSetup',
      ]);

      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => stateFor('remote-1') },
        userPreferencesPersistenceSaga,
      );
      await settle();
      mocks.setJSON.mockClear();
      channel.put(setHasCompletedProviderSetup(true));
      await settle();
      expect(mocks.setJSON.mock.calls).toEqual([[remoteKey, true]]);
      task.cancel();
      await task.toPromise();
    });

    it('ignores the local bare key when hydrating a remote backend (fresh remote stays unset)', async () => {
      mocks.getJSON.mockImplementation((key: string) =>
        key === 'workspace-list:completedProviderSetup' ? true : undefined,
      );
      const dispatch = vi.fn();
      await runSaga(
        { dispatch, getState: () => stateFor('remote-1') },
        hydrateUserPreferencesWorker,
      ).toPromise();

      expect(dispatch.mock.calls).not.toContainEqual([setHasCompletedProviderSetup(true)]);
    });

    it('re-hydrates the flag from the scoped key when the active backend changes', async () => {
      const stored: Record<string, unknown> = {
        'workspace-list:completedProviderSetup': true,
      };
      mocks.getJSON.mockImplementation((key: string) => stored[key]);
      let activeId = 'local';
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => stateFor(activeId) },
        userPreferencesPersistenceSaga,
      );
      await settle();
      dispatch.mockClear();

      activeId = 'remote-1';
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
        } as never),
      );
      await settle();
      // Fresh remote: no scoped value stored, so the flag resets to false.
      expect(dispatch.mock.calls).toContainEqual([setHasCompletedProviderSetup(false)]);

      dispatch.mockClear();
      stored['backend:remote-2:workspace-list:completedProviderSetup'] = true;
      activeId = 'remote-2';
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-2',
          windowBackendId: 'remote-2',
        } as never),
      );
      await settle();
      expect(dispatch.mock.calls).toContainEqual([setHasCompletedProviderSetup(true)]);

      // Same backend id again: no re-hydration dispatch.
      dispatch.mockClear();
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-2',
          windowBackendId: 'remote-2',
        } as never),
      );
      await settle();
      expect(dispatch.mock.calls).toEqual([]);
      task.cancel();
      await task.toPromise();
    });
  });
});
