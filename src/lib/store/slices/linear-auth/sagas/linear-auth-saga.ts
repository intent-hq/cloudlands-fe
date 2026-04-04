import { linearAuthClient } from "$features/linear-auth/renderer/linear-auth.client";
import { call, delay, fork, put, race, take, takeEvery } from "typed-redux-saga";
import {
  cancelLinearAuth,
  fetchLinearIssues,
  initializeLinearAuth,
  logoutLinear,
  refreshLinearAuth,
  searchLinearIssues,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  setLinearIsLoadingIssues,
  setLinearIssues,
  setLinearOauthUrl,
  startLinearAuth,
} from "../linear-auth-slice";
import { selectLinearIsAuthenticated } from "../linear-auth-selectors";

const POLL_INTERVAL = 3000; // 3 seconds
const POLL_TIMEOUT = 300000; // 5 minutes max wait

// --- Handlers ---

function* handleInitialize() {
  const authState = yield* call([linearAuthClient, linearAuthClient.getAuthState], true);
  yield* put(
    setLinearAuthState(
      authState.isAuthenticated,
      authState.requiresAugmentAuth,
      authState.oauthUrl ?? null,
    ),
  );
}

function* pollForAuthCompletion() {
  const startTime = Date.now();

  while (true) {
    yield* delay(POLL_INTERVAL);

    // Check for timeout
    if (Date.now() - startTime > POLL_TIMEOUT) {
      yield* put(setLinearError("Authentication timed out. Please try again."));
      yield* put(setLinearIsAuthenticating(false));
      return;
    }

    // Check if auth completed - force refresh to bypass cache
    const authState = yield* call([linearAuthClient, linearAuthClient.getAuthState], true);

    if (authState.isAuthenticated) {
      yield* put(
        setLinearAuthState(true, authState.requiresAugmentAuth, null),
      );
      yield* put(setLinearIsAuthenticating(false));
      return;
    }
  }
}

function* handleStartAuth() {
  yield* put(setLinearError(null));
  yield* put(setLinearIsAuthenticating(true));

  try {
    const result = yield* call([linearAuthClient, linearAuthClient.startAuth]);

    if (!result.success) {
      yield* put(setLinearError(result.error ?? "Failed to start authentication"));
      yield* put(setLinearIsAuthenticating(false));
      return;
    }

    if (result.alreadyAuthenticated) {
      yield* put(
        setLinearAuthState(true, false, null),
      );
      yield* put(setLinearIsAuthenticating(false));
      return;
    }

    // Store the OAuth URL for display
    yield* put(setLinearOauthUrl(result.oauthUrl ?? null));

    // Poll for completion, cancel if cancelLinearAuth is dispatched
    yield* race({
      poll: call(pollForAuthCompletion),
      cancel: take(cancelLinearAuth),
      logout: take(logoutLinear),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start authentication";
    yield* put(setLinearError(message));
    yield* put(setLinearIsAuthenticating(false));
  }
}

function* handleCancelAuth() {
  yield* call([linearAuthClient, linearAuthClient.cancelAuth]);
  yield* put(setLinearIsAuthenticating(false));
  yield* put(setLinearOauthUrl(null));
}

function* handleLogout() {
  yield* call([linearAuthClient, linearAuthClient.logout]);
  yield* put(
    setLinearAuthState(false, false, null),
  );
}



function* handleFetchIssues(action: ReturnType<typeof fetchLinearIssues>) {
  const isAuthenticated = yield* selectLinearIsAuthenticated.effect();
  if (!isAuthenticated) {
    return;
  }

  yield* put(setLinearIsLoadingIssues(true));
  try {
    const filter = action.payload[0];
    const issues = yield* call([linearAuthClient, linearAuthClient.fetchMyIssues], filter);
    yield* put(setLinearIssues(issues));
  } catch (error) {
    console.error("[LinearAuth] Failed to fetch issues:", error);
  } finally {
    yield* put(setLinearIsLoadingIssues(false));
  }
}

function* handleSearchIssues(action: ReturnType<typeof searchLinearIssues>) {
  const isAuthenticated = yield* selectLinearIsAuthenticated.effect();
  if (!isAuthenticated) {
    return;
  }

  yield* put(setLinearIsLoadingIssues(true));
  try {
    const query = action.payload[0];
    const issues = yield* call([linearAuthClient, linearAuthClient.searchIssues], query);
    yield* put(setLinearIssues(issues));
  } catch (error) {
    console.error("[LinearAuth] Failed to search issues:", error);
  } finally {
    yield* put(setLinearIsLoadingIssues(false));
  }
}

// --- Root Saga ---

export function* linearAuthSaga() {
  yield* fork(function* () {
    yield* takeEvery(initializeLinearAuth, handleInitialize);
  });
  yield* fork(function* () {
    yield* takeEvery(refreshLinearAuth, handleInitialize);
  });
  yield* fork(function* () {
    yield* takeEvery(startLinearAuth, handleStartAuth);
  });
  yield* fork(function* () {
    yield* takeEvery(cancelLinearAuth, handleCancelAuth);
  });
  yield* fork(function* () {
    yield* takeEvery(logoutLinear, handleLogout);
  });
  yield* fork(function* () {
    yield* takeEvery(fetchLinearIssues, handleFetchIssues);
  });
  yield* fork(function* () {
    yield* takeEvery(searchLinearIssues, handleSearchIssues);
  });
}