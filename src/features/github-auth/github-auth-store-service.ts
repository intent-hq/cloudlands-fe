/**
 * GitHub auth store-service — the sanctioned post-saga OAuth-trigger mechanism.
 *
 * The `initializeGitHubAuth` / `refreshGitHubAuth` / `startGitHubAuth` /
 * `checkGitHubAuthStatus` / `cancelGitHubAuth` / `logoutGitHub` triggers lost
 * their handler when the saga runtime was removed (they used to live in
 * `sagas/github-auth-saga.ts`), so the Connect/Reconnect/Disconnect buttons and
 * the on-focus status check became no-ops. This restores the side-effect path
 * WITHOUT re-adding a saga and WITHOUT changing any dispatch site:
 * `createGitHubAuthMiddleware()` observes every dispatched action and routes the
 * auth triggers to `githubAuthClient`, dispatching the same state-setting actions
 * the saga used to.
 *
 * Dependency-light per src/store AGENTS.md: imports only the renderer auth client,
 * the configured store, the slice actions, and the logger (NOT selectors —
 * importing them would evaluate `store.createSelector` while the store module is
 * still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { GitHubUser } from "$features/github-auth/types";
import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { store as appStore } from "$store/renderer/store";
import {
  authCancelled,
  authCompleted,
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  githubAuthChanged,
  initializeGitHubAuth,
  logoutCompleted,
  logoutGitHub,
  refreshGitHubAuth,
  setAuthenticating,
  setDeviceFlowInfo,
  setGitHubAuthError,
  setGitHubAuthState,
  setOAuthInfo,
  startGitHubAuth,
} from "$store/renderer/slices/github-auth/github-auth-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("GitHubAuthService");

/** Fallback polling interval for checking auth completion (5 seconds — the
 * device-flow default cadence; `github:auth-changed` events are the primary
 * completion signal, polling only covers a missed event). */
const AUTH_POLL_INTERVAL = 5000;
/** Maximum time to poll for auth completion (15 minutes — device codes are
 * valid for ~15 minutes per §5.27 `expiresIn`). */
const AUTH_POLL_TIMEOUT = 900000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The currently-running OAuth poll, so cancel/logout can interrupt it. */
let activePoll: { cancelled: boolean } | null = null;

function cancelActivePoll(): void {
  if (activePoll) activePoll.cancelled = true;
  activePoll = null;
}

/** Fetch auth state from the seam and hydrate the store. */
export async function initializeGitHubAuthFlow(): Promise<void> {
  try {
    const authState = await githubAuthClient.getAuthState();
    appStore.dispatch(
      setGitHubAuthState({
        isAuthenticated: authState.isAuthenticated,
        requiresDaemonAuth: authState.requiresDaemonAuth,
        user: authState.user,
        needsScopeUpdate: authState.needsScopeUpdate ?? false,
        oauthUrl: authState.oauthUrl ?? null,
      }),
    );
    // Resume a still-pending device flow after a client refresh (§5.27:
    // "the flow survives client refreshes") — restore the code card and
    // restart the fallback poll at the daemon-suggested interval, clamped
    // to no faster than AUTH_POLL_INTERVAL.
    const pending = authState.deviceFlow;
    if (!authState.isAuthenticated && pending?.status === "pending") {
      appStore.dispatch(setAuthenticating(true));
      appStore.dispatch(
        setDeviceFlowInfo({
          userCode: pending.userCode,
          verificationUri: pending.verificationUri,
          expiresIn: pending.expiresIn,
          interval: pending.interval,
        }),
      );
      const pollMs = Math.max(pending.interval * 1000, AUTH_POLL_INTERVAL);
      void pollForGitHubAuthCompletion(pollMs);
    } else if (appStore.state.githubAuth.deviceFlow !== null) {
      // No pending flow daemon-side: clear stale in-flight UI state so the
      // client does not stay stuck on a code card from a prior attempt.
      cancelActivePoll();
      appStore.dispatch(setDeviceFlowInfo(null));
      appStore.dispatch(setAuthenticating(false));
    }
  } catch (error) {
    logger.error("initialize error", error);
  }
}

/** One completion check; dispatches `authCompleted` and resolves true when done. */
async function checkAuthCompleteOnce(): Promise<boolean> {
  try {
    const checkResult = await githubAuthClient.checkAuthComplete();
    if (checkResult.success && checkResult.data?.isComplete) {
      appStore.dispatch(authCompleted(checkResult.data.user ?? null));
      return true;
    }
  } catch (error) {
    logger.error("poll check failed", error);
  }
  return false;
}

/** Poll for OAuth completion until done, cancelled, or timed out. */
export async function pollForGitHubAuthCompletion(
  pollIntervalMs = AUTH_POLL_INTERVAL,
  timeoutMs = AUTH_POLL_TIMEOUT,
): Promise<void> {
  const token = { cancelled: false };
  cancelActivePoll();
  activePoll = token;
  const startTime = Date.now();

  if (await checkAuthCompleteOnce()) {
    if (activePoll === token) activePoll = null;
    return;
  }
  while (!token.cancelled) {
    await delay(pollIntervalMs);
    if (token.cancelled) return;
    if (Date.now() - startTime > timeoutMs) {
      appStore.dispatch(setGitHubAuthError("Authentication timed out. Please try again."));
      break;
    }
    if (await checkAuthCompleteOnce()) break;
  }
  if (activePoll === token) activePoll = null;
}

