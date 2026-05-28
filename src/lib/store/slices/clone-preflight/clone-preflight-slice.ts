/**
 * clone-preflight slice — short-lived UI state for the onboarding form's
 * pre-submit GitHub URL check.
 *
 * The onboarding form dispatches `checkClonePreflight(githubUrl)` whenever
 * the user types a GitHub URL. The saga debounces rapid changes, calls
 * `workspaceClient.preflightCloneCheck`, and writes the result back to the
 * slice so the form can render inline guidance (via the same
 * `WorkspaceCreationError` component used on the post-submit error path)
 * BEFORE the user clicks Create.
 *
 * The state is intentionally minimal: a status machine plus the URL and
 * error message that produced the current status. Nothing here is
 * workspace-scoped because the onboarding form is global.
 */
import { createAction } from '../../utils/create-action';
import { createReducer } from '../../utils/create-reducer';

export type ClonePreflightStatus = 'idle' | 'loading' | 'ok' | 'error';

export type ClonePreflightState = {
  status: ClonePreflightStatus;
  /** Trimmed github URL currently being checked or most recently checked. */
  url: string;
  /** Service-side error message when `status === 'error'`, else null. */
  error: string | null;
};

export const initialState: ClonePreflightState = {
  status: 'idle',
  url: '',
  error: null,
};

/**
 * Trigger: request a preflight check for the given GitHub URL. The saga
 * debounces so rapid keystrokes coalesce into a single IPC call and the
 * latest URL wins.
 */
export const checkClonePreflight = createAction<[githubUrl: string]>(
  'clonePreflight/check',
);

/** Saga → reducer: record that a check is in flight for the given URL. */
export const setClonePreflightLoading = createAction<[githubUrl: string]>(
  'clonePreflight/setLoading',
);

/** Saga → reducer: record a successful preflight for the given URL. */
export const setClonePreflightOk = createAction<[githubUrl: string]>(
  'clonePreflight/setOk',
);

/** Saga → reducer: record a failed preflight for the given URL. */
export const setClonePreflightError = createAction<
  [githubUrl: string, error: string]
>('clonePreflight/setError');

/** Reset back to idle (empty URL, no error). Used on tab switch or
 *  when the URL is cleared/invalid. */
export const clearClonePreflight = createAction('clonePreflight/clear');

export const clonePreflightReducer = createReducer<ClonePreflightState>(
  initialState,
)
  .with(setClonePreflightLoading, (state, { payload: [url] }) => ({
    ...state,
    status: 'loading',
    url,
    error: null,
  }))
  .with(setClonePreflightOk, (state, { payload: [url] }) => ({
    ...state,
    status: 'ok',
    url,
    error: null,
  }))
  .with(setClonePreflightError, (state, { payload: [url, error] }) => ({
    ...state,
    status: 'error',
    url,
    error,
  }))
  .with(clearClonePreflight, () => initialState);
