import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';
import {
  initialState as backgroundAgentSettingsInitialState,
  setDefaultModel,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  initialState as userPreferencesInitialState,
  setAgentFontStyle,
  setChatAuroraEnabled,
  setGithubLinkDefaultAction,
  setShellTransparencyEnabled,
  setVolume,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  initialState as mcpSettingsInitialState,
  setEnabled,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import {
  initialState as externalEditorsInitialState,
  setEditorOrder,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import {
  applyProposalRequested,
  undoProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import { setProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  clearThemeCustomization,
  initialState as themeInitialState,
} from '$store/renderer/slices/theme/theme-slice';
import { initialState as specialistsInitialState } from '$store/renderer/slices/specialists/specialists-slice';
import { initialState as modelInitialState } from '$store/renderer/slices/model/model-slice';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(),
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ dispatch: mocks.dispatch, getState: mocks.getState }),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return mocks.getState();
    },
    createSelector: vi.fn((fn) => ({ select: fn })),
  },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: mocks.settingsGet, update: mocks.settingsUpdate },
  },
}));

import {
  applySettingsProposal,
  applySettingsProposalWork,
  undoSettingsProposal,
  undoSettingsProposalWork,
} from './settings-proposal-actions';

function makeState(overrides: Partial<StoreState> = {}): StoreState {
  return {
    backgroundAgentSettings: backgroundAgentSettingsInitialState,
    mcpSettings: mcpSettingsInitialState,
    externalEditors: externalEditorsInitialState,
    userPreferences: userPreferencesInitialState,
    settingsProposalHistory: { entries: {} },
    providerCatalog,
    ...overrides,
  } as StoreState;
}

function makeProposal(
  path = 'quickActions.defaultModel',
  value: unknown = 'claude-sonnet',
): Proposal {
  return {
    kind: 'settings-change',
    applyToolCallId: 'tool-settings',
    payload: { changes: [{ path, value }] },
    preview: { title: 'Change setting' },
  };
}

function makeDetail(proposal = makeProposal()): ProposalActionDetail {
  return { proposal, editedFields: {}, selectedBulkItemIds: [] };
}

