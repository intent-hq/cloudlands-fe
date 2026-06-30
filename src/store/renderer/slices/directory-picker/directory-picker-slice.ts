/**
 * directory-picker slice — short-lived UI state for the BE-driven onboarding
 * folder picker (`DirectoryPickerModal`).
 *
 * The modal dispatches `loadDirectoryRequested(path?)` whenever it opens or the
 * user navigates into a folder. The companion read service
 * (`directory-picker-read-service`) observes that action, calls
 * `backendRequest<Listing>('host.listDirectory', ...)`, and writes the result
 * back to the slice so the component can render purely from selectors. The
 * component itself never imports the live backend transport.
 *
 * State is intentionally minimal and global: only one picker modal is open at a
 * time, so a single slot for `listing` / `loading` / `error` is sufficient. The
 * `requestedPath` field records the path that the most-recent dispatch asked
 * for (or `null` for "daemon-host home") so the read service can echo it back
 * with the success/error action and the slice can ignore stale responses.
 */
import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";

/** One directory entry returned by `host.listDirectory`. */
export interface DirectoryPickerEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

/** Directory listing returned by `host.listDirectory`. */
export interface DirectoryPickerListing {
  path: string;
  parent: string | null;
  home: string;
  entries: DirectoryPickerEntry[];
}

export type DirectoryPickerState = {
  /** Loaded listing for the current path, or `null` before the first load. */
  listing: DirectoryPickerListing | null;
  /** True while a `host.listDirectory` request is in flight. */
  loading: boolean;
  /** Last error message from `host.listDirectory`, or `null` on success. */
  error: string | null;
  /**
   * Path that the most-recent `loadDirectoryRequested` dispatch asked for, or
   * `null` for the daemon-host home. The read service echoes this back with
   * the success/error action so stale responses can be discarded.
   */
  requestedPath: string | null;
};

export const initialState: DirectoryPickerState = {
  listing: null,
  loading: false,
  error: null,
  requestedPath: null,
};

/**
 * Trigger: ask the read service to load `path` (or the daemon-host home when
 * `path` is `undefined`). The reducer flips to loading immediately so the
 * spinner shows without waiting for the IPC round-trip.
 */
export const loadDirectoryRequested = createAction<[path?: string]>(
  "directoryPicker/loadRequested",
);

/** Service → reducer: a successful listing for `requestedPath`. */
export const directoryListingLoaded = createAction<
  [requestedPath: string | null, listing: DirectoryPickerListing]
>("directoryPicker/listingLoaded");

/** Service → reducer: a failed listing for `requestedPath`. */
export const directoryListingFailed = createAction<
  [requestedPath: string | null, error: string]
>("directoryPicker/listingFailed");

/** Reset back to the initial state — dispatched when the modal closes. */
export const resetDirectoryPicker = createAction("directoryPicker/reset");

export const directoryPickerReducer = createReducer<DirectoryPickerState>(
  initialState,
)
  .with(loadDirectoryRequested, (state, { payload: [path] }) => ({
    ...state,
    loading: true,
    error: null,
    requestedPath: path ?? null,
  }))
  .with(directoryListingLoaded, (state, { payload: [requestedPath, listing] }) => {
    // Discard stale responses: only apply when the response matches the most
    // recent request the reducer recorded.
    if (state.requestedPath !== requestedPath) return state;
    return {
      ...state,
      loading: false,
      error: null,
      listing,
    };
  })
  .with(directoryListingFailed, (state, { payload: [requestedPath, error] }) => {
    if (state.requestedPath !== requestedPath) return state;
    return {
      ...state,
      loading: false,
      error,
      listing: null,
    };
  })
  .with(resetDirectoryPicker, () => initialState);
