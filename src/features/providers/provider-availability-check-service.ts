/**
 * Provider-availability check service — re-homes the deleted saga behind the
 * agent-availability trigger actions so onboarding provider cards reach a
 * TERMINAL state instead of spinning on "Checking…" forever.
 *
 * AgentGrid dispatches `ensureProvidersChecked` on mount (and
 * `checkAllProvidersRequested` on window focus/visibility), but after the
 * saga runtime was removed nothing consumed those triggers: no
 * `checkSingleProviderSuccess` was ever dispatched and `hasCheckedOnce` never
 * flipped, so every card's `statusLoading` stayed true and onboarding step 1
 * could not be completed.
 *
 * The middleware fans out one `providers:check-single` IPC per provider in
 * parallel (each probe → provider-status-bridge-seeder → daemon `host.*`
 * calls, PROTOCOL §5.14) so every card flips as ITS probe settles rather
 * than all cards updating together when the slowest probe finishes. Once
 * every per-provider probe settles the middleware ALWAYS dispatches
 * `checkAllProvidersComplete`, so the UI lands on installed / not-installed
 * / error and never hangs.
 *
 * The aggregated `getProviderAvailability()` client stays available for
 * non-onboarding callers (ProviderSelector, InitialAgentPicker,
 * resolve-onboarding-model, AuggieSetupGate). After each bulk fan-out we
 * invalidate its 30s cache so a subsequent aggregated caller sees the fresh
 * per-provider results instead of a pre-refresh snapshot.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports the availability
 * client (cache-invalidation only), the configured store, slice actions, and
 * the logger (no selectors).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { onBackendReconnected } from "$lib/client/live/backend-transport";
import { PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from "$shared/config/provider-config";
import { clearProviderAvailabilityCache } from "$features/providers/provider-availability.client";
import { store as appStore } from "$store/renderer/store";
import {
  checkAllProvidersComplete,
  checkAllProvidersRequested,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  ensureProvidersChecked,
  setAllProvidersLoading,
} from "$store/renderer/slices/agent-availability/agent-availability-slice";
import type { ProviderStatus } from "$store/renderer/slices/agent-availability/agent-availability-types";

const logger = createLogger("ProviderAvailabilityCheckService");

export function createProviderAvailabilityCheckMiddleware(): StoreMiddleware {
  /** Coalesce overlapping bulk checks (focus + visibility can fire together). */
  let inFlight: Promise<void> | null = null;

  const runSingleCheck = async (providerId: string): Promise<void> => {
    try {
      const result = await invoke<{
        success: boolean;
        providerId: string;
        data?: ProviderStatus;
        error?: string;
      }>(PROVIDERS_CHANNELS.CHECK_SINGLE, providerId);
      if (result?.success && result.data) {
        appStore.dispatch(checkSingleProviderSuccess(providerId, result.data));
      } else {
        appStore.dispatch(checkSingleProviderFailure(providerId));
      }
    } catch (error) {
      logger.error(`Provider availability check failed for ${providerId}`, { error });
      appStore.dispatch(checkSingleProviderFailure(providerId));
    }
  };

  const runBulkCheck = (): Promise<void> => {
    if (inFlight) return inFlight;

    const providerIds = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);
    const loadingMap: Record<string, boolean> = {};
    for (const providerId of providerIds) {
      loadingMap[providerId] = true;
    }
    appStore.dispatch(setAllProvidersLoading(loadingMap));

    inFlight = (async () => {
      try {
        // Fan out one probe per provider in parallel and let each dispatch
        // its own success/failure as soon as it settles — fast probes must
        // not wait on slow ones. `allSettled` prevents a single rejection
        // from short-circuiting the group; runSingleCheck already handles
        // its own thrown errors and dispatches `checkSingleProviderFailure`.
        await Promise.allSettled(providerIds.map((id) => runSingleCheck(id)));
      } finally {
        // The onboarding path just probed every provider fresh; drop the
        // aggregated client cache so the next non-onboarding caller
        // (settings, resolve-onboarding-model, …) picks up the same fresh
        // state instead of returning a pre-refresh snapshot.
        clearProviderAvailabilityCache();
        appStore.dispatch(checkAllProvidersComplete());
        inFlight = null;
      }
    })();
    return inFlight;
  };

  // On backend reconnect (including first connect after startup race), re-run
  // the bulk availability check even if hasCheckedOnce is true. The daemon may
  // have restarted or the sidecar socket may have just come up; re-probing
  // lets provider cards flip from unavailable → available without a reload.
  // RESUB-1: backend.ipc emits `{ status: 'connected', reconnected: true }`
  // after every successful reconnect following an earlier drop.
  // Cleanup handler is held by the transport layer; middleware doesn't expose dispose.
  void onBackendReconnected(() => {
    logger.info("Backend reconnected — re-running provider availability bulk check");
    void runBulkCheck();
  });

  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      switch (action.type) {
        case ensureProvidersChecked.type:
          // First-mount trigger: only fetch when nothing has been checked yet.
          if (!appStore.state.agentAvailability.hasCheckedOnce) {
            void runBulkCheck();
          }
          break;
        case checkAllProvidersRequested.type:
          // Focus/visibility recheck: per-provider CHECK_SINGLE bypasses the
          // aggregated 30s client cache by construction, so a manual
          // install/login in the user's terminal is picked up immediately.
          void runBulkCheck();
          break;
        case checkSingleProviderRequested.type: {
          const payload = Array.isArray(action.payload) ? action.payload : [];
          const providerId = payload[0];
          if (typeof providerId === "string" && providerId.length > 0) {
            void runSingleCheck(providerId);
          }
          break;
        }
      }
    }
    return result;
  };
}
