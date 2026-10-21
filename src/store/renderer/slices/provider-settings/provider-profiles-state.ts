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
  getItems,
  removeItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  permuteBaseProfiles,
  type EnvEntryWrite,
  type ProfileActivation,
  type ProviderProfile,
  type ProviderProfileFailure,
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

/**
 * Apply a read's per-profile activation count: the earlier-settings notice
 * shows while processes remain and clears itself at zero. A read without the
 * count leaves the last known state (dismiss still clears it).
 */
function readActivation(
  activation: ProviderProfilesState['activation'],
  profile: ProviderProfile,
): ProviderProfilesState['activation'] {
  const runningProcesses = profile.activation?.runningProcesses;
  if (runningProcesses === undefined) return activation;
  const next = { ...activation };
  if (runningProcesses > 0)
    next[profile.id] = { envChanged: next[profile.id]?.envChanged ?? true, runningProcesses };
  else delete next[profile.id];
  return next;
}

const onLoaded: Handler<[ProviderProfile[], number]> = (state, [profiles, revision]) => {
  if (revision < state.revision) return state;
  const ids = new Set(profiles.map((profile) => profile.id));
  let activation = Object.fromEntries(
    Object.entries(state.activation).filter(([id]) => ids.has(id)),
  );
  for (const profile of profiles) activation = readActivation(activation, profile);
  return {
    ...state,
    items: createCollection<ProviderProfile, 'id'>('id', profiles),
    revision,
    loadStatus: 'success',
    status: Object.fromEntries(
      profiles.map((profile) => [profile.id, state.status[profile.id] ?? 'configured']),
    ),
    activation,
  };
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
  if (profile && activation?.envChanged) {
    if (activation.runningProcesses > 0) activations[profile.id] = activation;
    else delete activations[profile.id];
  } else if (profile && revision > state.revision) {
    const next = readActivation(activations, profile);
    if (!(profile.id in next)) delete activations[profile.id];
    else activations[profile.id] = next[profile.id];
  }
  return {
    ...state,
    items,
    status,
    activation: activations,
    revision: Math.max(state.revision, revision),
    mutations: updateItem(state.mutations, { id: requestId, status: 'success', activation }),
  };
};

/** Re-slot one base provider's profiles; unchanged state when the ids do not match. */
function withBaseOrder(
  state: ProviderProfilesState,
  baseProviderId: string,
  orderedIds: readonly string[],
  replacements: readonly ProviderProfile[] = [],
): ProviderProfilesState['items'] {
  const next = permuteBaseProfiles(getItems(state.items), baseProviderId, orderedIds, replacements);
  return next ? createCollection<ProviderProfile, 'id'>('id', next) : state.items;
}

/** Optimistic reorder: show the new order now and remember the old one for rollback. */
const onReorder: Handler<[{ requestId: string; baseProviderId: string; profileIds: string[] }]> = (
  state,
  [{ requestId, baseProviderId, profileIds }],
) => {
  const previousOrder = getItems(state.items)
    .filter((profile) => profile.baseProviderId === baseProviderId)
    .map((profile) => profile.id);
  return {
    ...pendingMutation(state, { id: requestId, kind: 'reorder', baseProviderId, previousOrder }),
    items: withBaseOrder(state, baseProviderId, profileIds),
  };
};

const onReorderSucceeded: Handler<[string, ProviderProfile[], number]> = (
  state,
  [requestId, profiles, revision],
) => {
  const mutation = getItem(state.mutations, requestId);
  if (!mutation) return state;
  const baseProviderId = mutation.baseProviderId ?? profiles[0]?.baseProviderId;
  // An older result than the list already shown must not resurrect stale data.
  const items =
    revision > state.revision && baseProviderId
      ? withBaseOrder(
          state,
          baseProviderId,
          profiles.map((profile) => profile.id),
          profiles,
        )
      : state.items;
  return {
    ...state,
    items,
    revision: Math.max(state.revision, revision),
    mutations: updateItem(state.mutations, { id: requestId, status: 'success' }),
  };
};

const onFailed: Handler<[string, ProviderProfileFailure]> = (state, [requestId, failure]) => {
  const mutation = getItem(state.mutations, requestId);
  if (!mutation) return state;
  const items =
    mutation.kind === 'reorder' && mutation.baseProviderId && mutation.previousOrder
      ? withBaseOrder(state, mutation.baseProviderId, mutation.previousOrder)
      : state.items;
  return {
    ...state,
    items,
    mutations: updateItem(state.mutations, { id: requestId, status: 'failure', failure }),
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
  reorder: onReorder,
  reorderSucceeded: onReorderSucceeded,
  failed: onFailed,
  dismissed: ((state, [requestId]) =>
    getItem(state.mutations, requestId)
      ? { ...state, mutations: removeItem(state.mutations, requestId) }
      : state) as Handler<[string]>,
  statusChanged: ((state, [profileId, status]) =>
    getItem(state.items, profileId)
      ? { ...state, status: { ...state.status, [profileId]: status } }
      : state) as Handler<[string, ProviderProfileStatus]>,
  // Catalog summaries are not in `items` for members; the saga only records a
  // verdict for a profile the catalog still lists.
  summaryStatusChanged: ((state, [profileId, status]) =>
    state.status[profileId] === status
      ? state
      : { ...state, status: { ...state.status, [profileId]: status } }) as Handler<
    [string, ProviderProfileStatus]
  >,
  activationDismissed: ((state, [profileId]) => {
    if (!(profileId in state.activation)) return state;
    const activation = { ...state.activation };
    delete activation[profileId];
    return { ...state, activation };
  }) as Handler<[string]>,
};
