/**
 * Intent Apps Slice (Labs)
 *
 * A read-through view of the app library that main owns: the library of the
 * daemon of this window's machine (`docs/protocol/methods/apps.md`). Main's reply or `intent-apps:changed`
 * push is the only thing that changes `library`; the renderer sends user
 * requests (install a package, approve, revoke, uninstall, open), and the saga carries
 * them and records their outcome here so the Settings dialogs can show it.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  INTENT_APPS_OFF_STATE,
  type IntentAppInstallResult,
  type IntentAppsActionError,
  type IntentAppsState,
} from '$shared/intent-apps/intent-apps-types';

export type IntentAppsActionKind = 'install' | 'approve' | 'revoke' | 'uninstall' | 'open' | 'lab';

/**
 * A package the user picked or dropped, uploaded to the window's machine and
 * checked with a dry run: the upload the install uses, the app it holds, and
 * whether installing it replaces an installed app of the same id.
 */
export interface IntentAppsPackageInstall {
  uploadId: string;
  replace: boolean;
  preview: IntentAppInstallResult;
}

export interface IntentAppsApproveRequest {
  appId: string;
  bundleHash: string;
  level: 1 | 2 | 3;
  features: string[];
}

export interface IntentAppsSliceState {
  library: IntentAppsState;
  /** Main answered at least once. */
  loaded: boolean;
  /** The request in flight, with its app (null for install and the Labs switch). */
  busy: { kind: IntentAppsActionKind; appId: string | null } | null;
  /** The last failed request (cleared by the next request of the same kind). */
  failure: {
    kind: IntentAppsActionKind;
    appId: string | null;
    error: IntentAppsActionError;
  } | null;
  /** The checked package the install dialog shows; null when no install is under way. */
  packageInstall: IntentAppsPackageInstall | null;
  /** Icon data URLs by `<appId>@<bundleHash>` (null: the app has none or it did not load). */
  icons: Record<string, string | null>;
}

const initialState: IntentAppsSliceState = {
  library: INTENT_APPS_OFF_STATE,
  loaded: false,
  busy: null,
  failure: null,
  packageInstall: null,
  icons: {},
};

export const intentAppsStateReceived = createAction<[state: IntentAppsState]>(
  'intentApps/stateReceived',
);
export const intentAppsLabRequested = createAction<[enabled: boolean]>('intentApps/labRequested');
export const intentAppsRefreshRequested = createAction('intentApps/refreshRequested');
/** "Install app…": the native picker for a package file or a folder. */
export const intentAppPackagePickRequested = createAction('intentApps/packagePickRequested');
/** A package path from the picker or a drop: check it with a dry run. */
export const intentAppPackageChosen = createAction<[path: string]>('intentApps/packageChosen');
/** Install the checked package and approve it with these features. */
export const intentAppPackageInstallRequested = createAction<[features: string[]]>(
  'intentApps/packageInstallRequested',
);
/** Close the install review; a package that was not installed is discarded. */
export const intentAppPackageDismissed = createAction<[uploadId: string | null]>(
  'intentApps/packageDismissed',
);
export const intentAppApproveRequested = createAction<[request: IntentAppsApproveRequest]>(
  'intentApps/approveRequested',
);
export const intentAppRevokeRequested = createAction<[appId: string]>('intentApps/revokeRequested');
export const intentAppUninstallRequested = createAction<[appId: string]>(
  'intentApps/uninstallRequested',
);
export const intentAppOpenRequested = createAction<[appId: string]>('intentApps/openRequested');

/** Saga → reducer: a request started, succeeded or failed. */
export const intentAppsActionStarted = createAction<
  [kind: IntentAppsActionKind, appId: string | null]
>('intentApps/actionStarted');
export const intentAppsActionFinished = createAction('intentApps/actionFinished');
export const intentAppsActionFailed =
  createAction<[kind: IntentAppsActionKind, appId: string | null, error: IntentAppsActionError]>(
    'intentApps/actionFailed',
  );
export const intentAppPackageChecked = createAction<[packageInstall: IntentAppsPackageInstall]>(
  'intentApps/packageChecked',
);
export const intentAppIconReceived =
  createAction<[key: string, url: string | null]>('intentApps/iconReceived');

export const intentAppsReducer = createReducer<IntentAppsSliceState>(initialState);
intentAppsReducer.with(intentAppsStateReceived, (state, { payload: [library] }) => ({
  ...state,
  library,
  loaded: true,
}));
intentAppsReducer.with(intentAppsActionStarted, (state, { payload: [kind, appId] }) => ({
  ...state,
  busy: { kind, appId },
  failure: state.failure?.kind === kind ? null : state.failure,
}));
intentAppsReducer.with(intentAppsActionFinished, (state) => ({ ...state, busy: null }));
intentAppsReducer.with(intentAppsActionFailed, (state, { payload: [kind, appId, error] }) => ({
  ...state,
  busy: null,
  failure: { kind, appId, error },
}));
intentAppsReducer.with(intentAppPackageChecked, (state, { payload: [packageInstall] }) => ({
  ...state,
  packageInstall,
}));
intentAppsReducer.with(intentAppPackageDismissed, (state) => ({
  ...state,
  packageInstall: null,
  failure:
    state.failure?.kind === 'install' || state.failure?.kind === 'approve' ? null : state.failure,
}));
intentAppsReducer.with(intentAppIconReceived, (state, { payload: [key, url] }) => ({
  ...state,
  icons: { ...state.icons, [key]: url },
}));
