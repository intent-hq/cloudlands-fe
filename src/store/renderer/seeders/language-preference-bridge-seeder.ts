/**
 * Language-preference invoke bridge — forwards `app:set-language-preference`
 * to the real Electron preload bridge (`window.electronAPI.invoke`) when
 * present, so the main process can localize the application menu, native
 * dialogs, and desktop notifications with the renderer's language preference
 * (handler in features/system/main/system.ipc.ts → src/main/main-locale.ts).
 *
 * Same pattern as window-state-bridge-seeder: forward verbatim when the
 * preload bridge exists; resolve undefined when it does not (browser dev /
 * bridge-less build) — the caller (user-preferences persistence middleware)
 * is fire-and-forget with `.catch()`, and on web there is no native UI to
 * localize.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";

/** Register the language-preference invoke bridge handler. Idempotent. */
export function registerLanguagePreferenceBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.APP.SET_LANGUAGE_PREFERENCE, async (payload?: unknown) => {
    const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === "function") {
      return bridge.invoke(IPC_CHANNELS.APP.SET_LANGUAGE_PREFERENCE, payload);
    }
    return undefined;
  });
}

registerLanguagePreferenceBridge();
