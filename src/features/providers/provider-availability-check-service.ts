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
 * The middleware routes the triggers through the existing
 * `getProviderAvailability()` client (`providers:get-availability` →
 * provider-status-bridge-seeder → daemon `host.*` probes, PROTOCOL §5.14) and
 * dispatches per-provider success/failure plus — ALWAYS, even on error —
 * `checkAllProvidersComplete`, so the UI lands on installed / not-installed /
 * error and never hangs.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports the availability
 * client, the configured store, slice actions, and the logger (no selectors).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from "$shared/config/provider-config";
import { getProviderAvailability } from "$features/providers/provider-availability.client";
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

  const runBulkCheck = (forceRefresh: boolean): Promise<void> => {
    if (inFlight) return inFlight;

    const loadingMap: Record<string, boolean> = {};
    for (const providerId of Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID)) {
      loadingMap[providerId] = true;
    }
    appStore.dispatch(setAllProvidersLoading(loadingMap));

    inFlight = (async () => {
      try {
        const result = await getProviderAvailability(forceRefresh);
        const providers = result.providers as Record<string, ProviderStatus | undefined>;
        for (const [key, providerId] of Object.entries(PROVIDER_AVAILABILITY_KEY_TO_ID)) {
          appStore.dispatch(
            checkSingleProviderSuccess(providerId, providers[key] ?? { available: false }),
          );
        }
      } catch (error) {
        // getProviderAvailability degrades internally, but stay terminal even
        // if it ever throws: every card lands on not-available, never spins.
        logger.error("Bulk provider availability check failed", { error });
        for (const providerId of Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID)) {
          appStore.dispatch(checkSingleProviderFailure(providerId));
        }
      } finally {
        appStore.dispatch(checkAllProvidersComplete());
        inFlight = null;
      }
    })();
    return inFlight;
  };

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

  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      switch (action.type) {
        case ensureProvidersChecked.type:
          // First-mount trigger: only fetch when nothing has been checked yet.
          if (!appStore.state.agentAvailability.hasCheckedOnce) {
            void runBulkCheck(false);
          }
          break;
        case checkAllProvidersRequested.type:
          // Focus/visibility recheck: bypass the 30s client cache so a manual
          // install/login in the user's terminal is picked up immediately.
          void runBulkCheck(true);
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
