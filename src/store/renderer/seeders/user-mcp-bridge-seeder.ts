/** Forward interactive MCP OAuth to the Electron main process when available. */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { USER_MCP_CHANNELS } from '$shared/ipc/channels';
import * as m from '$shared/paraglide/messages.js';
import { detectPlatform } from '$lib/utils/platform-capabilities';

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
    return { success: false, error: m.mcp_management_authFailed_error() };
  });
}

registerUserMcpBridge();
