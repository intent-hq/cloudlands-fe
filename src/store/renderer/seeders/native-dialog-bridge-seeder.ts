/**
 * Native dialog invoke bridge — forwards `dialog:message` and `dialog:open`
 * to the real Electron preload bridge (`window.electronAPI.invoke`) on the
 * electron platform only.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. `dialog:message`
 * used to be an UNBRIDGED_INVOKE_ALLOWLIST fold to button index 0, so the
 * FilesPanel drop-conflict prompt silently resolved to its first button
 * ('skip') with no user choice — even in packaged Electron where the
 * main-process dialog handler exists.
 *
 * Same pattern as window-state-bridge-seeder, with one difference: these
 * channels return the user's answer, so absence must not fold to a default.
 * On web (browser mock sentinel or no bridge) the handlers reject; callers
 * must gate native dialogs and use their in-app fallback instead.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { detectPlatform } from '$lib/utils/platform-capabilities';

function registerNativeDialogChannel(channel: string): void {
  registerMockIpcHandler(channel, async (payload?: unknown) => {
    const win = typeof window !== 'undefined' ? window : undefined;
    const bridge = win?.electronAPI;
    if (
      win &&
      detectPlatform(win) === 'electron' &&
      bridge &&
      typeof bridge.invoke === 'function'
    ) {
      return bridge.invoke(channel, payload);
    }
    if (channel === IPC_CHANNELS.DIALOG.MESSAGE) {
      throw new Error(
        `'${channel}' requires the native Electron bridge. On web, ` +
          `present the in-app MessageDialog (see file-conflict-prompt.ts) instead of invoking it.`,
      );
    }
    throw new Error(`'${channel}' requires the native Electron bridge.`);
  });
}

/** Register the native dialog invoke bridge handlers. Idempotent. */
export function registerNativeDialogBridge(): void {
  registerNativeDialogChannel(IPC_CHANNELS.DIALOG.MESSAGE);
  registerNativeDialogChannel(IPC_CHANNELS.DIALOG.OPEN);
}

registerNativeDialogBridge();