describe('settings-proposal-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue(
      makeState({
        backgroundAgentSettings: {
          ...backgroundAgentSettingsInitialState,
          defaultModel: 'old-model',
        },
      }),
    );
  });

  it('dispatches lifecycle apply requests for settings proposals', () => {
    const detail = makeDetail();

    expect(applySettingsProposal(detail)).toBe(true);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      applyProposalRequested({
        proposalId: 'tool-settings',
        kind: 'settings-change',
        detail,
      }),
    );
  });

  it('applies redux settings and returns serializable reverse changes', async () => {
    const result = await applySettingsProposalWork(makeDetail());

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('claude-sonnet'));
    expect(result.reverseChanges).toEqual([
      {
        path: 'quickActions.defaultModel',
        value: 'old-model',
        apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setDefaultModel' },
      },
    ]);
  });

  it('applies normalized Open In editor order, persists it, and returns a reversible change', async () => {
    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();
    mocks.getState.mockReturnValue(
      makeState({
        externalEditors: { ...externalEditorsInitialState, editorOrder: ['vscode', 'zed'] },
      }),
    );

    const result = await applySettingsProposalWork(
      makeDetail(makeProposal('openIn.editorOrder', ['zed', 42, 'zed', 'vscode'])),
    );

    expect(mocks.dispatch).toHaveBeenCalledWith(setEditorOrder(['zed', 'vscode']));
    expect(setItem).toHaveBeenCalledWith(
      'settings:openInEditorsOrder',
      JSON.stringify(['zed', 'vscode']),
    );
    expect(result.reverseChanges).toEqual([
      {
        path: 'openIn.editorOrder',
        value: ['vscode', 'zed'],
        apply: { kind: 'local-storage-set', key: 'settings:openInEditorsOrder' },
      },
    ]);

    setItem.mockClear();
    await undoSettingsProposalWork(result.reverseChanges);

    expect(mocks.dispatch).toHaveBeenCalledWith(setEditorOrder(['vscode', 'zed']));
    expect(setItem).toHaveBeenCalledWith(
      'settings:openInEditorsOrder',
      JSON.stringify(['vscode', 'zed']),
    );
  });

  it('rejects a non-array Open In editor order value without writing it', async () => {
    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();

    await expect(
      applySettingsProposalWork(makeDetail(makeProposal('openIn.editorOrder', 'zed'))),
    ).rejects.toThrow('Invalid value for setting "openIn.editorOrder": "zed"');

    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: setEditorOrder.type }),
    );
    expect(setItem).not.toHaveBeenCalledWith('settings:openInEditorsOrder', expect.anything());
  });

  it('narrows font setting values without unsafe casts', async () => {
    const proposal = makeProposal('fonts.agent', 'monospace');

    await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).toHaveBeenCalledWith(setAgentFontStyle('monospace'));
  });

  it('applies and reverses the GitHub link default action preference', async () => {
    const proposal = makeProposal('githubLinks.defaultAction', 'copy-link');

    const result = await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).toHaveBeenCalledWith(setGithubLinkDefaultAction('copy-link'));
    expect(result.reverseChanges).toEqual([
      {
        path: 'githubLinks.defaultAction',
        value: 'show-choices',
        apply: { kind: 'redux-action', action: 'userPreferences/setGithubLinkDefaultAction' },
      },
    ]);
  });

  it('applies and reverses the appearance preferences', async () => {
    const proposal = makeProposal('appearance.chatAurora', false);
    proposal.payload.changes.push({ path: 'appearance.shellTransparency', value: false });

    const result = await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).toHaveBeenCalledWith(setChatAuroraEnabled(false));
    expect(mocks.dispatch).toHaveBeenCalledWith(setShellTransparencyEnabled(false));
    expect(result.reverseChanges).toEqual([
      {
        path: 'appearance.chatAurora',
        value: true,
        apply: { kind: 'redux-action', action: 'userPreferences/setChatAuroraEnabled' },
      },
      {
        path: 'appearance.shellTransparency',
        value: true,
        apply: { kind: 'redux-action', action: 'userPreferences/setShellTransparencyEnabled' },
      },
    ]);
  });

  it('falls back to the proposal value when a numeric edit is invalid', async () => {
    const proposal = makeProposal('notifications.volume', 0.75);
    const detail = makeDetail(proposal);
    detail.editedFields['notifications.volume'] = 'not-a-number';

    await applySettingsProposalWork(detail);

    expect(mocks.dispatch).toHaveBeenCalledWith(setVolume(0.75));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setVolume(NaN));
  });

  it('rejects an invalid update-channel value instead of reporting success', async () => {
    const proposal = makeProposal('preferences.updateChannel', 'nightly');

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Invalid value for setting "preferences.updateChannel": "nightly"',
    );

    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'userPreferences/setUpdateChannel' }),
    );
  });

  // Regression pin for intent-hq/monorepo#4188: read-only settings (e.g.
  // model.providerDefaults) and unknown paths used to no-op silently, letting
  // the proposal lifecycle record a fake "Applied" without writing anything.
  it('rejects a read-only setting instead of reporting success', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const proposal = makeProposal('model.providerDefaults', { codex: 'gpt-5' });

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Setting "model.providerDefaults" is read-only and cannot be changed',
    );

    expect(setItem).not.toHaveBeenCalled();
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('rejects an unknown setting path instead of reporting success', async () => {
    const proposal = makeProposal('no.such.setting', 'value');

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Unknown or unsupported setting "no.such.setting"',
    );

    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
  });

  it('rejects a read-only setting even when the payload supplies its own apply plan', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: {
        changes: [
          {
            path: 'model.providerDefaults',
            value: { codex: 'gpt-5' },
            apply: { kind: 'local-storage-set', key: 'smuggled-key' },
          },
        ],
      },
      preview: { title: 'Change setting' },
    };

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Setting "model.providerDefaults" is read-only and cannot be changed',
    );

    expect(setItem).not.toHaveBeenCalledWith('smuggled-key', expect.anything());
    setItem.mockRestore();
  });

  it('rejects an unknown setting path even when the payload supplies its own apply plan', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: {
        changes: [
          {
            path: 'no.such.setting',
            value: 'value',
            apply: { kind: 'local-storage-set', key: 'smuggled-key' },
          },
        ],
      },
      preview: { title: 'Change setting' },
    };

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Unknown or unsupported setting "no.such.setting"',
    );

    expect(setItem).not.toHaveBeenCalledWith('smuggled-key', expect.anything());
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('rejects a setting whose apply plan has no proposal writer', async () => {
    const proposal = makeProposal('mcp.servers', { some: { command: 'x' } });

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Setting "mcp.servers" cannot be applied from a proposal (user-mcp-settings)',
    );

    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
  });

  it('clears the theme customization when the active preset is reset to default', async () => {
    mocks.getState.mockReturnValue(
      makeState({
        theme: { ...themeInitialState, activePresetId: 'night', hasCustomTheme: true },
      } as Partial<StoreState>),
    );
    const proposal = makeProposal('theme.activePresetId', null);

    const result = await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).toHaveBeenCalledWith(clearThemeCustomization());
    expect(result.reverseChanges).toEqual([
      {
        path: 'theme.activePresetId',
        value: 'night',
        apply: { kind: 'redux-action', action: 'theme/selectThemePreset' },
      },
    ]);
  });

  it('rolls back earlier writes when a read-only change follows in the same proposal', async () => {
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: {
        changes: [
          { path: 'quickActions.defaultModel', value: 'new-model' },
          { path: 'model.providerDefaults', value: { codex: 'gpt-5' } },
        ],
      },
      preview: { title: 'Change settings' },
    };

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Setting "model.providerDefaults" is read-only and cannot be changed',
    );

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('new-model'));
    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('old-model'));
  });

  it('rolls back applied settings when a later apply write fails', async () => {
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: {
        changes: [
          { path: 'quickActions.defaultModel', value: 'new-model' },
          { path: 'mcp.enableUserServers', value: true },
        ],
      },
      preview: { title: 'Change settings' },
    };
    mocks.settingsUpdate.mockRejectedValueOnce(new Error('settings unavailable'));

    await expect(applySettingsProposalWork(makeDetail(proposal))).rejects.toThrow(
      'Failed to apply settings change: settings unavailable',
    );

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('new-model'));
    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('old-model'));
    expect(mocks.settingsUpdate).toHaveBeenCalledWith([
      { path: 'mcp.enableUserServers', value: true },
    ]);
  });

  it('undo work reapplies reverse changes through the injected dispatch', async () => {
    await undoSettingsProposalWork([
      {
        path: 'quickActions.defaultModel',
        value: 'old-model',
        apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setDefaultModel' },
      },
    ]);

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('old-model'));
  });

  it('rolls back undo writes and throws when a later undo write fails', async () => {
    mocks.getState.mockReturnValue(
      makeState({
        backgroundAgentSettings: {
          ...backgroundAgentSettingsInitialState,
          defaultModel: 'new-model',
        },
        mcpSettings: {
          ...mcpSettingsInitialState,
          enabled: true,
        },
      }),
    );
    mocks.settingsUpdate.mockRejectedValueOnce(new Error('undo unavailable'));

    await expect(
      undoSettingsProposalWork([
        {
          path: 'quickActions.defaultModel',
          value: 'old-model',
          apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setDefaultModel' },
        },
        {
          path: 'mcp.enableUserServers',
          value: false,
          apply: { kind: 'daemon-settings-update', path: 'mcp.enableUserServers' },
        },
      ]),
    ).rejects.toThrow('Failed to undo settings change: undo unavailable');

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('old-model'));
    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('new-model'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setEnabled(false));
  });

  it('undo dispatches lifecycle requests when history exists', () => {
    mocks.getState.mockReturnValue(
      makeState({
        settingsProposalHistory: {
          entries: {
            'tool-settings': {
              appliedAt: 123,
              reverseChanges: [],
            },
          },
        },
      }),
    );

    expect(undoSettingsProposal('tool-settings')).toBe(true);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      undoProposalRequested({
        proposalId: 'tool-settings',
        kind: 'settings-change',
      }),
    );
  });

  it('blocks agent-driven proposals from disabling an in-use provider', async () => {
    mocks.getState.mockReturnValue(
      makeState({
        providerSettings: {
          activeProviderId: 'auggie',
          enabledProviders: { 'claude-code': true, codex: true },
        },
        model: { ...modelInitialState, providerModels: {} },
        specialists: {
          ...specialistsInitialState,
          fileSpecialists: createCollection('id', [
            {
              id: 'my-spec',
              name: 'My Spec',
              description: 'test',
              codingAgent: 'claude-code',
              model: '',
              behaviorPrompt: 'prompt',
              filePath: '/tmp/my-spec.md',
              source: 'user',
            },
          ] as never[]),
        },
        featureCodes: { activeFeatures: [], initialized: true },
        githubAuth: { isAuthenticated: false },
      } as Partial<StoreState>),
    );
    const proposal = makeProposal('providers.enabled', {
      'claude-code': false,
      codex: false,
    });

    await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      setProviderEnabled({ providerId: 'claude-code', enabled: false }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      setProviderEnabled({ providerId: 'codex', enabled: false }),
    );
  });

  // Regression pin for the B7 rewire: `daemon-settings`-sourced definitions
  // must read via `appClient.settings.get(daemonPath)` and write via
  // `appClient.settings.update`. `workspace.branchPrefix` has no explicit
  // Redux case, so both operations flow through the new daemon helpers.
  it('reads and writes daemon-settings definitions through appClient.settings', async () => {
    mocks.settingsGet.mockResolvedValueOnce({
      path: 'workspace.branchPrefix',
      value: 'legacy-prefix/',
    });
    const proposal = makeProposal('workspace.branchPrefix', 'new-prefix/');

    const result = await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.settingsGet).toHaveBeenCalledWith('workspace.branchPrefix');
    expect(mocks.settingsUpdate).toHaveBeenCalledWith([
      { path: 'workspace.branchPrefix', value: 'new-prefix/' },
    ]);
    expect(result.reverseChanges).toEqual([
      {
        path: 'workspace.branchPrefix',
        value: 'legacy-prefix/',
        apply: { kind: 'daemon-settings-update', path: 'workspace.branchPrefix' },
      },
    ]);
  });

  // Backend scoping: a local-storage-set write against a per-backend key must
  // not touch the local machine's bare key when a remote backend is active.
  it('namespaces backend-scoped localStorage writes under the active remote backend', async () => {
    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();
    mocks.getState.mockReturnValue(
      makeState({ connections: { windowBackendId: 'remote-1' } } as Partial<StoreState>),
    );

    await undoSettingsProposalWork([
      {
        path: 'legacy.activeProvider',
        value: 'codex',
        apply: { kind: 'local-storage-set', key: 'workspaces-active-provider' },
      },
    ]);

    expect(setItem).toHaveBeenCalledWith(
      'backend:remote-1:workspaces-active-provider',
      JSON.stringify('codex'),
    );
    expect(setItem).not.toHaveBeenCalledWith('workspaces-active-provider', expect.anything());
  });

  it('keeps the bare key for backend-scoped localStorage writes on the local backend', async () => {
    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();
    mocks.getState.mockReturnValue(
      makeState({ connections: { windowBackendId: 'local' } } as Partial<StoreState>),
    );

    await undoSettingsProposalWork([
      {
        path: 'legacy.activeProvider',
        value: 'codex',
        apply: { kind: 'local-storage-set', key: 'workspaces-active-provider' },
      },
    ]);

    expect(setItem).toHaveBeenCalledWith('workspaces-active-provider', JSON.stringify('codex'));
  });
});
