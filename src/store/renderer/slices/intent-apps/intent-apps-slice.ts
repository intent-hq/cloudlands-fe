/**
 * Intent Apps Slice (Labs)
 *
 * A read-through view of the app library that main owns: the library of the
 * daemon of this window's machine (`docs/protocol/methods/apps.md`). Main's reply or `intent-apps:changed`
 * push is the only thing that changes `library`; the renderer sends user
 * requests (install, approve, revoke, uninstall, open), and the saga carries
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

export interface IntentAppsInstallRequest {
  workspaceId: string;
  path: string;
  replace?: boolean;
  dryRun?: boolean;
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
  /** The last dry-run install result, for the install dialog's preview. */
  installPreview: IntentAppInstallResult | null;
  /** The last completed install, so the dialog can close and offer approval. */
  installed: IntentAppInstallResult | null;
  /** Icon data URLs by `<appId>@<bundleHash>` (null: the app has none or it did not load). */
  icons: Record<string, string | null>;
}

const initialState: IntentAppsSliceState = {
  library: INTENT_APPS_OFF_STATE,
  loaded: false,
  busy: null,
  failure: null,
  installPreview: null,
  installed: null,
  icons: {},
};

export const intentAppsStateReceived = createAction<[state: IntentAppsState]>(
  'intentApps/stateReceived',
);
export const intentAppsLabRequested = createAction<[enabled: boolean]>('intentApps/labRequested');
export const intentAppsRefreshRequested = createAction('intentApps/refreshRequested');
export const intentAppInstallRequested = createAction<[request: IntentAppsInstallRequest]>(
  'intentApps/installRequested',
);
export const intentAppInstallDialogReset = createAction('intentApps/installDialogReset');
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
export const intentAppInstallPreviewReceived = createAction<[result: IntentAppInstallResult]>(
  'intentApps/installPreviewReceived',
);
export const intentAppInstalled =
  createAction<[result: IntentAppInstallResult]>('intentApps/installed');
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
intentAppsReducer.with(intentAppInstallPreviewReceived, (state, { payload: [result] }) => ({
  ...state,
  installPreview: result,
}));
intentAppsReducer.with(intentAppInstalled, (state, { payload: [result] }) => ({
  ...state,
  installPreview: null,
  installed: result,
}));
intentAppsReducer.with(intentAppInstallDialogReset, (state) => ({
  ...state,
  installPreview: null,
  installed: null,
  failure: state.failure?.kind === 'install' ? null : state.failure,
}));
intentAppsReducer.with(intentAppIconReceived, (state, { payload: [key, url] }) => ({
  ...state,
  icons: { ...state.icons, [key]: url },
}));
