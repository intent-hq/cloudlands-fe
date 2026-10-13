import { detectPlatform } from '$lib/utils/platform-capabilities';
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/** Generated renderer invokes pass through this router even in packaged Electron.
 * Forward each operation unchanged to main; never emulate a successful clipboard
 * write or route back into the browser mock. Main owns tokens and physical debt.
 */
export function registerSourceClipboardBridge(): void {
  for (const channel of [
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_BEGIN,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_WRITE,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_COMMIT,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_ABORT,
  ]) {
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const win = typeof window !== 'undefined' ? window : undefined;
      const bridge = win?.electronAPI;
      if (!win || detectPlatform(win) !== 'electron' || typeof bridge?.invoke !== 'function')
        throw new Error('SOURCE_CLIPBOARD_UNSUPPORTED');
      return bridge.invoke(channel, payload);
    });
  }
}

registerSourceClipboardBridge();
