import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { isFastModeSettingKey } from '$shared/provider-profiles';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import {
  addItem,
  createCollection,
  getItem,
  removeItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  initialProfilesState,
  profileHandlers,
  stageProfileEnv,
  type DefaultMutationResult,
  type ProfileMutationResult,
} from './provider-profiles-state';
import type {
  EnvEntryWrite,
  ProviderDefaultConfig,
  ProviderProfile,
  ProviderProfileFailure,
} from '$shared/provider-profiles';
import type { ProviderProfileStatus } from './provider-settings-types';
import type {
  ProviderTokenState,
  ProviderFastModeState,
  ProviderPaths,
  ProviderSettingsRequest,
  ProviderSettingsRequestContext,
  ProviderSettingsState,
} from './provider-settings-types';
// Compatibility for existing type-only consumers; remove when migrated to the types module.
export type { ProviderSettingsState } from './provider-settings-types';

const emptyFastMode: ProviderFastModeState = {
  supported: false,
  confirmed: {},
  pending: {},
  nextEditId: 0,
  revision: -1,
};

export const fastModeHydrationStarted = createAction('providerSettings/fastModeHydrationStarted');
export const fastModeSupportReceived = createAction<[supported: boolean]>(
  'providerSettings/fastModeSupportReceived',
);
export const hydrateProviderFastMode = createAction<
  [value: Record<string, boolean>, revision?: number]
>('providerSettings/hydrateFastMode');
export const setProviderFastMode = createAction<[providerId: string, enabled: boolean]>(
  'providerSettings/setFastMode',
);
export const fastModeWriteSettled = createAction<[providerId: string, editId: number]>(
  'providerSettings/fastModeWriteSettled',
);

export const initialState: ProviderSettingsState = {
  accessTokens: {},
  profiles: initialProfilesState,
  fastMode: emptyFastMode,
  enabledProviders: {},
  nonDisableableProviderIds: [],
  pendingEnablementOverrides: {},
  writeRevisions: {},
  sessions: [],
  requests: createCollection<ProviderSettingsRequest, 'id'>('id'),
  paths: { configured: {}, resolved: {}, secondary: {}, npxPackages: {} },
  pathsRevision: 0,
  pathsStatus: 'idle',
};

export const providerSettingsSessionOpened = createAction<[sessionId: string]>(
  'providerSettings/sessionOpened',
);
export const providerSettingsSessionClosed = createAction<[sessionId: string]>(
  'providerSettings/sessionClosed',
);
export const providerEnablementSeedRequested = createAction<[providers: Record<string, boolean>]>(
  'providerSettings/enablementSeedRequested',
);
export const providerPathsRequested = createAction('providerSettings/pathsRequested');
export const providerConfiguredPathsLoaded = createAction<
  [revision: number, configured: Record<string, string>]
>('providerSettings/configuredPathsLoaded');
export const providerPathsLoaded = createAction<[revision: number, paths: ProviderPaths]>(
  'providerSettings/pathsLoaded',
);
export const providerPathsFailed = createAction<[revision: number]>('providerSettings/pathsFailed');
export const providerPathSaveRequested = createAction<
  [providerId: string, path: string, request: ProviderSettingsRequestContext]
>('providerSettings/pathSaveRequested');
export const providerPathSaved = createAction<[providerId: string, path: string]>(
  'providerSettings/pathSaved',
);
export const providerSettingsRequestSettled = createAction<
  [id: string, status: Exclude<ProviderSettingsRequest['status'], 'pending'>]
>('providerSettings/requestSettled');
export const providerSettingsStopped = createAction('providerSettings/stopped');

function beginWrite(
  state: ProviderSettingsState,
  resource: string,
  request?: ProviderSettingsRequestContext,
): ProviderSettingsState {
  return {
    ...state,
    writeRevisions: {
      ...state.writeRevisions,
      [resource]: (state.writeRevisions[resource] ?? 0) + 1,
    },
    requests:
      request && state.sessions.includes(request.sessionId)
        ? addItem(state.requests, { ...request, resource, status: 'pending' })
        : state.requests,
  };
}

