/**
 * Native message-dialog invoke bridge — forwards `dialog:message` to the real
 * Electron preload bridge (`window.electronAPI.invoke`) on the electron
 * platform only.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. `dialog:message`
 * used to be an UNBRIDGED_INVOKE_ALLOWLIST fold to button index 0, so the
 * FilesPanel drop-conflict prompt silently resolved to its first button
 * ('skip') with no user choice — even in packaged Electron where the
 * main-process dialog handler exists.
 *
 * Same pattern as window-state-bridge-seeder, with one difference: this
 * channel's result IS the user's answer, so absence must not fold to a
 * default. On web (browser mock sentinel or no bridge) the handler REJECTS —
 * callers must present the in-app MessageDialog via the
 * file-conflict-prompt seam instead of invoking this channel.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { detectPlatform } from '$lib/utils/platform-capabilities';

/** Register the native message-dialog invoke bridge handler. Idempotent. */
export function registerNativeDialogBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.DIALOG.MESSAGE, async (payload?: unknown) => {
    const win = typeof window !== 'undefined' ? window : undefined;
    const bridge = win?.electronAPI;
    if (
      win &&
      detectPlatform(win) === 'electron' &&
      bridge &&
      typeof bridge.invoke === 'function'
    ) {
      return bridge.invoke(IPC_CHANNELS.DIALOG.MESSAGE, payload);
    }
    throw new Error(
      `'${IPC_CHANNELS.DIALOG.MESSAGE}' requires the native Electron bridge. On web, ` +
        `present the in-app MessageDialog (see file-conflict-prompt.ts) instead of invoking it.`,
    );
  });
}

registerNativeDialogBridge();
