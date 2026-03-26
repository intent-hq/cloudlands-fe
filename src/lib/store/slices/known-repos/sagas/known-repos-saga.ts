import type { KnownRepo } from "$shared/types/known-repo";
import { invoke } from "$lib/electron-bridge";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { call, put, takeLatest } from "typed-redux-saga";
import {
  loadKnownRepos,
  removeKnownRepo,
  removeRepo,
  setRepos,
} from "../known-repos-slice";

type KnownReposResponse = {
  success: boolean;
  data?: KnownRepo[];
};

type RemoveKnownRepoResponse = {
  success: boolean;
  data?: { removed: boolean };
};

export function* loadKnownReposSaga() {
  try {
    const result: KnownReposResponse = yield* call(
      invoke<KnownReposResponse>,
      IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
      {}
    );

    if (result?.success && Array.isArray(result.data)) {
      yield* put(setRepos(result.data));
      return;
    }
  } catch {
    // Silently ignore - known repos are a nice-to-have.
  }

  yield* put(setRepos([]));
}

export function* removeKnownRepoSaga(
  action: ReturnType<typeof removeKnownRepo>
) {
  const [repoPath] = action.payload;

  try {
    const result: RemoveKnownRepoResponse = yield* call(
      invoke<RemoveKnownRepoResponse>,
      IPC_CHANNELS.WORKSPACE.REMOVE_RECENT_REPOSITORY,
      { repository: repoPath }
    );

    if (result?.data?.removed) {
      yield* put(removeRepo(repoPath));
    }
  } catch {
    // Silently ignore - best effort.
  }
}

export function* knownReposSaga() {
  yield* takeLatest(loadKnownRepos, loadKnownReposSaga);
  yield* takeLatest(removeKnownRepo, removeKnownRepoSaga);
}