/** Request a provider/model default pair; the owning saga validates before accepting. */
export const setAtomicDefaultModel = createAction<[payload: { providerId: string; model: string }]>(
  'providerSettings/setAtomicDefaultModel',
);

/** Validated domain events: reducers and persistence consume accepted choices only. */
export const atomicDefaultModelAccepted = createAction<
  [payload: { providerId: string; model: string }]
>('providerSettings/atomicDefaultModelAccepted');
export const activeProviderAccepted = createAction<[providerId: string]>(
  'providerSettings/activeProviderAccepted',
);

function canBeDisabled(state: ProviderSettingsState, providerId: string): boolean {
  return !state.nonDisableableProviderIds.includes(providerId);
}

/**
 * Request a default provider (the provider leg of the default model
 * triple). The state lives in the model slice (`ModelState.defaultProviderId`)
 * and changes only from daemon receipts. The persistence saga validates the
 * quick-action snapshot before emitting activeProviderAccepted, then writes
 * `model.defaultProvider` (PROTOCOL §5.12).
 */
export const setActiveProvider = createAction<
  [providerId: string, request?: ProviderSettingsRequestContext]
>('providerSettings/setActiveProvider');

// NOTE: there is intentionally no "validate active provider against
// availability" action. Per decision D1(B) the active provider is never
// silently switched away because it's uninstalled/unavailable — the store
// keeps the user's selection and `selectIsActiveProviderAvailable` /
// `selectAvailableEnabledProviderIds` (provider-settings-selectors.ts) let
// the UI surface a failure state instead.

export const setProviderEnabled = createAction<
  [payload: { providerId: string; enabled: boolean }, request?: ProviderSettingsRequestContext]
>('providerSettings/setProviderEnabled');

export const toggleProvider = createAction<[providerId: string]>('providerSettings/toggleProvider');

export const ensureEnabledIfUnset = createAction<[providerId: string]>(
  'providerSettings/ensureEnabledIfUnset',
);

export const loadEnabledProvidersFromStorage = createAction<[providers: Record<string, boolean>]>(
  'providerSettings/loadEnabledProvidersFromStorage',
);

/**
 * Dispatched by the persistence saga when the daemon rejects an enablement
 * write (structured error response — not a transient transport failure).
 * Retires the provider's pending override so the renderer re-converges to
 * daemon state on the next hydration; the local map is left as-is until then.
 */
export const enablementPersistRejected = createAction<[providerId: string, revision?: number]>(
  'providerSettings/enablementPersistRejected',
);

