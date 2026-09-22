/**
 * Host Requirements Slice
 *
 * Actions and reducer for tracking daemon-host tool requirements (git +
 * node, plus the informational gh probe). Mirrors the agent-availability
 * idiom: trigger actions are consumed by the host-requirements saga, which
 * probes via the legacy IPC bridges (system:check-git / system:check-node /
 * system:check-gh → daemon host.*) and dispatches the per-tool resolved
 * actions plus a completion action so the state ALWAYS lands terminal — never
 * stuck on "checking".
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { HostRequirementsState } from './host-requirements-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: HostRequirementsState = {
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

export const initializeRtkSettings = createAction('hostRequirements/initializeRtkSettings');
export const checkRtkRequested = createAction('hostRequirements/checkRtkRequested');
export const installRtkRequested = createAction('hostRequirements/installRtkRequested');
export const updateRtkEnabledRequested = createAction<[enabled: boolean]>(
  'hostRequirements/updateRtkEnabledRequested',
);
export const rtkCheckStarted = createAction('hostRequirements/rtkCheckStarted');
export const rtkRequirementResolved = createAction<[available: boolean]>(
  'hostRequirements/rtkRequirementResolved',
);
export const rtkSettingLoaded = createAction<[enabled: boolean]>(
  'hostRequirements/rtkSettingLoaded',
);
export const rtkSettingLoadFailed = createAction<[error: string]>(
  'hostRequirements/rtkSettingLoadFailed',
);
export const rtkUpdateStarted = createAction('hostRequirements/rtkUpdateStarted');
export const rtkUpdateSucceeded = createAction<[enabled: boolean]>(
  'hostRequirements/rtkUpdateSucceeded',
);
export const rtkUpdateFailed = createAction<[error: string]>('hostRequirements/rtkUpdateFailed');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const hostRequirementsReducer = createReducer<HostRequirementsState>(initialState);

hostRequirementsReducer.with(checkHostRequirementsStarted, (state) => ({
  ...state,
  checking: true,
}));
hostRequirementsReducer.with(
  gitRequirementResolved,
  (state, { payload: [available, version] }) => ({
    ...state,
    git: available
      ? { checked: true, available: true, version }
      : { checked: true, available: false },
  }),
);
hostRequirementsReducer.with(nodeRequirementResolved, (state, { payload: [ok, version] }) => ({
  ...state,
  node: { checked: true, ok, version },
}));
hostRequirementsReducer.with(ghRequirementResolved, (state, { payload: [available, version] }) => ({
  ...state,
  gh: available ? { checked: true, available: true, version } : { checked: true, available: false },
}));
hostRequirementsReducer.with(checkHostRequirementsComplete, (state) => ({
  ...state,
  checking: false,
  hasCheckedOnce: true,
}));
hostRequirementsReducer.with(rtkCheckStarted, (state) => ({ ...state, rtkChecking: true }));
hostRequirementsReducer.with(rtkRequirementResolved, (state, { payload: [available] }) => ({
  ...state,
  rtk: { checked: true, available },
  rtkChecking: false,
}));
hostRequirementsReducer.with(rtkSettingLoaded, (state, { payload: [rtkEnabled] }) => ({
  ...state,
  rtkEnabled,
  rtkSettingsLoaded: true,
  rtkError: null,
}));
hostRequirementsReducer.with(rtkSettingLoadFailed, (state, { payload: [rtkError] }) => ({
  ...state,
  rtkSettingsLoaded: true,
  rtkError,
}));
hostRequirementsReducer.with(rtkUpdateStarted, (state) => ({
  ...state,
  rtkUpdating: true,
  rtkError: null,
}));
hostRequirementsReducer.with(rtkUpdateSucceeded, (state, { payload: [rtkEnabled] }) => ({
  ...state,
  rtkEnabled,
  rtkUpdating: false,
  rtkError: null,
}));
hostRequirementsReducer.with(rtkUpdateFailed, (state, { payload: [rtkError] }) => ({
  ...state,
  rtkUpdating: false,
  rtkError,
}));
