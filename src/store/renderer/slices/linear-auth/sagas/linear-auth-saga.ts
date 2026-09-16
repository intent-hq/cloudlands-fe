import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import type { LinearAuthState } from '$features/linear-auth/types';
import {
  LINEAR_ISSUE_FILTER_OPTIONS,
  type LinearIssueFilter,
} from '$features/linear-auth/constants';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';

import {
  connectLinear,
  hydrateLinearIssueFilter,
  initializeLinearAuth,
  initializeLinearIssueFilter,
  linearIssuesLoaded,
  linearIssuesLoadSettled,
  linearIssuesLoadStarted,
  loadLinearIssuesRequested,
  logoutLinear,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  setLinearIssueFilter,
  startLinearAuth,
} from '../linear-auth-slice';

const logger = createLogger('LinearAuthSaga');
const LINEAR_TOKEN_SETTING_PATH = 'linear.token';
const LINEAR_ISSUE_FILTER_STORAGE_KEY = 'legacy-settings:linearIssueFilter';
const LEGACY_LINEAR_ISSUE_FILTER_STORAGE_KEY = 'linearIssueFilter';

function isLinearIssueFilter(value: unknown): value is LinearIssueFilter {
  return LINEAR_ISSUE_FILTER_OPTIONS.some((option) => option.value === value);
}

function* hydrateIssueFilter(): SagaGenerator<void> {
  const current = yield* getLocalStorageJSON<LinearIssueFilter>(LINEAR_ISSUE_FILTER_STORAGE_KEY);
  if (isLinearIssueFilter(current)) {
    yield* put(hydrateLinearIssueFilter(current));
    return;
  }
  const legacy = yield* getLocalStorageItem(LEGACY_LINEAR_ISSUE_FILTER_STORAGE_KEY);
  const filter = isLinearIssueFilter(legacy) ? legacy : 'all';
  yield* put(hydrateLinearIssueFilter(filter));
  if (isLinearIssueFilter(legacy)) {
    yield* setLocalStorageJSON(LINEAR_ISSUE_FILTER_STORAGE_KEY, legacy);
  }
}

function* persistIssueFilter(action: ReturnType<typeof setLinearIssueFilter>): SagaGenerator<void> {
  yield* setLocalStorageJSON(LINEAR_ISSUE_FILTER_STORAGE_KEY, action.payload[0]);
}

function* probe(): SagaGenerator<LinearAuthState | null> {
  try {
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, state.requiresDaemonAuth, null));
    return state;
  } catch (error) {
    logger.error('Failed to initialize Linear auth', error);
    return null;
  }
}

function* loadIssues(action: ReturnType<typeof loadLinearIssuesRequested>): SagaGenerator<void> {
  yield* put(linearIssuesLoadStarted());
  try {
    const state = yield* call(probe);
    if (!state?.isAuthenticated) return;
    const issues = yield* call(
      [linearAuthClient, linearAuthClient.fetchMyIssues],
      action.payload[0],
    );
    yield* put(linearIssuesLoaded(issues));
  } catch (error) {
    logger.error('Failed to load Linear issues', error);
  } finally {
    yield* put(linearIssuesLoadSettled());
  }
}

function* connect(apiKey: string): SagaGenerator<void> {
  const key = apiKey.trim();
  if (!key) {
    yield* put(setLinearError(m.linearAuth_service_enterApiKey_error()));
    return;
  }
  yield* put(setLinearError(null));
  yield* put(setLinearIsAuthenticating(true));
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: LINEAR_TOKEN_SETTING_PATH, value: key }],
    );
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, false, null));
    if (!state.isAuthenticated)
      yield* put(setLinearError(m.linearAuth_service_keyRejected_error()));
  } catch (error) {
    yield* put(
      setLinearError(
        error instanceof Error ? error.message : m.linearAuth_service_storeKeyFailed_error(),
      ),
    );
    logger.error('Failed to connect Linear auth', error);
  } finally {
    yield* put(setLinearIsAuthenticating(false));
  }
}

function* logout(): SagaGenerator<void> {
  try {
    yield* call([appClient.settings, appClient.settings.reset], LINEAR_TOKEN_SETTING_PATH);
  } catch (error) {
    yield* put(
      setLinearError(
        error instanceof Error ? error.message : m.linearAuth_service_clearKeyFailed_error(),
      ),
    );
    logger.error('Failed to clear Linear auth', error);
    return;
  }
  try {
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, state.requiresDaemonAuth, null));
    if (state.isAuthenticated)
      yield* put(setLinearError(m.linearAuth_service_envKeyStillActive_error()));
  } catch {
    yield* put(setLinearAuthState(false, false, null));
  }
}

function* initializeLinearWorker(
  _action: ReturnType<typeof initializeLinearAuth>,
): SagaGenerator<void> {
  yield* call(probe);
}

function* startLinearWorker(_action: ReturnType<typeof startLinearAuth>): SagaGenerator<void> {
  yield* call(probe);
}

function* connectLinearWorker(action: ReturnType<typeof connectLinear>): SagaGenerator<void> {
  yield* race({ completed: call(connect, action.payload[0]), superseded: take(logoutLinear) });
}

function* logoutLinearWorker(_action: ReturnType<typeof logoutLinear>): SagaGenerator<void> {
  yield* race({ completed: call(logout), superseded: take(connectLinear) });
}

export function* linearAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeLinearAuth, initializeLinearWorker);
  yield* takeEvery(startLinearAuth, startLinearWorker);
  yield* takeLatest(connectLinear, connectLinearWorker);
  yield* takeLatest(logoutLinear, logoutLinearWorker);
  yield* takeEvery(initializeLinearIssueFilter, hydrateIssueFilter);
  yield* takeEvery(setLinearIssueFilter, persistIssueFilter);
  yield* takeLatest(loadLinearIssuesRequested, loadIssues);
}
