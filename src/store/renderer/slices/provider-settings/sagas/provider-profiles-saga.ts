/**
 * Sole owner of `providers.profiles.*` traffic (PROTOCOL §5.54).
 *
 * - Reads are single-flight with one trailing re-read: a burst of requests or
 *   `providers:profiles-changed` events during a list collapses to one more.
 * - Mutations run one at a time in dispatch order. Staged env writes are
 *   taken once and passed straight to the client; they never enter state,
 *   actions, or logs.
 * - Account status is probed per profile reference after reads and saves.
 *   Saving never implies ready.
 */
import { buffers } from 'redux-saga';
import { actionChannel, all, call, fork, put, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { getProviderAuthVerdicts } from '$features/providers/provider-auth-status.client';
import {
  classifyProviderProfileError,
  type EnvEntryWrite,
  type ProviderProfile,
} from '$shared/provider-profiles';
import {
  providerProfileCheckRequested,
  providerProfileCreateRequested,
  providerProfileDeleteRequested,
  providerProfileMutationFailed,
  providerProfileMutationSucceeded,
  providerProfileReorderRequested,
  providerProfileReorderSucceeded,
  providerProfilesChanged,
  providerProfilesLoadFailed,
  providerProfilesLoaded,
  providerProfilesRequested,
  providerProfileStatusChanged,
  providerProfileSummaryStatusChanged,
  providerProfileSummaryStatusesEnsured,
  providerProfileUpdateRequested,
} from '../provider-settings-slice';
import {
  selectProfileCapableProviderIds,
  selectProviderProfile,
  selectProviderProfileMutations,
  selectProviderSettingsHasOpenSession,
  selectProviderProfilesLoadStatus,
  selectProviderProfilesRevision,
} from '../provider-settings-selectors';
import type { ProviderProfileStatus } from '../provider-settings-types';
import { takeStagedProfileEnv } from '../provider-profiles-state';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';
import { selectProviderCatalogProfiles } from '../../provider-catalog/provider-catalog-selectors';
import { selectProfileSignInStatuses } from '../provider-profile-status-selectors';

const logger = createLogger('ProviderProfilesSaga');

export interface ProviderProfilesSagaDeps {
  /** `host.providerAuthStatus { providerId: providerRef }` verdict: true / false / unknown. */
  authStatus(providerRef: string, force: boolean): Promise<boolean | undefined>;
}

const defaultDeps: ProviderProfilesSagaDeps = {
  async authStatus(providerRef, force) {
    const verdicts = await getProviderAuthVerdicts({ providerId: providerRef, force });
    return verdicts[providerRef]?.authenticated;
  },
};

function toStatus(authenticated: boolean | undefined): ProviderProfileStatus {
  if (authenticated === true) return 'ready';
  if (authenticated === false) return 'error';
  return 'configured';
}

function* checkProfile(deps: ProviderProfilesSagaDeps, profile: ProviderProfile, force: boolean) {
  yield* put(providerProfileStatusChanged(profile.id, 'checking'));
  let status: ProviderProfileStatus = 'configured';
  try {
    status = toStatus(yield* call([deps, deps.authStatus], profile.providerRef, force));
  } catch (error) {
    logger.warn('Provider profile status check failed', { profileId: profile.id, error });
  }
  // A profile deleted while its probe was pending must not reappear.
  if (yield* selectProviderProfile.effect(profile.id))
    yield* put(providerProfileStatusChanged(profile.id, status));
}

function* loadProfiles(deps: ProviderProfilesSagaDeps) {
  if ((yield* selectProfileCapableProviderIds.effect()).length === 0) return;
  try {
    const result = yield* call([appClient.providers, appClient.providers.listProfiles]);
    yield* put(providerProfilesLoaded(result.profiles, result.revision));
    for (const profile of result.profiles) yield* fork(checkProfile, deps, profile, false);
  } catch (error) {
    logger.warn('providers.profiles.list failed', { error });
    yield* put(providerProfilesLoadFailed());
  }
}

function* readLoop(deps: ProviderProfilesSagaDeps) {
  // Sliding(1): one in flight plus at most one trailing read.
  const requests = yield* actionChannel(providerProfilesRequested, buffers.sliding(1));
  while (true) {
    yield* take(requests);
    yield* call(loadProfiles, deps);
  }
}

/**
 * Model pickers read profile summaries from `providers.catalog` (members
 * included), which `providers:profiles-changed` invalidates. Sliding(1): one
 * catalog read in flight plus at most one trailing read per event burst.
 */
function* catalogRefreshLoop() {
  const changes = yield* actionChannel(providerProfilesChanged, buffers.sliding(1));
  while (true) {
    yield* take(changes);
    yield* call(hydrateProviderCatalog);
  }
}

function* onProfilesChanged(action: ReturnType<typeof providerProfilesChanged>) {
  const [revision] = action.payload;
  if ((yield* selectProviderProfilesLoadStatus.effect()) === 'idle') return;
  if (revision > (yield* selectProviderProfilesRevision.effect()))
    yield* put(providerProfilesRequested());
}

/** A catalog that arrives after Settings opened may be the first to advertise profiles. */
function* onCatalogLoaded() {
  if (
    (yield* selectProviderSettingsHasOpenSession.effect()) &&
    (yield* selectProfileCapableProviderIds.effect()).length > 0
  )
    yield* put(providerProfilesRequested());
}

function takeEnv(envRef: number | undefined): EnvEntryWrite[] | undefined {
  if (envRef === undefined) return undefined;
  const env = takeStagedProfileEnv(envRef);
  if (!env) throw new Error('Staged provider profile env is no longer available');
  return env;
}

type MutationAction =
  | ReturnType<typeof providerProfileCreateRequested>
  | ReturnType<typeof providerProfileUpdateRequested>
  | ReturnType<typeof providerProfileDeleteRequested>
  | ReturnType<typeof providerProfileReorderRequested>;

/**
 * Save one base provider's order. The slice already shows it. A request the
 * slice ignored (another reorder of that base was pending) is not sent. A
 * rejection keeps no client snapshot: the list is re-read and the daemon's
 * saved order wins.
 */
function* runReorder(action: ReturnType<typeof providerProfileReorderRequested>) {
  const [{ requestId, baseProviderId, profileIds }] = action.payload;
  if ((yield* selectProviderProfileMutations.effect())[requestId]?.status !== 'pending') return;
  try {
    const result = yield* call([appClient.providers, appClient.providers.reorderProfiles], {
      baseProviderId,
      profileIds,
    });
    yield* put(providerProfileReorderSucceeded(requestId, result.profiles, result.revision));
  } catch (error) {
    const failure = classifyProviderProfileError(error);
    logger.warn('Provider profile reorder rejected', { kind: failure.kind });
    yield* put(providerProfileMutationFailed(requestId, failure));
    yield* put(providerProfilesRequested());
  }
}

function* runMutation(deps: ProviderProfilesSagaDeps, action: MutationAction) {
  if (action.type === providerProfileReorderRequested.type) {
    yield* call(runReorder, action as ReturnType<typeof providerProfileReorderRequested>);
    return;
  }
  const isDelete = (a: MutationAction): a is ReturnType<typeof providerProfileDeleteRequested> =>
    a.type === providerProfileDeleteRequested.type;
  const requestId = isDelete(action)
    ? action.payload[0].requestId
    : (
        action as
          | ReturnType<typeof providerProfileCreateRequested>
          | ReturnType<typeof providerProfileUpdateRequested>
      ).payload.requestId;
  try {
    if (action.type === providerProfileCreateRequested.type) {
      const { baseProviderId, name, envRef, backup } = (
        action as ReturnType<typeof providerProfileCreateRequested>
      ).payload;
      const env = takeEnv(envRef);
      const result = yield* call([appClient.providers, appClient.providers.createProfile], {
        baseProviderId,
        name,
        ...(env ? { env } : {}),
        ...(backup !== undefined ? { backup } : {}),
      });
      yield* put(
        providerProfileMutationSucceeded(requestId, {
          revision: result.revision,
          profile: result.profile,
        }),
      );
      yield* fork(checkProfile, deps, result.profile, true);
    } else if (action.type === providerProfileUpdateRequested.type) {
      const { profileId, name, envRef, backup } = (
        action as ReturnType<typeof providerProfileUpdateRequested>
      ).payload;
      const env = takeEnv(envRef);
      const result = yield* call([appClient.providers, appClient.providers.updateProfile], {
        profileId,
        ...(name !== undefined ? { name } : {}),
        ...(env ? { env } : {}),
        ...(backup !== undefined ? { backup } : {}),
      });
      yield* put(
        providerProfileMutationSucceeded(requestId, {
          revision: result.revision,
          profile: result.profile,
          activation: result.activation,
        }),
      );
      // Saved env drives the next process's account; re-check that saved state.
      if (result.activation.envChanged) yield* fork(checkProfile, deps, result.profile, true);
    } else if (isDelete(action)) {
      const [{ profileId }] = action.payload;
      const result = yield* call(
        [appClient.providers, appClient.providers.deleteProfile],
        profileId,
      );
      yield* put(
        providerProfileMutationSucceeded(requestId, {
          revision: result.revision,
          deletedProfileId: result.profileId,
        }),
      );
    }
  } catch (error) {
    const failure = classifyProviderProfileError(error);
    logger.warn('Provider profile mutation rejected', { kind: failure.kind });
    yield* put(providerProfileMutationFailed(requestId, failure));
    if (failure.kind === 'notFound') yield* put(providerProfilesRequested());
  }
}

function* mutationLoop(deps: ProviderProfilesSagaDeps) {
  const mutations = yield* actionChannel(
    [
      providerProfileCreateRequested,
      providerProfileUpdateRequested,
      providerProfileDeleteRequested,
      providerProfileReorderRequested,
    ],
    buffers.expanding(),
  );
  while (true) {
    const action = (yield* take(mutations)) as MutationAction;
    yield* call(runMutation, deps, action);
  }
}

/**
 * Probe each listed profile once (not forced) so pickers can flag a signed-out
 * profile. A profile already probed, or in flight, is skipped; a verdict for a
 * profile the catalog no longer lists is dropped.
 */
function* ensureSummaryStatuses(
  deps: ProviderProfilesSagaDeps,
  inFlight: Set<string>,
  action: ReturnType<typeof providerProfileSummaryStatusesEnsured>,
) {
  const known = yield* selectProfileSignInStatuses.effect();
  for (const profile of action.payload[0]) {
    if (known[profile.id] || inFlight.has(profile.id)) continue;
    inFlight.add(profile.id);
    yield* fork(function* () {
      let status: ProviderProfileStatus = 'configured';
      try {
        status = toStatus(yield* call([deps, deps.authStatus], profile.providerRef, false));
      } catch (error) {
        logger.warn('Provider profile status check failed', { profileId: profile.id, error });
      } finally {
        inFlight.delete(profile.id);
      }
      const listed = (yield* selectProviderCatalogProfiles.effect()).some(
        (summary) => summary.id === profile.id,
      );
      if (listed) yield* put(providerProfileSummaryStatusChanged(profile.id, status));
    });
  }
}

function* onCheckRequested(
  deps: ProviderProfilesSagaDeps,
  action: ReturnType<typeof providerProfileCheckRequested>,
) {
  const profile = yield* selectProviderProfile.effect(action.payload[0]);
  if (profile) yield* call(checkProfile, deps, profile, true);
}

export function* providerProfilesSaga(deps: ProviderProfilesSagaDeps = defaultDeps) {
  yield* all([
    call(readLoop, deps),
    call(mutationLoop, deps),
    call(catalogRefreshLoop),
    takeEvery(providerProfilesChanged, onProfilesChanged),
    takeEvery(providerCatalogLoaded, onCatalogLoaded),
    takeEvery(providerProfileCheckRequested, onCheckRequested, deps),
    takeEvery(
      providerProfileSummaryStatusesEnsured,
      ensureSummaryStatuses,
      deps,
      new Set<string>(),
    ),
  ]);
}