/** Start the device flow: surface the user code, then poll as event fallback. */
export async function startGitHubAuthFlow(): Promise<void> {
  appStore.dispatch(setAuthenticating(true));
  try {
    const result = await githubAuthClient.startAuth();
    if (!result.success) {
      appStore.dispatch(setGitHubAuthError(result.error || "Failed to start authentication"));
      return;
    }
    if (result.alreadyAuthenticated) {
      // Carry the daemon-reported scope status so configured-but-needs-update
      // is not left stale until the next initialize/refresh.
      appStore.dispatch(setOAuthInfo(null, result.needsScopeUpdate ?? false));
      appStore.dispatch(authCompleted(null));
      return;
    }
    appStore.dispatch(setOAuthInfo(result.oauthUrl ?? null, result.needsScopeUpdate ?? false));
    if (result.userCode && result.verificationUri) {
      appStore.dispatch(
        setDeviceFlowInfo({
          userCode: result.userCode,
          verificationUri: result.verificationUri,
          expiresIn: result.expiresIn ?? 0,
          interval: result.interval ?? 5,
        }),
      );
    }
    // `github:auth-changed` is the primary completion signal; this poll is
    // the fallback for a missed event, at the daemon's suggested interval
    // clamped to no faster than AUTH_POLL_INTERVAL.
    const pollMs = Math.max((result.interval ?? 5) * 1000, AUTH_POLL_INTERVAL);
    await pollForGitHubAuthCompletion(pollMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    appStore.dispatch(
      setGitHubAuthError(
        message.includes("Unauthorized channel")
          ? "GitHub auth IPC was blocked. Please restart the app so the preload allowlist is refreshed."
          : message,
      ),
    );
    logger.error("startAuth error", error);
  }
}

/** One-shot status check (used on window focus during auth). */
export async function checkGitHubAuthStatusOnce(): Promise<void> {
  await checkAuthCompleteOnce();
}

/** Cancel an in-progress auth flow. */
export async function cancelGitHubAuthFlow(): Promise<void> {
  cancelActivePoll();
  try {
    await githubAuthClient.cancelAuth();
  } catch (error) {
    logger.error("cancelAuth error", error);
  }
  appStore.dispatch(authCancelled());
}

/** Log out and clear cached auth state. */
export async function logoutGitHubFlow(): Promise<void> {
  cancelActivePoll();
  try {
    await githubAuthClient.logout();
  } catch (error) {
    logger.error("logout error", error);
  }
  appStore.dispatch(logoutCompleted());
}

/**
 * Handle a `github:auth-changed` terminal transition pushed by the daemon
 * (PROTOCOL §6.5). `authorized` completes the flow (fetching the derived
 * identity); the failure statuses surface an error; `revoked` resets to
 * signed-out.
 */
export async function handleGitHubAuthChanged(
  status: "authorized" | "expired" | "denied" | "error" | "revoked",
): Promise<void> {
  switch (status) {
    case "authorized": {
      cancelActivePoll();
      // getUser() folds failures to null, but guard anyway so a rejection
      // cannot strand the flow with the poll already cancelled.
      let user: GitHubUser | null = null;
      try {
        user = await githubAuthClient.getUser();
      } catch (error) {
        logger.error("getUser after authorized failed", error);
      }
      appStore.dispatch(authCompleted(user));
      if (user === null) {
        // Re-hydrate through the boot path so the identity converges instead
        // of rendering a half-hydrated "connected" state.
        void initializeGitHubAuthFlow();
      }
      break;
    }
    case "expired":
      cancelActivePoll();
      appStore.dispatch(setGitHubAuthError("The device code expired. Please try again."));
      break;
    case "denied":
      cancelActivePoll();
      appStore.dispatch(setGitHubAuthError("Authorization was denied on GitHub."));
      break;
    case "error":
      cancelActivePoll();
      appStore.dispatch(setGitHubAuthError("GitHub authorization failed. Please try again."));
      break;
    case "revoked":
      cancelActivePoll();
      appStore.dispatch(logoutCompleted());
      break;
  }
}

/**
 * Middleware that gives the GitHub auth triggers a real handler. Fire-and-forget
 * — dispatch stays synchronous and never throws.
 */
export function createGitHubAuthMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    switch (action?.type) {
      case initializeGitHubAuth.type:
      case refreshGitHubAuth.type:
        void initializeGitHubAuthFlow();
        break;
      case startGitHubAuth.type:
        void startGitHubAuthFlow();
        break;
      case checkGitHubAuthStatus.type:
        void checkGitHubAuthStatusOnce();
        break;
      case cancelGitHubAuth.type:
        void cancelGitHubAuthFlow();
        break;
      case logoutGitHub.type:
        void logoutGitHubFlow();
        break;
      case githubAuthChanged.type: {
        const [status] = (action as { payload: [Parameters<typeof handleGitHubAuthChanged>[0]] })
          .payload;
        void handleGitHubAuthChanged(status);
        break;
      }
    }
    return result;
  };
}