export const providerSettingsReducer = createReducer<ProviderSettingsState>(initialState);
providerSettingsReducer.with(providerSettingsSessionOpened, (state, { payload: [sessionId] }) =>
  state.sessions.includes(sessionId)
    ? state
    : { ...state, sessions: [...state.sessions, sessionId] },
);
providerSettingsReducer.with(providerSettingsSessionClosed, (state, { payload: [sessionId] }) => {
  let requests = state.requests;
  for (const id of requests.ids) {
    if (getItem(requests, id)?.sessionId === sessionId) requests = removeItem(requests, id);
  }
  return { ...state, requests, sessions: state.sessions.filter((id) => id !== sessionId) };
});
providerSettingsReducer.with(setActiveProvider, (state, { payload: [providerId, request] }) =>
  providerId && request && state.sessions.includes(request.sessionId)
    ? {
        ...state,
        requests: addItem(state.requests, { ...request, resource: 'default', status: 'pending' }),
      }
    : state,
);
// Rejected admission must not supersede an earlier accepted write's settlement.
providerSettingsReducer.with(activeProviderAccepted, (state) => beginWrite(state, 'default'));
providerSettingsReducer.with(atomicDefaultModelAccepted, (state) => beginWrite(state, 'default'));
providerSettingsReducer.with(
  providerPathSaveRequested,
  (state, { payload: [providerId, , request] }) => ({
    ...beginWrite(state, `path:${providerId}`, request),
    pathsRevision: state.pathsRevision + 1,
    pathsStatus: state.pathsStatus === 'pending' ? 'idle' : state.pathsStatus,
  }),
);
providerSettingsReducer.with(providerPathsRequested, (state) => ({
  ...state,
  pathsRevision: state.pathsRevision + 1,
  pathsStatus: 'pending',
}));
providerSettingsReducer.with(
  providerConfiguredPathsLoaded,
  (state, { payload: [revision, configured] }) =>
    revision !== state.pathsRevision ? state : { ...state, paths: { ...state.paths, configured } },
);
providerSettingsReducer.with(providerPathsLoaded, (state, { payload: [revision, paths] }) =>
  revision !== state.pathsRevision ? state : { ...state, paths, pathsStatus: 'success' },
);
providerSettingsReducer.with(providerPathsFailed, (state, { payload: [revision] }) =>
  revision !== state.pathsRevision ? state : { ...state, pathsStatus: 'failure' },
);
providerSettingsReducer.with(providerPathSaved, (state, { payload: [providerId, path] }) => ({
  ...state,
  pathsRevision: state.pathsRevision + 1,
  pathsStatus: 'success',
  paths: { ...state.paths, configured: { ...state.paths.configured, [providerId]: path } },
}));
providerSettingsReducer.with(providerSettingsRequestSettled, (state, { payload: [id, status] }) => {
  const request = getItem(state.requests, id);
  if (!request || request.status !== 'pending') return state;
  return { ...state, requests: updateItem(state.requests, { id, status }) };
});
providerSettingsReducer.with(providerSettingsStopped, (state) => {
  let requests = state.requests;
  for (const id of requests.ids) {
    if (getItem(requests, id)?.status === 'pending')
      requests = updateItem(requests, { id, status: 'cancelled' });
  }
  return {
    ...state,
    requests,
    accessTokens: {},
    pathsRevision: state.pathsRevision + 1,
    pathsStatus: state.pathsStatus === 'pending' ? 'idle' : state.pathsStatus,
  };
});
providerSettingsReducer.with(providerCatalogLoaded, (state, { payload: [catalog] }) => ({
  ...state,
  nonDisableableProviderIds: catalog.providers
    .filter((provider) => provider.canBeDisabled === false)
    .map((provider) => provider.id),
  // The registry carries no default designation; the active provider is
  // user-derived (settings hydration / onboarding pick). Before those land
  // it stays '' — never silently adopted from the catalog.
}));
providerSettingsReducer.with(
  setProviderEnabled,
  (state, { payload: [{ providerId, enabled }, request] }) => {
    if (!canBeDisabled(state, providerId)) return state;
    return {
      ...beginWrite(state, `enabled:${providerId}`, request),
      enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
      pendingEnablementOverrides: {
        ...state.pendingEnablementOverrides,
        [providerId]: enabled,
      },
    };
  },
);
providerSettingsReducer.with(toggleProvider, (state, { payload: [providerId] }) => {
  if (!canBeDisabled(state, providerId)) return state;
  const enabled = !resolveProviderEnabled(state.enabledProviders, providerId);
  return {
    ...beginWrite(state, `enabled:${providerId}`),
    enabledProviders: { ...state.enabledProviders, [providerId]: enabled },
    pendingEnablementOverrides: {
      ...state.pendingEnablementOverrides,
      [providerId]: enabled,
    },
  };
});
providerSettingsReducer.with(ensureEnabledIfUnset, (state, { payload: [providerId] }) => {
  if (state.enabledProviders[providerId] !== undefined) {
    return state;
  }
  return {
    ...state,
    enabledProviders: { ...state.enabledProviders, [providerId]: true },
  };
});
providerSettingsReducer.with(
  enablementPersistRejected,
  (state, { payload: [providerId, revision] }) => {
    if (revision !== undefined && revision !== state.writeRevisions[`enabled:${providerId}`])
      return state;
    if (!(providerId in state.pendingEnablementOverrides)) return state;
    const pending = { ...state.pendingEnablementOverrides };
    delete pending[providerId];
    return { ...state, pendingEnablementOverrides: pending };
  },
);
providerSettingsReducer.with(loadEnabledProvidersFromStorage, (state, { payload: [providers] }) => {
  // Hydration (boot snapshot or settings:changed) never clobbers newer
  // local intent: still-pending overrides win over the incoming map, and a
  // matching incoming value confirms (retires) the override.
  const pending: Record<string, boolean> = {};
  for (const [providerId, enabled] of Object.entries(state.pendingEnablementOverrides)) {
    if (providers[providerId] !== enabled) pending[providerId] = enabled;
  }
  return {
    ...state,
    enabledProviders: { ...providers, ...pending },
    pendingEnablementOverrides: pending,
  };
});

