/**
 * Renderer log persistence bridge — forwards log batches to Electron's
 * registered main-process handler when the preload bridge is present.
 * Bridge-less browser builds keep the fire-and-forget no-op behavior so the
 * renderer logger does not retry and grow its pending buffer indefinitely.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/** Register the renderer log persistence bridge handler. Idempotent. */
export function registerRendererLogBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.LOG.PERSIST_RENDERER_LOGS, async (batch?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') {
      return bridge.invoke(IPC_CHANNELS.LOG.PERSIST_RENDERER_LOGS, batch);
    }
    return undefined;
  });
}

registerRendererLogBridge();
