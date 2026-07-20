/**
 * Linear auth store-service — daemon-backed connect/disconnect (PROTOCOL §5.28).
 *
 * §5.28 has **no** `linear.connect` / `linear.revoke` wire method by design:
 * auth is a personal API key the daemon resolves from its file-backed secrets
 * store (`intent_core::FileSecretStore`, `~/intent/secrets.json`, account
 * `linear.token`) or `LINEAR_API_KEY`. Connect is therefore a paste-API-key
 * flow: the key is stored through the daemon settings seam under the
 * `linear.token` path (secret settings persist to the secrets file, §5.12) and
 * the connection is re-probed via `linear.authStatus` (bridged by
 * `linearAuthClient.getAuthState`). Disconnect resets `linear.token` (deletes
 * the secrets-file entry) and re-probes — the env key may still authenticate,
 * so the probe result, not an assumption, drives the UI.
 *
 * KNOWN BE GAP (recorded): the daemon settings catalog does not define the
 * `linear.token` path yet, so a live-daemon connect surfaces the daemon's
 * "unknown setting" error in the UI. The secrets-store account name already
 * matches `intent-linear`'s resolver; only the catalog entry is missing.
 *
 * The legacy OAuth flow (start/cancel/poll + oauthUrl) is gone with its
 * unbridged `linear-auth:start-auth`/`cancel-auth`/`logout` channels.
 *
 * Dependency-light per src/store AGENTS.md: imports only the renderer auth
 * client, the AppClient seam, the configured store, the slice actions, and the
 * logger (NOT selectors).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { linearAuthClient } from "$features/linear-auth/renderer/linear-auth.client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  connectLinear,
  initializeLinearAuth,
  logoutLinear,
  refreshLinearAuth,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  startLinearAuth,
} from "$store/renderer/slices/linear-auth/linear-auth-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("LinearAuthService");

/** Daemon settings path whose secret value backs the Linear secrets-file entry (§5.28). */
export const LINEAR_TOKEN_SETTING_PATH = "linear.token";

/** Fetch auth state from the seam (force-refresh) and hydrate the store. */
export async function initializeLinearAuthFlow(): Promise<void> {
  try {
    const authState = await linearAuthClient.getAuthState(true);
    appStore.dispatch(
      setLinearAuthState(authState.isAuthenticated, authState.requiresAugmentAuth, null),
    );
  } catch (error) {
    logger.error("initialize error", error);
  }
}

/**
 * Connect with a pasted personal API key: store it via the daemon secrets-file
 * path, then re-probe `linear.authStatus`. Errors (including the daemon
 * rejecting the settings path — see the BE gap above) surface via
 * `setLinearError`.
 */
export async function connectLinearFlow(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) {
    appStore.dispatch(setLinearError("Enter a Linear API key"));
    return;
  }
  appStore.dispatch(setLinearError(null));
  appStore.dispatch(setLinearIsAuthenticating(true));
  try {
    await appClient.settings.update([{ path: LINEAR_TOKEN_SETTING_PATH, value: key }]);
    const authState = await linearAuthClient.getAuthState(true);
    if (authState.isAuthenticated) {
      appStore.dispatch(setLinearAuthState(true, false, null));
    } else {
      appStore.dispatch(setLinearAuthState(false, false, null));
      appStore.dispatch(
        setLinearError("Linear rejected the API key — check the key and try again."),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store the API key";
    appStore.dispatch(setLinearError(message));
    logger.error("connect error", error);
  } finally {
    appStore.dispatch(setLinearIsAuthenticating(false));
  }
}

/**
 * Disconnect: clear the secrets-file entry (settings.reset deletes the secret),
 * then re-probe — `LINEAR_API_KEY` in the daemon's environment may still
 * authenticate, and the UI must reflect that truthfully.
 */
export async function logoutLinearFlow(): Promise<void> {
  try {
    await appClient.settings.reset(LINEAR_TOKEN_SETTING_PATH);
  } catch (error) {
    // Mirror connectLinearFlow: surface the daemon message via setLinearError
    // and bail before the re-probe (which would otherwise clobber the error
    // with `null` and mask the still-present key).
    const message = error instanceof Error ? error.message : "Failed to clear the API key";
    appStore.dispatch(setLinearError(message));
    logger.error("logout error", error);
    return;
  }
  try {
    const authState = await linearAuthClient.getAuthState(true);
    appStore.dispatch(
      setLinearAuthState(authState.isAuthenticated, authState.requiresAugmentAuth, null),
    );
    if (authState.isAuthenticated) {
      appStore.dispatch(
        setLinearError(
          "Key cleared, but the daemon still authenticates via its LINEAR_API_KEY environment variable.",
        ),
      );
    }
  } catch {
    appStore.dispatch(setLinearAuthState(false, false, null));
  }
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
      // Legacy one-click "Connect": no OAuth exists (§5.28) — just re-probe.
      case startLinearAuth.type:
        void initializeLinearAuthFlow();
        break;
      case connectLinear.type: {
        const payload = Array.isArray(action.payload) ? action.payload : [];
        if (typeof payload[0] === "string") void connectLinearFlow(payload[0]);
        break;
      }
      case logoutLinear.type:
        void logoutLinearFlow();
        break;
    }
    return result;
  };
}