providerSettingsReducer.with(hostExecutionConnectionChanged, () => initialState);
// Keep confirmed daemon state separate from queued local intent. An older echo or
// rejected write must never retire a newer click for the same provider.
providerSettingsReducer.with(fastModeHydrationStarted, (state) => ({
  ...state,
  fastMode: emptyFastMode,
}));
providerSettingsReducer.with(fastModeSupportReceived, (state, { payload: [supported] }) => ({
  ...state,
  fastMode: { ...state.fastMode, supported },
}));
providerSettingsReducer.with(
  hydrateProviderFastMode,
  (state, { payload: [confirmed, revision] }) => {
    const fastMode = state.fastMode;
    if (revision === undefined ? fastMode.revision > 0 : revision < fastMode.revision) return state;
    return {
      ...state,
      fastMode: { ...fastMode, confirmed, revision: revision ?? fastMode.revision },
    };
  },
);
providerSettingsReducer.with(setProviderFastMode, (state, { payload: [providerId, enabled] }) => {
  const fastMode = state.fastMode;
  if (!fastMode.supported || !isFastModeSettingKey(providerId)) return state;
  const editId = fastMode.nextEditId + 1;
  return {
    ...state,
    fastMode: {
      ...fastMode,
      nextEditId: editId,
      pending: { ...fastMode.pending, [providerId]: { enabled, editId } },
    },
  };
});
providerSettingsReducer.with(fastModeWriteSettled, (state, { payload: [providerId, editId] }) => {
  if (state.fastMode.pending[providerId]?.editId !== editId) return state;
  const pending = { ...state.fastMode.pending };
  delete pending[providerId];
  return { ...state, fastMode: { ...state.fastMode, pending } };
});

// ---------------------------------------------------------------------------
// Named provider profiles (§5.54). Env values never ride on an action: the
// creators stage them (provider-profiles-state) and the saga takes them once.
// ---------------------------------------------------------------------------

/** Read (or re-read) the profile list; ignored when the catalog advertises no profile support. */
export const providerProfilesRequested = createAction('providerProfiles/requested');
export const providerProfilesLoaded =
  createAction<[profiles: ProviderProfile[], revision: number, defaults?: ProviderDefaultConfig[]]>(
    'providerProfiles/loaded',
  );
export const providerProfilesLoadFailed = createAction('providerProfiles/loadFailed');
/** A `providers:profiles-changed` event (§5.54) — payload carries no env keys or values. */
export const providerProfilesChanged = createAction<[revision: number]>('providerProfiles/changed');

