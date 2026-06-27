/**
 * Linear auth store-service — the sanctioned post-saga OAuth-trigger mechanism.
 *
 * The `initializeLinearAuth` / `refreshLinearAuth` / `startLinearAuth` /
 * `cancelLinearAuth` / `logoutLinear` triggers lost their handler when the saga
 * runtime was removed (they used to live in `sagas/linear-auth-saga.ts`), so the
 * Connect/Reconnect/Disconnect buttons became no-ops. This restores the
 * side-effect path WITHOUT re-adding a saga and WITHOUT changing any dispatch
 * site: `createLinearAuthMiddleware()` observes every dispatched action and
 * routes the auth triggers to `linearAuthClient`, dispatching the same
 * state-setting actions the saga used to. The component's legacy
 * `settings:get/update` issue-filter persistence is independent and untouched.
 *
 * Dependency-light per src/store AGENTS.md: imports only the renderer auth client,
 * the configured store, the slice actions, and the logger (NOT selectors).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { linearAuthClient } from "$features/linear-auth/renderer/linear-auth.client";
import { store as appStore } from "$store/renderer/store";
import {
  cancelLinearAuth,
  initializeLinearAuth,
  logoutLinear,
  refreshLinearAuth,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  setLinearOauthUrl,
  startLinearAuth,
} from "$store/renderer/slices/linear-auth/linear-auth-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("LinearAuthService");

/** Polling interval for checking auth completion (3 seconds). */
const POLL_INTERVAL = 3000;
/** Maximum time to poll for auth completion (5 minutes). */
const POLL_TIMEOUT = 300000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The currently-running OAuth poll, so cancel/logout can interrupt it. */
let activePoll: { cancelled: boolean } | null = null;

function cancelActivePoll(): void {
  if (activePoll) activePoll.cancelled = true;
  activePoll = null;
}

/** Fetch auth state from the seam (force-refresh) and hydrate the store. */
export async function initializeLinearAuthFlow(): Promise<void> {
  try {
    const authState = await linearAuthClient.getAuthState(true);
    appStore.dispatch(
      setLinearAuthState(authState.isAuthenticated, authState.requiresAugmentAuth, authState.oauthUrl ?? null),
    );
  } catch (error) {
    logger.error("initialize error", error);
  }
}

/** Poll for OAuth completion until done, cancelled, or timed out. */
export async function pollForLinearAuthCompletion(
  pollIntervalMs = POLL_INTERVAL,
  timeoutMs = POLL_TIMEOUT,
): Promise<void> {
  const token = { cancelled: false };
  cancelActivePoll();
  activePoll = token;
  const startTime = Date.now();

  while (!token.cancelled) {
    await delay(pollIntervalMs);
    if (token.cancelled) return;
    if (Date.now() - startTime > timeoutMs) {
      appStore.dispatch(setLinearError("Authentication timed out. Please try again."));
      appStore.dispatch(setLinearIsAuthenticating(false));
      break;
    }
    try {
      const authState = await linearAuthClient.getAuthState(true);
      if (authState.isAuthenticated) {
        appStore.dispatch(setLinearAuthState(true, authState.requiresAugmentAuth, null));
        appStore.dispatch(setLinearIsAuthenticating(false));
        break;
      }
    } catch (error) {
      logger.error("poll error", error);
    }
  }
  if (activePoll === token) activePoll = null;
}

/** Start the OAuth flow: open the URL, then poll for completion. */
export async function startLinearAuthFlow(): Promise<void> {
  appStore.dispatch(setLinearError(null));
  appStore.dispatch(setLinearIsAuthenticating(true));
  try {
    const result = await linearAuthClient.startAuth();
    if (!result.success) {
      appStore.dispatch(setLinearError(result.error ?? "Failed to start authentication"));
      appStore.dispatch(setLinearIsAuthenticating(false));
      return;
    }
    if (result.alreadyAuthenticated) {
      appStore.dispatch(setLinearAuthState(true, false, null));
      appStore.dispatch(setLinearIsAuthenticating(false));
      return;
    }
    appStore.dispatch(setLinearOauthUrl(result.oauthUrl ?? null));
    await pollForLinearAuthCompletion();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start authentication";
    appStore.dispatch(setLinearError(message));
    appStore.dispatch(setLinearIsAuthenticating(false));
  }
}

/** Cancel an in-progress auth flow. */
export async function cancelLinearAuthFlow(): Promise<void> {
  cancelActivePoll();
  try {
    await linearAuthClient.cancelAuth();
  } catch (error) {
    logger.error("cancel error", error);
  }
  appStore.dispatch(setLinearIsAuthenticating(false));
  appStore.dispatch(setLinearOauthUrl(null));
}

/** Log out / revoke Linear access. */
export async function logoutLinearFlow(): Promise<void> {
  cancelActivePoll();
  try {
    await linearAuthClient.logout();
  } catch (error) {
    logger.error("logout error", error);
  }
  appStore.dispatch(setLinearAuthState(false, false, null));
}

/**
 * Middleware that gives the Linear auth triggers a real handler.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createLinearAuthMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    switch (action?.type) {
      case initializeLinearAuth.type:
      case refreshLinearAuth.type:
        void initializeLinearAuthFlow();
        break;
      case startLinearAuth.type:
        void startLinearAuthFlow();
        break;
      case cancelLinearAuth.type:
        void cancelLinearAuthFlow();
        break;
      case logoutLinear.type:
        void logoutLinearFlow();
        break;
    }
    return result;
  };
}
