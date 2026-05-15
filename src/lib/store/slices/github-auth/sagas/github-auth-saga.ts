import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import {
  call,
  delay,
  fork,
  put,
  race,
  take,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  authCancelled,
  authCompleted,
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  initializeGitHubAuth,
  logoutCompleted,
  logoutGitHub,
  refreshGitHubAuth,
  setAuthenticating,
  setGitHubAuthError,
  setGitHubAuthState,
  setOAuthInfo,
  startGitHubAuth,
} from "../github-auth-slice";

// Polling interval for checking auth completion (1 second)
const AUTH_POLL_INTERVAL = 1000;
// Maximum time to poll for auth completion (5 minutes)
const AUTH_POLL_TIMEOUT = 300000;

function* handleInitialize() {
  try {
    const authState = yield* call([githubAuthClient, githubAuthClient.getAuthState]);
    yield* put(
      setGitHubAuthState({
        isAuthenticated: authState.isAuthenticated,
        requiresAugmentAuth: authState.requiresAugmentAuth,
        user: authState.user,
        needsScopeUpdate: authState.needsScopeUpdate ?? false,
        oauthUrl: authState.oauthUrl ?? null,
      }),
    );
  } catch (error) {
    console.error("[GitHubAuth] initialize error", error);
  }
}

function* pollForAuthCompletion(): SagaGenerator<void> {
  const startTime = Date.now();

  // Immediate first check
  try {
    const checkResult = yield* call([githubAuthClient, githubAuthClient.checkAuthComplete]);
    if (checkResult.success && checkResult.data?.isComplete) {
      yield* put(authCompleted(checkResult.data.user ?? null));
      return;
    }
  } catch (error) {
    console.error("[GitHubAuth] Poll check failed", error);
  }

  // Continue polling
  while (true) {
    yield* delay(AUTH_POLL_INTERVAL);

    // Check for timeout
    if (Date.now() - startTime > AUTH_POLL_TIMEOUT) {
      yield* put(setGitHubAuthError("Authentication timed out. Please try again."));
      return;
    }

    try {
      const checkResult = yield* call([githubAuthClient, githubAuthClient.checkAuthComplete]);
      if (checkResult.success && checkResult.data?.isComplete) {
        yield* put(authCompleted(checkResult.data.user ?? null));
        return;
      }
    } catch (error) {
      console.error("[GitHubAuth] Poll check failed", error);
    }
  }
}

function* handleStartAuth() {
  yield* put(setAuthenticating(true));

  try {
    const result = yield* call([githubAuthClient, githubAuthClient.startAuth]);

    if (!result.success) {
      yield* put(setGitHubAuthError(result.error || "Failed to start authentication"));
      console.error("[GitHubAuth] startAuth failed", result.error);
      return;
    }

    // If already authenticated, just update state
    if (result.alreadyAuthenticated) {
      yield* put(authCompleted(null));
      return;
    }

    // Store OAuth URL for display
    yield* put(setOAuthInfo(result.oauthUrl ?? null, result.needsScopeUpdate ?? false));

    // Poll for auth completion, cancellable by cancelGitHubAuth or logoutGitHub
    yield* race({
      polling: call(pollForAuthCompletion),
      cancelled: take(cancelGitHubAuth),
      loggedOut: take(logoutGitHub),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("Unauthorized channel")) {
      yield* put(
        setGitHubAuthError(
          "GitHub auth IPC was blocked. Please restart the app so the preload allowlist is refreshed.",
        ),
      );
    } else {
      yield* put(setGitHubAuthError(message));
    }
    console.error("[GitHubAuth] startAuth error", error);
  }
}

function* handleCancelAuth() {
  try {
    yield* call([githubAuthClient, githubAuthClient.cancelAuth]);
  } catch (error) {
    console.error("[GitHubAuth] cancelAuth error", error);
  }
  yield* put(authCancelled());
}

function* handleLogout() {
  try {
    yield* call([githubAuthClient, githubAuthClient.logout]);
  } catch (error) {
    console.error("[GitHubAuth] logout error", error);
  }
  yield* put(logoutCompleted());
}

function* watchInitialize(): SagaGenerator<void> {
  while (true) {
    yield* take(initializeGitHubAuth);
    yield* call(handleInitialize);
  }
}

function* watchRefresh(): SagaGenerator<void> {
  while (true) {
    yield* take(refreshGitHubAuth);
    yield* call(handleInitialize);
  }
}

function* watchStartAuth(): SagaGenerator<void> {
  while (true) {
    yield* take(startGitHubAuth);
    yield* call(handleStartAuth);
  }
}

function* handleCheckAuthStatus() {
  try {
    const checkResult = yield* call([githubAuthClient, githubAuthClient.checkAuthComplete]);
    if (checkResult.success && checkResult.data?.isComplete) {
      yield* put(authCompleted(checkResult.data.user ?? null));
    }
  } catch (error) {
    console.error("[GitHubAuth] Check auth status failed", error);
  }
}

function* watchCheckAuthStatus(): SagaGenerator<void> {
  while (true) {
    yield* take(checkGitHubAuthStatus);
    yield* call(handleCheckAuthStatus);
  }
}

function* watchCancelAuth(): SagaGenerator<void> {
  while (true) {
    yield* take(cancelGitHubAuth);
    yield* call(handleCancelAuth);
  }
}

function* watchLogout(): SagaGenerator<void> {
  while (true) {
    yield* take(logoutGitHub);
    yield* call(handleLogout);
  }
}

export function* githubAuthSaga(): SagaGenerator<void> {
  yield* fork(watchInitialize);
  yield* fork(watchRefresh);
  yield* fork(watchStartAuth);
  yield* fork(watchCheckAuthStatus);
  yield* fork(watchCancelAuth);
  yield* fork(watchLogout);
}