export const providerProfileCreateRequested = createAction(
  'providerProfiles/createRequested',
  (input: {
    requestId: string;
    baseProviderId: string;
    name: string;
    env?: EnvEntryWrite[];
    backup?: boolean;
  }) => ({
    requestId: input.requestId,
    baseProviderId: input.baseProviderId,
    name: input.name,
    envRef: stageProfileEnv(input.env),
    ...(input.backup !== undefined ? { backup: input.backup } : {}),
  }),
);
export const providerProfileUpdateRequested = createAction(
  'providerProfiles/updateRequested',
  (input: {
    requestId: string;
    profileId: string;
    name?: string;
    env?: EnvEntryWrite[];
    backup?: boolean;
  }) => ({
    requestId: input.requestId,
    profileId: input.profileId,
    name: input.name,
    envRef: stageProfileEnv(input.env),
    ...(input.backup !== undefined ? { backup: input.backup } : {}),
  }),
);
/**
 * Save the Default configuration's name and/or env (`providers.profiles.updateDefault`).
 * A blank name restores "Default"; omitted fields keep the saved value.
 */
export const providerDefaultUpdateRequested = createAction(
  'providerProfiles/defaultUpdateRequested',
  (input: { requestId: string; baseProviderId: string; name?: string; env?: EnvEntryWrite[] }) => ({
    requestId: input.requestId,
    baseProviderId: input.baseProviderId,
    name: input.name,
    envRef: stageProfileEnv(input.env),
  }),
);
export const providerDefaultUpdateSucceeded = createAction<
  [requestId: string, result: DefaultMutationResult]
>('providerProfiles/defaultUpdateSucceeded');

export const providerProfileDeleteRequested = createAction<
  [payload: { requestId: string; profileId: string }]
>('providerProfiles/deleteRequested');

/**
 * Save a new order for one base provider's profiles (`providers.profiles.reorder`).
 * Applied optimistically; a rejection restores the previous order. Only sent
 * when the daemon reports `backup` on profiles.
 */
export const providerProfileReorderRequested = createAction<
  [payload: { requestId: string; baseProviderId: string; profileIds: string[] }]
>('providerProfiles/reorderRequested');
export const providerProfileReorderSucceeded = createAction<
  [requestId: string, profiles: ProviderProfile[], revision: number]
>('providerProfiles/reorderSucceeded');

export const providerProfileMutationSucceeded = createAction<
  [requestId: string, result: ProfileMutationResult]
>('providerProfiles/mutationSucceeded');
export const providerProfileMutationFailed = createAction<
  [requestId: string, failure: ProviderProfileFailure]
>('providerProfiles/mutationFailed');
/** The UI is done with a settled request's outcome. */
export const providerProfileMutationDismissed = createAction<[requestId: string]>(
  'providerProfiles/mutationDismissed',
);

/** Re-check one profile's saved account state (`host.providerAuthStatus { providerId: ref }`). */
export const providerProfileCheckRequested = createAction<[profileId: string]>(
  'providerProfiles/checkRequested',
);
export const providerProfileStatusChanged = createAction<
  [profileId: string, status: ProviderProfileStatus]
>('providerProfiles/statusChanged');
/**
 * Model pickers (members included) need each listed profile's sign-in state
 * without opening Settings: probe the catalog's profile references once,
 * without forcing, and keep the verdict by profile id.
 */
export const providerProfileSummaryStatusesEnsured = createAction<
  [profiles: { id: string; providerRef: string }[]]
>('providerProfiles/summaryStatusesEnsured');
export const providerProfileSummaryStatusChanged = createAction<
  [profileId: string, status: ProviderProfileStatus]
>('providerProfiles/summaryStatusChanged');
/** Clear a shown activation notice once acknowledged. */
export const providerProfileActivationDismissed = createAction<[profileId: string]>(
  'providerProfiles/activationDismissed',
);

