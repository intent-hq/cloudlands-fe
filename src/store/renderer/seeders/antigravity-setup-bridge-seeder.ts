import { ANTIGRAVITY_CHANNELS } from '$shared/ipc/channels';
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import type { AntigravitySetupResult } from '$shared/types/antigravity-setup';

/** Forward setup to Electron; the main process owns the private local connection. */
export function registerAntigravitySetupBridge(): void {
  registerMockIpcHandler(ANTIGRAVITY_CHANNELS.SETUP, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(ANTIGRAVITY_CHANNELS.SETUP, payload);
    }
    return { ok: false, code: 'unsupportedHost' } satisfies AntigravitySetupResult;
  });

  registerMockIpcHandler(ANTIGRAVITY_CHANNELS.CLOSE_SETUP, async () => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      await bridge.invoke(ANTIGRAVITY_CHANNELS.CLOSE_SETUP);
    }
  });
}

registerAntigravitySetupBridge();
