/**
 * Sentry Auth Saga
 *
 * Handles side effects for Sentry authentication: IPC calls via sentryAuthClient.
 */

import {
  call,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import { sentryAuthClient } from "$features/sentry-auth/renderer/sentry-auth.client";
import {
  initializeSentryAuth,
  connectSentry,
  logoutSentry,
  fetchSentryProjects,
  fetchSentryIssues,
  searchSentryIssues,
  setSentryAuthState,
  setSentryConnecting,
  setSentryError,
  setSentryConnected,
  setSentryLoggedOut,
  setSentryProjects,
  setSentryLoadingProjects,
  setSentryIssues,
  setSentryLoadingIssues,
} from "../sentry-auth-slice";
import { selectSentryIsAuthenticated } from "../sentry-auth-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("SentryAuthSaga");

// =============================================================================
// Handlers
// =============================================================================

function* handleInitialize(): SagaGenerator<void> {
  try {
    const authState = yield* call([sentryAuthClient, sentryAuthClient.getAuthState]);
    yield* put(
      setSentryAuthState(
        authState.isAuthenticated,
        authState.organization ?? null,
        authState.error ?? null,
      ),
    );
    logger.debug("Initialized", { isAuthenticated: authState.isAuthenticated });
  } catch (error) {
    logger.error("Failed to initialize", error);
  }
}

function* handleConnect(
  action: ReturnType<typeof connectSentry>,
): SagaGenerator<void> {
  const [organization, apiToken] = action.payload;
  yield* put(setSentryError(null));
  yield* put(setSentryConnecting(true));

  try {
    const result = yield* call(
      [sentryAuthClient, sentryAuthClient.saveConfig],
      organization,
      apiToken,
    );

    if (!result.success) {
      yield* put(setSentryError(result.error ?? "Failed to connect to Sentry"));
      yield* put(setSentryConnecting(false));
      return;
    }

    yield* put(setSentryConnected(organization));

    // Fetch projects after successful connection
    yield* call(handleFetchProjects);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect to Sentry";
    yield* put(setSentryError(message));
    yield* put(setSentryConnecting(false));
  }
}

function* handleLogout(): SagaGenerator<void> {
  try {
    yield* call([sentryAuthClient, sentryAuthClient.logout]);
    yield* put(setSentryLoggedOut());
  } catch (error) {
    logger.error("Failed to logout", error);
  }
}

function* handleFetchProjects(): SagaGenerator<void> {
  const isAuthenticated = yield* selectSentryIsAuthenticated.effect();
  if (!isAuthenticated) return;

  yield* put(setSentryLoadingProjects(true));
  try {
    const projects = yield* call([sentryAuthClient, sentryAuthClient.fetchProjects]);
    yield* put(setSentryProjects(projects));
  } catch (error) {
    logger.error("Failed to fetch projects", error);
  } finally {
    yield* put(setSentryLoadingProjects(false));
  }
}

function* handleFetchIssues(
  action: ReturnType<typeof fetchSentryIssues>,
): SagaGenerator<void> {
  const isAuthenticated = yield* selectSentryIsAuthenticated.effect();
  if (!isAuthenticated) return;

  yield* put(setSentryLoadingIssues(true));
  try {
    const issues = yield* call(
      [sentryAuthClient, sentryAuthClient.fetchIssues],
      action.payload,
    );
    yield* put(setSentryIssues(issues));
  } catch (error) {
    logger.error("Failed to fetch issues", error);
  } finally {
    yield* put(setSentryLoadingIssues(false));
  }
}

function* handleSearchIssues(
  action: ReturnType<typeof searchSentryIssues>,
): SagaGenerator<void> {
  const isAuthenticated = yield* selectSentryIsAuthenticated.effect();
  if (!isAuthenticated) return;

  yield* put(setSentryLoadingIssues(true));
  try {
    const issues = yield* call(
      [sentryAuthClient, sentryAuthClient.searchIssues],
      action.payload.query,
      action.payload.project,
    );
    yield* put(setSentryIssues(issues));
  } catch (error) {
    logger.error("Failed to search issues", error);
  } finally {
    yield* put(setSentryLoadingIssues(false));
  }
}

// =============================================================================
// Root Saga
// =============================================================================

export function* sentryAuthSaga(): SagaGenerator<void> {
  yield* fork(function* watchInitialize() {
    yield* takeEvery(initializeSentryAuth, handleInitialize);
  });
  yield* fork(function* watchConnect() {
    yield* takeEvery(connectSentry, handleConnect);
  });
  yield* fork(function* watchLogout() {
    yield* takeEvery(logoutSentry, handleLogout);
  });
  yield* fork(function* watchFetchProjects() {
    yield* takeEvery(fetchSentryProjects, handleFetchProjects);
  });
  yield* fork(function* watchFetchIssues() {
    yield* takeEvery(fetchSentryIssues, handleFetchIssues);
  });
  yield* fork(function* watchSearchIssues() {
    yield* takeEvery(searchSentryIssues, handleSearchIssues);
  });
}

