/** Forward interactive MCP OAuth to the Electron main process when available. */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { USER_MCP_CHANNELS } from '$shared/ipc/channels';
import { detectPlatform } from '$lib/utils/platform-capabilities';

const OAUTH_UNAVAILABLE = {
  success: false,
  error: 'Interactive MCP authentication requires the desktop app',
} as const;

/** Register the interactive MCP OAuth invoke bridge. Idempotent. */
export function registerUserMcpBridge(): void {
  registerMockIpcHandler(USER_MCP_CHANNELS.AUTHENTICATE, async (payload?: unknown) => {
    const win = typeof window !== 'undefined' ? window : undefined;
    const bridge = win?.electronAPI;
    if (
      win &&
      detectPlatform(win) === 'electron' &&
      bridge &&
      typeof bridge.invoke === 'function'
    ) {
      return bridge.invoke(USER_MCP_CHANNELS.AUTHENTICATE, payload);
    }
    return OAUTH_UNAVAILABLE;
  });
}

registerUserMcpBridge();
