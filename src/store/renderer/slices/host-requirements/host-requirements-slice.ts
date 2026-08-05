/**
 * Host Requirements Slice
 *
 * Actions and reducer for tracking daemon-host tool requirements (git +
 * node, plus the informational gh probe). Mirrors the agent-availability
 * idiom: trigger actions are consumed by the host-requirements check service
 * (middleware), which probes via the legacy IPC bridges (system:check-git /
 * system:check-node / system:check-gh → daemon host.*) and dispatches the
 * per-tool resolved actions plus a completion action so the state ALWAYS
 * lands terminal — never stuck on "checking".
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type { HostRequirementsState } from './host-requirements-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: HostRequirementsState = {
  git: { checked: false, available: false },
  node: { checked: false, ok: false },
  gh: { checked: false, available: false },
  checking: false,
  hasCheckedOnce: false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** First-mount trigger: check only if nothing has been checked yet. */
export const ensureHostRequirementsChecked = createAction(
  'hostRequirements/ensureHostRequirementsChecked',
);

/** Explicit re-check trigger (e.g. a "Check again" affordance). */
export const checkHostRequirementsRequested = createAction(
  'hostRequirements/checkHostRequirementsRequested',
);

/** A check group started — set the in-flight flag. */
export const checkHostRequirementsStarted = createAction(
  'hostRequirements/checkHostRequirementsStarted',
);

/** Git probe settled. A failed probe folds to available:false. */
export const gitRequirementResolved = createAction<[available: boolean, version?: string]>(
  'hostRequirements/gitRequirementResolved',
);

/** Node probe settled. A failed probe folds to ok:false. */
export const nodeRequirementResolved = createAction<[ok: boolean, version?: string]>(
  'hostRequirements/nodeRequirementResolved',
);

/** gh probe settled (informational — never gates). A failed probe folds to available:false. */
export const ghRequirementResolved = createAction<[available: boolean, version?: string]>(
  'hostRequirements/ghRequirementResolved',
);

/** Every probe in the group settled — the state is terminal. */
export const checkHostRequirementsComplete = createAction(
  'hostRequirements/checkHostRequirementsComplete',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const hostRequirementsReducer = createReducer<HostRequirementsState>(initialState)
  .with(checkHostRequirementsStarted, (state) => ({
    ...state,
    checking: true,
  }))
  .with(gitRequirementResolved, (state, { payload: [available, version] }) => ({
    ...state,
    git: available ? { checked: true, available: true, version } : { checked: true, available: false },
  }))
  .with(nodeRequirementResolved, (state, { payload: [ok, version] }) => ({
    ...state,
    node: { checked: true, ok, version },
  }))
  .with(ghRequirementResolved, (state, { payload: [available, version] }) => ({
    ...state,
    gh: available ? { checked: true, available: true, version } : { checked: true, available: false },
  }))
  .with(checkHostRequirementsComplete, (state) => ({
    ...state,
    checking: false,
    hasCheckedOnce: true,
  }));
