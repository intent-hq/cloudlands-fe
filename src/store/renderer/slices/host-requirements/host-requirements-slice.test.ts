/**
 * Host Requirements reducer + selector tests.
 *
 * Pins the terminal-state contract for the onboarding gate: every reducer
 * case, the failure folds (probe failure → checked:true + not-available,
 * never stuck), and the selectors' per-tool / allRequirementsMet /
 * hasCheckedOnce reads.
 */
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { parseProtocolVersion } from '$shared/protocol-version';
import {
  selectAllRequirementsMet,
  selectGhRequirement,
  selectGitOptional,
  selectGitRequirement,
  selectHostRequirementsChecking,
  selectHostRequirementsHasCheckedOnce,
  selectNodeRequirement,
  selectProviderCliRequirements,
} from './host-requirements-selectors';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsStarted,
  ghRequirementResolved,
  gitRequirementResolved,
  hostRequirementsReducer,
  hostRequirementsReset,
  initialState,
  nodeRequirementResolved,
  providerCliRequirementsResolved,
} from './host-requirements-slice';
import type { HostRequirementsState } from './host-requirements-types';

function storeWith(hostRequirements: HostRequirementsState): StoreState {
  return { hostRequirements } as unknown as StoreState;
}

describe('hostRequirementsReducer', () => {
  it('keeps advisory CLI diagnostics scoped to their connection and resets them on admission changes', () => {
    const warnings = [
      {
        providerId: 'codex',
        providerName: 'Codex',
        version: '0.114.0',
        minimumVersion: '0.159.1',
      },
    ];
    const state = hostRequirementsReducer(
      initialState,
      providerCliRequirementsResolved('remote-A', warnings),
    );
    expect(selectProviderCliRequirements.select(storeWith(state))).toEqual({
      context: 'remote-A',
      warnings,
    });
    expect(selectAllRequirementsMet.select(storeWith(state))).toBe(false);
    const reset = hostRequirementsReducer(state, hostRequirementsReset());
    expect(selectProviderCliRequirements.select(storeWith(reset))).toBeUndefined();
  });

  it('requires fresh diagnostics after the owner connection changes', () => {
    const previous = hostRequirementsReducer(
      hostRequirementsReducer(initialState, nodeRequirementResolved(true, '22.1.0')),
      checkHostRequirementsComplete(),
    );
    expect(hostRequirementsReducer(previous, hostRequirementsReset())).toEqual(initialState);
  });
  it('starts unchecked, not checking, requirements unmet', () => {
    const state = hostRequirementsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      git: { checked: false, available: false },
      node: { checked: false, ok: false },
      gh: { checked: false, available: false },
      checking: false,
      hasCheckedOnce: false,
    });
  });

  it('checkHostRequirementsStarted sets the in-flight flag', () => {
    const state = hostRequirementsReducer(initialState, checkHostRequirementsStarted());
    expect(state.checking).toBe(true);
    expect(state.hasCheckedOnce).toBe(false);
  });

  it('gitRequirementResolved(true, version) lands a terminal available state', () => {
    const state = hostRequirementsReducer(
      initialState,
      gitRequirementResolved(true, 'git version 2.43.0'),
    );
    expect(state.git).toEqual({ checked: true, available: true, version: 'git version 2.43.0' });
  });

  it('gitRequirementResolved(false) drops any stale version (terminal not-available)', () => {
    const withGit = hostRequirementsReducer(
      initialState,
      gitRequirementResolved(true, 'git version 2.43.0'),
    );
    const state = hostRequirementsReducer(withGit, gitRequirementResolved(false));
    expect(state.git).toEqual({ checked: true, available: false });
  });

  it('nodeRequirementResolved(true, version) lands a terminal ok state', () => {
    const state = hostRequirementsReducer(initialState, nodeRequirementResolved(true, '22.1.0'));
    expect(state.node).toEqual({ checked: true, ok: true, version: '22.1.0' });
  });

  it('nodeRequirementResolved(false, version) keeps the too-old version for messaging', () => {
    const state = hostRequirementsReducer(initialState, nodeRequirementResolved(false, '18.19.0'));
    expect(state.node).toEqual({ checked: true, ok: false, version: '18.19.0' });
  });

  it('ghRequirementResolved(true, version) lands a terminal available state', () => {
    const state = hostRequirementsReducer(initialState, ghRequirementResolved(true, '2.62.0'));
    expect(state.gh).toEqual({ checked: true, available: true, version: '2.62.0' });
  });

  it('ghRequirementResolved(false) drops any stale version (terminal not-available)', () => {
    const withGh = hostRequirementsReducer(initialState, ghRequirementResolved(true, '2.62.0'));
    const state = hostRequirementsReducer(withGh, ghRequirementResolved(false));
    expect(state.gh).toEqual({ checked: true, available: false });
  });

  it('checkHostRequirementsComplete clears checking and flips hasCheckedOnce', () => {
    const started = hostRequirementsReducer(initialState, checkHostRequirementsStarted());
    const state = hostRequirementsReducer(started, checkHostRequirementsComplete());
    expect(state.checking).toBe(false);
    expect(state.hasCheckedOnce).toBe(true);
  });

  it('a fully failed check group still lands terminal (never stuck in loading)', () => {
    let state = hostRequirementsReducer(initialState, checkHostRequirementsStarted());
    state = hostRequirementsReducer(state, gitRequirementResolved(false));
    state = hostRequirementsReducer(state, nodeRequirementResolved(false));
    state = hostRequirementsReducer(state, ghRequirementResolved(false));
    state = hostRequirementsReducer(state, checkHostRequirementsComplete());
    expect(state).toEqual({
      git: { checked: true, available: false },
      node: { checked: true, ok: false },
      gh: { checked: true, available: false },
      checking: false,
      hasCheckedOnce: true,
    });
  });
});