// Registration: state slice `profiles`, handlers in provider-profiles-state.
const withProfiles = (
  state: ProviderSettingsState,
  profiles: ProviderSettingsState['profiles'],
): ProviderSettingsState => (profiles === state.profiles ? state : { ...state, profiles });
providerSettingsReducer.with(providerProfilesLoaded, (state, { payload }) =>
  withProfiles(state, profileHandlers.loaded(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfilesLoadFailed, (state) =>
  withProfiles(state, profileHandlers.loadFailed(state.profiles, [])),
);
providerSettingsReducer.with(providerProfileCreateRequested, (state, { payload }) =>
  withProfiles(state, profileHandlers.create(state.profiles, [payload])),
);
providerSettingsReducer.with(providerProfileUpdateRequested, (state, { payload }) =>
  withProfiles(state, profileHandlers.update(state.profiles, [payload])),
);
providerSettingsReducer.with(providerDefaultUpdateRequested, (state, { payload }) =>
  withProfiles(state, profileHandlers.updateDefault(state.profiles, [payload])),
);
providerSettingsReducer.with(providerDefaultUpdateSucceeded, (state, { payload }) =>
  withProfiles(state, profileHandlers.defaultSucceeded(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileDeleteRequested, (state, { payload }) =>
  withProfiles(state, profileHandlers.delete(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileReorderRequested, (state, { payload }) =>
  withProfiles(state, profileHandlers.reorder(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileReorderSucceeded, (state, { payload }) =>
  withProfiles(state, profileHandlers.reorderSucceeded(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileMutationSucceeded, (state, { payload }) =>
  withProfiles(state, profileHandlers.succeeded(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileMutationFailed, (state, { payload }) =>
  withProfiles(state, profileHandlers.failed(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileMutationDismissed, (state, { payload }) =>
  withProfiles(state, profileHandlers.dismissed(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileStatusChanged, (state, { payload }) =>
  withProfiles(state, profileHandlers.statusChanged(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileSummaryStatusChanged, (state, { payload }) =>
  withProfiles(state, profileHandlers.summaryStatusChanged(state.profiles, payload)),
);
providerSettingsReducer.with(providerProfileActivationDismissed, (state, { payload }) =>
  withProfiles(state, profileHandlers.activationDismissed(state.profiles, payload)),
);

export const providerTokenReadRequested = createAction<[providerId: string]>(
  'providerSettings/tokenReadRequested',
);
export const providerTokenReadStarted = createAction<[providerId: string, requestId: string]>(
  'providerSettings/tokenReadStarted',
);
export const providerTokenWriteRequested = createAction<
  [providerId: string, operation: 'save' | 'remove', request: ProviderSettingsRequestContext]
>('providerSettings/tokenWriteRequested');
export const providerTokenSettled = createAction<
  [providerId: string, requestId: string, result: { configured: boolean } | null]
>('providerSettings/tokenSettled');

providerSettingsReducer.with(
  providerTokenReadStarted,
  (state, { payload: [providerId, requestId] }) => {
    if (state.accessTokens[providerId]?.busy) return state;
    return {
      ...state,
      accessTokens: {
        ...state.accessTokens,
        [providerId]: {
          status: 'loading',
          configured: false,
          busy: false,
          failed: false,
          requestId,
        },
      },
    };
  },
);
providerSettingsReducer.with(
  providerTokenWriteRequested,
  (state, { payload: [providerId, , request] }) => {
    const previous = state.accessTokens[providerId];
    if (
      !previous ||
      previous.status !== 'ready' ||
      previous.busy ||
      !state.sessions.includes(request.sessionId)
    )
      return state;
    return {
      ...state,
      accessTokens: {
        ...state.accessTokens,
        [providerId]: {
          ...previous,
          busy: true,
          failed: false,
          requestId: request.id,
        },
      },
    };
  },
);
providerSettingsReducer.with(
  providerTokenSettled,
  (state, { payload: [providerId, requestId, result] }) => {
    const previous = state.accessTokens[providerId];
    if (!previous || previous.requestId !== requestId) return state;
    const next: ProviderTokenState = result
      ? { ...previous, configured: result.configured, status: 'ready', busy: false, failed: false }
      : {
          ...previous,
          status: previous.busy ? 'ready' : 'error',
          busy: false,
          failed: previous.busy,
        };
    return { ...state, accessTokens: { ...state.accessTokens, [providerId]: next } };
  },
);
