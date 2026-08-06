/**
 * Release-notes invoke bridge — forwards `release-notes:get` to the real
 * Electron preload bridge (`window.electronAPI.invoke`) when present.
 *
 * Same pattern as auto-update-bridge-seeder: the generated `invoke()` routes
 * ALL legacy renderer invokes through the mock router in every build, so
 * without this bridge the packaged app's invoke would reject even though the
 * ipcMain handler (features/release-notes/main/release-notes.ipc.ts) exists.
 * Bridge-less builds (browser dev) fold to the shaped not-available failure,
 * which the client reads as "no notes" and the modal renders as its fallback.
 */
import { RELEASE_NOTES_CHANNELS } from "$features/release-notes/types";
import { registerMockIpcHandler } from "$shared/ipc-mock-router";

const NOT_AVAILABLE = {
  success: false,
  error: { message: "Release notes are not available in this build" },
} as const;

/** Register the release-notes invoke bridge handler. Idempotent. */
export function registerReleaseNotesBridge(): void {
  registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, async (payload?: unknown) => {
    const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === "function") {
      return bridge.invoke(RELEASE_NOTES_CHANNELS.GET, payload);
    }
    return NOT_AVAILABLE;
  });
}

registerReleaseNotesBridge();
