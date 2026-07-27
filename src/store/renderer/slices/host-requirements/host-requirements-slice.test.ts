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
  selectGitRequirement,
  selectHostRequirementsChecking,
  selectHostRequirementsHasCheckedOnce,
  selectNodeRequirement,
} from './host-requirements-selectors';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsStarted,
  gitRequirementResolved,
  hostRequirementsReducer,
  initialState,
  nodeRequirementResolved,
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
    state = hostRequirementsReducer(state, checkHostRequirementsComplete());
    expect(state).toEqual({
      git: { checked: true, available: false },
      node: { checked: true, ok: false },
      checking: false,
      hasCheckedOnce: true,
    });
  });
});

describe('host-requirements selectors', () => {
  const met: HostRequirementsState = {
    git: { checked: true, available: true, version: '2.43.0' },
    node: { checked: true, ok: true, version: '22.1.0' },
    checking: false,
    hasCheckedOnce: true,
  };

  it('exposes the per-tool statuses', () => {
    expect(selectGitRequirement.select(storeWith(met))).toEqual(met.git);
    expect(selectNodeRequirement.select(storeWith(met))).toEqual(met.node);
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
});
