import type { Task } from 'redux-saga';
import { all, call, cancel, fork, put, take, type SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { getRepoFolderName } from '$lib/components/workspace/initializer/recent-repo-display';
import { localRepoOptions } from '$features/onboarding/utils/local-repo-options';
import type { KnownRepo } from '$shared/types/known-repo';
import type { Workspace } from '$shared/types';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { connectionsListReceived } from '../../connections/connections-slice';
import type { DirectoryPickerListing } from '../../directory-picker/directory-picker-slice';
import {
  discoverLocalReposRequested,
  localRepoDiscoveryFailed,
  localRepoDiscoveryStarted,
  localRepoDiscoverySucceeded,
  onboardingPickerClosed,
  onboardingPickerOpened,
  resetLocalRepoDiscovery,
} from '../known-repos-slice';

function* discover(backendId: string): SagaGenerator<void> {
  yield* put(localRepoDiscoveryStarted(backendId));
  try {
    // Never infer emptiness from the initial, not-yet-hydrated Redux arrays.
    // These reads also keep the decision scoped to this backend's data.
    const { registry, list } = yield* all({
      registry: call(backendRequest<{ repos: KnownRepo[] }>, 'repo.list', {}),
      list: call(backendRequest<{ workspaces: Workspace[] }>, 'workspace.list', {
        includeArchived: true,
      }),
    });
    if (!Array.isArray(registry?.repos) || !Array.isArray(list?.workspaces)) {
      throw new Error('Invalid repository discovery preflight response');
    }
    const existing = localRepoOptions(registry.repos, list.workspaces);
    if (existing.length > 0) {
      yield* put(localRepoDiscoverySucceeded(backendId, existing));
      return;
    }
    const { home } = yield* call(backendRequest<DirectoryPickerListing>, 'host.listDirectory', {});
    // host.listDirectory falls back to filesystem root if HOME cannot be
    // resolved. That is not permission to turn a home scan into a disk crawl.
    if (!home || /^[/\\]+$/.test(home) || /^[a-z]:[/\\]*$/i.test(home)) {
      throw new Error('Home directory unavailable');
    }
    const { repositories } = yield* call(
      backendRequest<{ repositories: string[] }>,
      'workspace.findRepositories',
      { directory: home },
    );
    const options = repositories.map((path) => ({ path, name: getRepoFolderName(path) || path }));
    yield* put(
      localRepoDiscoverySucceeded(backendId, localRepoOptions([], list.workspaces, options)),
    );
  } catch {
    // Non-blocking status, never an automatic retry or raw filesystem error in the UI.
    yield* put(localRepoDiscoveryFailed(backendId));
  }
}

/** One attempt per picker session; local-tab remounts never own the operation. */
export function* localRepoDiscoverySaga(): SagaGenerator<void> {
  let worker: Task | undefined;
  let open = false;
  let requested = false;
  let attempted = false;
  let backendId = yield* selectActiveBackendId();
  while (true) {
    const action = yield* take([
      onboardingPickerOpened,
      onboardingPickerClosed,
      discoverLocalReposRequested,
      connectionsListReceived,
    ]);
    const nextBackendId = yield* selectActiveBackendId();
    if (
      action.type === onboardingPickerOpened.type ||
      action.type === onboardingPickerClosed.type ||
      nextBackendId !== backendId
    ) {
      if (worker) yield* cancel(worker);
      worker = undefined;
      attempted = false;
      backendId = nextBackendId;
      yield* put(resetLocalRepoDiscovery());
    }
    if (action.type === onboardingPickerOpened.type) {
      open = true;
      requested = (action as ReturnType<typeof onboardingPickerOpened>).payload[0];
    } else if (action.type === onboardingPickerClosed.type) {
      open = false;
      requested = false;
    } else if (action.type === discoverLocalReposRequested.type) {
      requested = true;
    }
    if (open && requested && !attempted) {
      attempted = true;
      worker = yield* fork(discover, backendId);
    }
  }
}
