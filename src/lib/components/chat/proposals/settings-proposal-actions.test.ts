import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';
import {
  initialState as backgroundAgentSettingsInitialState,
  setDefaultModel,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  initialState as userPreferencesInitialState,
  setAgentFontStyle,
  setVolume,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  initialState as mcpSettingsInitialState,
  setEnabled,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import {
  applyProposalRequested,
  undoProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import { setProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { initialState as specialistsInitialState } from '$store/renderer/slices/specialists/specialists-slice';
import { initialState as modelInitialState } from '$store/renderer/slices/model/model-slice';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoreState } from '$lib/store/types';

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
    get state() { return mocks.getState(); },
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
    userPreferences: userPreferencesInitialState,
    settingsProposalHistory: { entries: {} },
    ...overrides,
  } as StoreState;
}

function makeProposal(
  path = 'backgroundAgents.defaultModel',
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
        path: 'backgroundAgents.defaultModel',
        value: 'old-model',
        apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setDefaultModel' },
      },
    ]);
  });

  it('narrows font setting values without unsafe casts', async () => {
    const proposal = makeProposal('fonts.agent', 'monospace');

    await applySettingsProposalWork(makeDetail(proposal));

    expect(mocks.dispatch).toHaveBeenCalledWith(setAgentFontStyle('monospace'));
  });

  it('falls back to the proposal value when a numeric edit is invalid', async () => {
    const proposal = makeProposal('notifications.volume', 0.75);
    const detail = makeDetail(proposal);
    detail.editedFields['notifications.volume'] = 'not-a-number';

    await applySettingsProposalWork(detail);

    expect(mocks.dispatch).toHaveBeenCalledWith(setVolume(0.75));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setVolume(NaN));
  });

  it('rolls back applied settings when a later apply write fails', async () => {
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: {
        changes: [
          { path: 'backgroundAgents.defaultModel', value: 'new-model' },
          { path: 'mcp.enableUserServers', value: true },
        ],
      },
      preview: { title: 'Change settings' },
    };
    mocks.settingsUpdate.mockRejectedValueOnce(new Error('settings unavailable'));

    await expect(
      applySettingsProposalWork(makeDetail(proposal)),
    ).rejects.toThrow('Failed to apply settings change: settings unavailable');

    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('new-model'));
    expect(mocks.dispatch).toHaveBeenCalledWith(setDefaultModel('old-model'));
    expect(mocks.settingsUpdate).toHaveBeenCalledWith([
      { path: 'mcp.enableUserServers', value: true },
    ]);
  });

  it('undo work reapplies reverse changes through the injected dispatch', async () => {
    await undoSettingsProposalWork([
      {
        path: 'backgroundAgents.defaultModel',
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
          path: 'backgroundAgents.defaultModel',
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
});
