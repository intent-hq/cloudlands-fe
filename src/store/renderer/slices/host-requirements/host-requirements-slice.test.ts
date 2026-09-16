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
import {
  selectAllRequirementsMet,
  selectGhRequirement,
  selectGitRequirement,
  selectHostRequirementsChecking,
  selectHostRequirementsHasCheckedOnce,
  selectNodeRequirement,
  selectRtkChecking,
  selectRtkEnabled,
  selectRtkError,
  selectRtkRequirement,
  selectRtkSettingsLoaded,
  selectRtkUpdating,
} from './host-requirements-selectors';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsStarted,
  ghRequirementResolved,
  gitRequirementResolved,
  hostRequirementsReducer,
  initialState,
  nodeRequirementResolved,
  rtkCheckStarted,
  rtkRequirementResolved,
  rtkSettingLoaded,
  rtkSettingLoadFailed,
  rtkUpdateFailed,
  rtkUpdateStarted,
  rtkUpdateSucceeded,
} from './host-requirements-slice';
import type { HostRequirementsState } from './host-requirements-types';

function storeWith(hostRequirements: HostRequirementsState): StoreState {
  return { hostRequirements } as unknown as StoreState;
}

describe('hostRequirementsReducer', () => {
  it('starts unchecked, not checking, requirements unmet', () => {
    const state = hostRequirementsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      git: { checked: false, available: false },
      node: { checked: false, ok: false },
      gh: { checked: false, available: false },
      rtk: { checked: false, available: false },
      rtkEnabled: false,
      rtkSettingsLoaded: false,
      rtkChecking: false,
      rtkUpdating: false,
      rtkError: null,
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

  it('settles RTK probes and setting hydration', () => {
    const checking = hostRequirementsReducer(initialState, rtkCheckStarted());
    expect(checking.rtkChecking).toBe(true);
    const available = hostRequirementsReducer(checking, rtkRequirementResolved(true));
    expect(available.rtk).toEqual({ checked: true, available: true });
    expect(available.rtkChecking).toBe(false);
    const loaded = hostRequirementsReducer(available, rtkSettingLoaded(true));
    expect(loaded.rtkEnabled).toBe(true);
    expect(loaded.rtkSettingsLoaded).toBe(true);
    expect(loaded.rtkError).toBeNull();
    const failed = hostRequirementsReducer(loaded, rtkSettingLoadFailed('unavailable'));
    expect(failed.rtkSettingsLoaded).toBe(true);
    expect(failed.rtkError).toBe('unavailable');
  });

  it('settles RTK setting updates on success and failure', () => {
    const updating = hostRequirementsReducer(initialState, rtkUpdateStarted());
    expect(updating.rtkUpdating).toBe(true);
    const succeeded = hostRequirementsReducer(updating, rtkUpdateSucceeded(true));
    expect(succeeded.rtkEnabled).toBe(true);
    expect(succeeded.rtkUpdating).toBe(false);
    expect(succeeded.rtkError).toBeNull();
    const restarted = hostRequirementsReducer(succeeded, rtkUpdateStarted());
    const failed = hostRequirementsReducer(restarted, rtkUpdateFailed('save failed'));
    expect(failed.rtkEnabled).toBe(true);
    expect(failed.rtkUpdating).toBe(false);
    expect(failed.rtkError).toBe('save failed');
  });

  it('a fully failed check group still lands terminal (never stuck in loading)', () => {
    let state = hostRequirementsReducer(initialState, checkHostRequirementsStarted());
    state = hostRequirementsReducer(state, gitRequirementResolved(false));
    state = hostRequirementsReducer(state, nodeRequirementResolved(false));
    state = hostRequirementsReducer(state, ghRequirementResolved(false));
    state = hostRequirementsReducer(state, checkHostRequirementsComplete());
    expect(state).toEqual({
      git: { checked: true, available: false },
      node: { checked: true, ok: false, version: undefined },
      gh: { checked: true, available: false },
      rtk: { checked: false, available: false },
      rtkEnabled: false,
      rtkSettingsLoaded: false,
      rtkChecking: false,
      rtkUpdating: false,
      rtkError: null,
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
    rtk: { checked: true, available: true },
    rtkEnabled: true,
    rtkSettingsLoaded: true,
    rtkChecking: false,
    rtkUpdating: false,
    rtkError: null,
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

  it('exposes RTK status and operation state', () => {
    const state = storeWith(met);
    expect(selectRtkRequirement.select(state)).toEqual(met.rtk);
    expect(selectRtkEnabled.select(state)).toBe(true);
    expect(selectRtkSettingsLoaded.select(state)).toBe(true);
    expect(selectRtkChecking.select(state)).toBe(false);
    expect(selectRtkUpdating.select(state)).toBe(false);
    expect(selectRtkError.select(state)).toBeNull();
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
