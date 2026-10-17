/**
 * Named provider profile state helpers (PROTOCOL §5.54). State lives in the
 * provider-settings slice (`providerSettings.profiles`); the actions and
 * their registration are in `provider-settings-slice.ts`.
 *
 * Environment values the user types are secrets. Redux action logging and the
 * saga monitor trace payloads verbatim, so values never ride on an action or
 * enter state: the creator stages the write list here and the saga takes it
 * once by `envRef`.
 */
import {
  addItem,
  createCollection,
  getItem,
  removeItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  EnvEntryWrite,
  ProfileActivation,
  ProviderProfile,
  ProviderProfileFailure,
} from '$shared/provider-profiles';
import type {
  ProviderProfileMutation,
  ProviderProfileStatus,
  ProviderProfilesState,
} from './provider-settings-types';

const stagedEnv = new Map<number, EnvEntryWrite[]>();
let nextEnvRef = 0;

/** Stage a write list for the saga; returns its single-use ref. */
export function stageProfileEnv(env: EnvEntryWrite[] | undefined): number | undefined {
  if (!env) return undefined;
  const ref = ++nextEnvRef;
  stagedEnv.set(ref, env);
  return ref;
}

/** Take (and clear) the env list staged for `ref`; `null` when absent or already consumed. */
export function takeStagedProfileEnv(ref: number): EnvEntryWrite[] | null {
  const env = stagedEnv.get(ref) ?? null;
  stagedEnv.delete(ref);
  return env;
}

export const initialProfilesState: ProviderProfilesState = {
  items: createCollection<ProviderProfile, 'id'>('id'),
  revision: -1,
  loadStatus: 'idle',
  status: {},
  activation: {},
  mutations: createCollection<ProviderProfileMutation, 'id'>('id'),
};

type Handler<P extends unknown[]> = (
  state: ProviderProfilesState,
  payload: P,
) => ProviderProfilesState;

function pendingMutation(
  state: ProviderProfilesState,
  mutation: Omit<ProviderProfileMutation, 'status'>,
): ProviderProfilesState {
  return { ...state, mutations: addItem(state.mutations, { ...mutation, status: 'pending' }) };
}

const onLoaded: Handler<[ProviderProfile[], number]> = (state, [profiles, revision]) =>
  revision < state.revision
    ? state
    : {
        ...state,
        items: createCollection<ProviderProfile, 'id'>('id', profiles),
        revision,
        loadStatus: 'success',
        status: Object.fromEntries(
          profiles.map((profile) => [profile.id, state.status[profile.id] ?? 'configured']),
        ),
      };

export type ProfileMutationResult = {
  revision: number;
  profile?: ProviderProfile;
  deletedProfileId?: string;
  activation?: ProfileActivation;
};

const onSucceeded: Handler<[string, ProfileMutationResult]> = (
  state,
  [requestId, { revision, profile, deletedProfileId, activation }],
) => {
  const mutation = getItem(state.mutations, requestId);
  if (!mutation) return state;
  let items = state.items;
  const status = { ...state.status };
  const activations = { ...state.activation };
  // An older result than the list already shown must not resurrect stale data.
  if (revision > state.revision) {
    if (profile) {
      items = getItem(items, profile.id) ? updateItem(items, profile) : addItem(items, profile);
      status[profile.id] ??= 'configured';
    }
    if (deletedProfileId) {
      items = removeItem(items, deletedProfileId);
      delete status[deletedProfileId];
      delete activations[deletedProfileId];
    }
  }
  if (profile && activation?.envChanged) activations[profile.id] = activation;
  return {
    ...state,
    items,
    status,
    activation: activations,
    revision: Math.max(state.revision, revision),
    mutations: updateItem(state.mutations, { id: requestId, status: 'success', activation }),
  };
};

export const profileHandlers = {
  loaded: onLoaded,
  loadFailed: ((state) => ({ ...state, loadStatus: 'failure' })) as Handler<[]>,
  create: ((state, [payload]) =>
    pendingMutation(state, { id: payload.requestId, kind: 'create' })) as Handler<
    [{ requestId: string }]
  >,
  update: ((state, [payload]) =>
    pendingMutation(state, {
      id: payload.requestId,
      kind: 'update',
      profileId: payload.profileId,
    })) as Handler<[{ requestId: string; profileId: string }]>,
  delete: ((state, [payload]) =>
    pendingMutation(state, {
      id: payload.requestId,
      kind: 'delete',
      profileId: payload.profileId,
    })) as Handler<[{ requestId: string; profileId: string }]>,
  succeeded: onSucceeded,
  failed: ((state, [requestId, failure]) =>
    getItem(state.mutations, requestId)
      ? {
          ...state,
          mutations: updateItem(state.mutations, { id: requestId, status: 'failure', failure }),
        }
      : state) as Handler<[string, ProviderProfileFailure]>,
  dismissed: ((state, [requestId]) =>
    getItem(state.mutations, requestId)
      ? { ...state, mutations: removeItem(state.mutations, requestId) }
      : state) as Handler<[string]>,
  statusChanged: ((state, [profileId, status]) =>
    getItem(state.items, profileId)
      ? { ...state, status: { ...state.status, [profileId]: status } }
      : state) as Handler<[string, ProviderProfileStatus]>,
  activationDismissed: ((state, [profileId]) => {
    if (!(profileId in state.activation)) return state;
    const activation = { ...state.activation };
    delete activation[profileId];
    return { ...state, activation };
  }) as Handler<[string]>,
};
