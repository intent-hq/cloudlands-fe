/**
 * Sentry auth store-service — the sanctioned post-saga connect-trigger mechanism.
 *
 * The `initializeSentryAuth` / `connectSentry` / `logoutSentry` triggers lost
 * their handler when the saga runtime was removed (they used to live in
 * `sagas/sentry-auth-saga.ts`), so the Connect/Disconnect buttons became no-ops.
 * This restores the side-effect path WITHOUT re-adding a saga and WITHOUT
 * changing any dispatch site: `createSentryAuthMiddleware()` observes every
 * dispatched action and routes the connect triggers to `sentryAuthClient`,
 * dispatching the same state-setting actions the saga used to.
 *
 * Dependency-light per src/store AGENTS.md: imports only the renderer auth client,
 * the configured store, the slice actions, and the logger (NOT selectors).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { sentryAuthClient } from "$features/sentry-auth/renderer/sentry-auth.client";
import { store as appStore } from "$store/renderer/store";
import {
  connectSentry,
  initializeSentryAuth,
  logoutSentry,
  setSentryAuthState,
  setSentryConnected,
  setSentryConnecting,
  setSentryError,
  setSentryLoadingProjects,
  setSentryLoggedOut,
  setSentryProjects,
} from "$store/renderer/slices/sentry-auth/sentry-auth-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("SentryAuthService");

/** Fetch auth state from the seam and hydrate the store. */
export async function initializeSentryAuthFlow(): Promise<void> {
  try {
    const authState = await sentryAuthClient.getAuthState();
    appStore.dispatch(
      setSentryAuthState(authState.isAuthenticated, authState.organization ?? null, authState.error ?? null),
    );
  } catch (error) {
    logger.error("Failed to initialize", error);
  }
}

/** Fetch projects for the configured organization (best-effort, post-connect). */
async function fetchSentryProjectsFlow(): Promise<void> {
  appStore.dispatch(setSentryLoadingProjects(true));
  try {
    const projects = await sentryAuthClient.fetchProjects();
    appStore.dispatch(setSentryProjects(projects));
  } catch (error) {
    logger.error("Failed to fetch projects", error);
  } finally {
    appStore.dispatch(setSentryLoadingProjects(false));
  }
}

/** Save org + token config and, on success, hydrate the connected state. */
export async function connectSentryFlow(organization: string, apiToken: string): Promise<void> {
  appStore.dispatch(setSentryError(null));
  appStore.dispatch(setSentryConnecting(true));
  try {
    const result = await sentryAuthClient.saveConfig(organization, apiToken);
    if (!result.success) {
      appStore.dispatch(setSentryError(result.error ?? "Failed to connect to Sentry"));
      appStore.dispatch(setSentryConnecting(false));
      return;
    }
    appStore.dispatch(setSentryConnected(organization));
    await fetchSentryProjectsFlow();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect to Sentry";
    appStore.dispatch(setSentryError(message));
    appStore.dispatch(setSentryConnecting(false));
  }
}

/** Log out / clear the Sentry config. */
export async function logoutSentryFlow(): Promise<void> {
  try {
    await sentryAuthClient.logout();
    appStore.dispatch(setSentryLoggedOut());
  } catch (error) {
    logger.error("Failed to logout", error);
  }
}

/**
 * Middleware that gives the Sentry connect triggers a real handler.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createSentryAuthMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    switch (action?.type) {
      case initializeSentryAuth.type:
        void initializeSentryAuthFlow();
        break;
      case connectSentry.type: {
        const payload = action.payload;
        if (Array.isArray(payload)) {
          const [organization, apiToken] = payload as [string, string];
          if (typeof organization === "string" && typeof apiToken === "string") {
            void connectSentryFlow(organization, apiToken);
          }
        }
        break;
      }
      case logoutSentry.type:
        void logoutSentryFlow();
        break;
    }
    return result;
  };
}
