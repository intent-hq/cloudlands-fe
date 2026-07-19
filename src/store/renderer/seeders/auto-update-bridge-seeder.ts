/**
 * Auto-update invoke bridge — forwards the `auto-update:*` invoke channels to
 * the real Electron preload bridge (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` (src/shared/generated/ipc-client.ts) routes ALL
 * legacy renderer invokes through the mock router in every build, including
 * the packaged app. The auto-updater lives in the Electron main process
 * (ipcMain handlers in features/auto-update/main/auto-update.ipc.ts), so
 * without this bridge the renderer's getState / check / download / install /
 * set-channel invokes fell into UNBRIDGED_INVOKE_ALLOWLIST shaped failures
 * ("Auto-update is not available in this build") even though the real
 * handlers existed — the startup console-error pair from
 * AutoUpdateMutationService and UserPreferencesBetaPersistenceService, and
 * the dead Install / download flow.
 *
 * Same pattern as `external-editors:open-with-other` in host-bridge-seeder:
 * forward verbatim when the preload bridge exists, fold to the documented
 * shaped failure when it does not (browser dev / bridge-less build) so
 * callers degrade exactly as the former allowlist arms did.
 */
import { AUTO_UPDATE_CHANNELS } from "$features/auto-update/types";
import { registerMockIpcHandler } from "$shared/ipc-mock-router";

const AUTO_UPDATE_INVOKE_CHANNELS = [
  AUTO_UPDATE_CHANNELS.CHECK_MANUAL,
  AUTO_UPDATE_CHANNELS.DOWNLOAD,
  AUTO_UPDATE_CHANNELS.INSTALL,
  AUTO_UPDATE_CHANNELS.GET_STATE,
  AUTO_UPDATE_CHANNELS.SET_CHANNEL,
] as const;

const NOT_AVAILABLE = {
  success: false,
  error: { message: "Auto-update is not available in this build" },
} as const;

/** Register the auto-update invoke bridge handlers. Idempotent. */
export function registerAutoUpdateBridge(): void {
  for (const channel of AUTO_UPDATE_INVOKE_CHANNELS) {
    registerMockIpcHandler(channel, async (...args: unknown[]) => {
      const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === "function") {
        return bridge.invoke(channel, ...args);
      }
      return NOT_AVAILABLE;
    });
  }
}

registerAutoUpdateBridge();