describe('host-requirements selectors', () => {
  const met: HostRequirementsState = {
    git: { checked: true, available: true, version: '2.43.0' },
    node: { checked: true, ok: true, version: '22.1.0' },
    gh: { checked: true, available: true, version: '2.62.0' },
    checking: false,
    hasCheckedOnce: true,
  };

  it('exposes the per-tool statuses', () => {
    expect(selectGitRequirement.select(storeWith(met))).toEqual(met.git);
    expect(selectNodeRequirement.select(storeWith(met))).toEqual(met.node);
    expect(selectGhRequirement.select(storeWith(met))).toEqual(met.gh);
  });

  it('exposes checking and hasCheckedOnce', () => {
    expect(selectHostRequirementsChecking.select(storeWith(met))).toBe(false);
    expect(selectHostRequirementsHasCheckedOnce.select(storeWith(met))).toBe(true);
    expect(selectHostRequirementsChecking.select(storeWith(initialState))).toBe(false);
    expect(selectHostRequirementsHasCheckedOnce.select(storeWith(initialState))).toBe(false);
  });

  it('allRequirementsMet requires git available AND node ok', () => {
    expect(selectAllRequirementsMet.select(storeWith(met))).toBe(true);
    expect(selectAllRequirementsMet.select(storeWith(initialState))).toBe(false);
    expect(
      selectAllRequirementsMet.select(
        storeWith({ ...met, node: { checked: true, ok: false, version: '18.19.0' } }),
      ),
    ).toBe(false);
    expect(
      selectAllRequirementsMet.select(
        storeWith({ ...met, git: { checked: true, available: false } }),
      ),
    ).toBe(false);
  });

  it('allRequirementsMet ignores gh (informational only — never gates)', () => {
    expect(
      selectAllRequirementsMet.select(
        storeWith({ ...met, gh: { checked: true, available: false } }),
      ),
    ).toBe(true);
    expect(
      selectAllRequirementsMet.select(
        storeWith({ ...met, gh: { checked: false, available: false } }),
      ),
    ).toBe(true);
  });
});

describe('selectAllRequirementsMet — Git not required without a forge (Labs)', () => {
  const noGit: HostRequirementsState = {
    ...initialState,
    git: { checked: true, available: false },
    node: { checked: true, ok: true, version: '22.4.0' },
    hasCheckedOnce: true,
  };

  function stateWith(options: {
    labs?: boolean;
    github?: boolean;
    gitlab?: boolean;
    settled?: boolean;
    hostRequirements?: HostRequirementsState;
  }): StoreState {
    const settled = options.settled ?? true;
    return {
      hostRequirements: options.hostRequirements ?? noGit,
      userPreferences: { labsPlainFolderWorkspacesEnabled: options.labs ?? true },
      daemonHealth: { stats: { protocolVersion: parseProtocolVersion('15.3') } },
      githubAuth: {
        isAuthenticated: options.github ?? false,
        statusSettled: settled,
        statusFailed: false,
      },
      gitlabAuth: {
        isConfigured: options.gitlab ?? false,
        statusReady: settled,
        statusFailed: false,
      },
    } as unknown as StoreState;
  }

  it('passes without Git when Labs is on and no forge is connected', () => {
    expect(selectAllRequirementsMet.select(stateWith({}))).toBe(true);
  });

  it('still requires Node', () => {
    const state = stateWith({
      hostRequirements: { ...noGit, node: { checked: true, ok: false } },
    });
    expect(selectAllRequirementsMet.select(state)).toBe(false);
  });

  it('requires Git as today with Labs off', () => {
    expect(selectAllRequirementsMet.select(stateWith({ labs: false }))).toBe(false);
  });

  it('requires Git as today with GitHub or GitLab connected', () => {
    expect(selectAllRequirementsMet.select(stateWith({ github: true }))).toBe(false);
    expect(selectAllRequirementsMet.select(stateWith({ gitlab: true }))).toBe(false);
  });

  it('requires Git until the forge status reads settle', () => {
    expect(selectAllRequirementsMet.select(stateWith({ settled: false }))).toBe(false);
  });

  it('reports Git optional only in the relaxed case', () => {
    expect(selectGitOptional.select(stateWith({}))).toBe(true);
    expect(selectGitOptional.select(stateWith({ github: true }))).toBe(false);
    expect(selectGitOptional.select(stateWith({ labs: false }))).toBe(false);
  });
});
