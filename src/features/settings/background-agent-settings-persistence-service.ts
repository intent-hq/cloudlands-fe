/**
 * Background-agent-settings persistence service — the write half of the
 * backgroundAgents.defaultModel / backgroundAgents.typeOverrides path (the read
 * half is `settings-hydration-service`, which routes the daemon's
 * `backgroundAgents.*` keys into the backgroundAgentSettings slice on boot and
 * on `settings:changed`).
 *
 * Persists user selections from `BackgroundAgentSettings.svelte` (default model
 * + per-type overrides) to the daemon settings catalog (PROTOCOL §5.12) so the
 * values survive restart. Writes are fire-and-forget; the daemon echoes them
 * back via `settings:changed`, which hydration applies through the
 * `hydrateSettings` action — deliberately NOT observed here, so there is no
 * write loop.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the AppClient
 * seam, the configured store, backgroundAgentSettings-slice actions, and the
 * logger (no selectors — state is read directly off `appStore.state`).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  setDefaultModel,
  setTypeOverride,
  clearTypeOverride,
  resetSettings,
  hydrateSettings,
} from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";

const logger = createLogger("BackgroundAgentSettingsPersistenceService");

/**
 * Persist both backgroundAgents paths atomically in one settings.update call
 * (fire-and-forget; failures only log). Atomic updates avoid partial
 * settings:changed deltas and reduce redundant IPC traffic.
 */
function persistBackgroundAgentSettings(
  defaultModel: string,
  typeOverrides: Record<BackgroundAgentType, string>,
): void {
  void appClient.settings
    .update([
      { path: "backgroundAgents.defaultModel", value: defaultModel },
      { path: "backgroundAgents.typeOverrides", value: typeOverrides },
    ])
    .catch((error) => logger.error("Failed to persist background agent settings", error));
}

export function createBackgroundAgentSettingsPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      switch (action.type) {
        case setDefaultModel.type:
        case setTypeOverride.type:
        case clearTypeOverride.type:
        case resetSettings.type: {
          // After the reducer runs, persist the authoritative slice state to
          // the daemon settings catalog in one atomic update. Deliberately skip
          // hydrateSettings (the daemon's echo-back) to avoid a write loop.
          const state = appStore.state.backgroundAgentSettings;
          persistBackgroundAgentSettings(state.defaultModel, state.typeOverrides);
          break;
        }
        case hydrateSettings.type:
          // Skip hydration actions (the daemon's echo-back) to avoid a write loop
          break;
      }
    }
    return result;
  };
}
