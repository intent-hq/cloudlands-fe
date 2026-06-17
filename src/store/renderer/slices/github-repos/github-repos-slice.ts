/**
 * github-repos slice — caches the authenticated user's GitHub repositories
 * for reuse across the app (onboarding repo picker, future repo search, etc.).
 *
 * State is saga-driven: dispatch `loadGithubRepos` to fetch and the saga will
 * populate the collection. The slice is automatically re-loaded on GitHub
 * auth changes and cleared on sign-out. Components never call IPC directly.
 */
import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  type Collection,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

/**
 * Normalized repo shape stored in the Collection. `id` is derived at the
 * saga boundary as `${owner}/${name}` so we always have a stable string key
 * for Collection lookups — Collection requires a single string ID field.
 */
export type GithubRepoItem = {
  id: string;
  owner: string;
  name: string;
  defaultBranch?: string;
};

export type GithubReposState = {
  repos: Collection<GithubRepoItem, "id">;
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

export const initialState: GithubReposState = {
  repos: createCollection<GithubRepoItem, "id">("id"),
  loading: false,
  loaded: false,
  error: null,
};

/** Trigger: load the authenticated user's GitHub repositories. */
export const loadGithubRepos = createAction("githubRepos/load");

/** Mark the slice as loading (clears any previous error). */
export const setGithubReposLoading = createAction(
  "githubRepos/setLoading",
);

/** Store a fresh list of repos. */
export const setGithubRepos = createAction<[repos: GithubRepoItem[]]>(
  "githubRepos/setRepos",
);

/** Surface a load error to the UI. */
export const setGithubReposError = createAction<[error: string]>(
  "githubRepos/setError",
);

/** Reset to the initial empty state (e.g. on GitHub logout). */
export const clearGithubRepos = createAction("githubRepos/clear");

export const githubReposReducer = createReducer<GithubReposState>(initialState)
  .with(setGithubReposLoading, (state) => ({
    ...state,
    loading: true,
    error: null,
  }))
  .with(setGithubRepos, (state, { payload: [repos] }) => ({
    ...state,
    repos: createCollection<GithubRepoItem, "id">("id", repos),
    loading: false,
    loaded: true,
    error: null,
  }))
  .with(setGithubReposError, (state, { payload: [error] }) => ({
    ...state,
    loading: false,
    error,
  }))
  .with(clearGithubRepos, () => initialState);
