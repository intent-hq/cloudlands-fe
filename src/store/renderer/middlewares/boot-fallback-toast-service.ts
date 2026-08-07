/**
 * Boot-fallback toast service (T19) — surfaces the one-shot backend-restore
 * fallback notice as a non-blocking toast.
 *
 * When the app relaunches with a persisted remote backend that turns out to be
 * unreachable at boot, the main process falls back to the always-running local
 * sidecar and latches a notice. The fallback happens during boot reconciliation
 * — before any renderer window exists — so it cannot be pushed live. This
 * service PULLS it once on creation via the `connections:get-boot-fallback`
 * invoke channel (consume-once in main) and shows a toast.
 *
 * Advisory only: the connection is already live on local, and the notice is
 * never stored as connections-slice state (that slice is owned elsewhere).
 *
 * Follows the agent-events-ipc-service idiom: run once on creation, swallow
 * failures (the toast is informational, not critical), and import the toast lib
 * lazily. Dependency-light per src/store/renderer/AGENTS.md — no selector/store
 * imports.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { isElectron } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ConnectionBootFallbackEvent } from '$shared/types/connections';

async function surfaceBootFallbackNotice(): Promise<void> {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.invoke) return;
    const result = (await api.invoke(IPC_CHANNELS.CONNECTIONS.GET_BOOT_FALLBACK)) as
      | { bootFallback?: ConnectionBootFallbackEvent | null }
      | undefined;
    const fallback = result?.bootFallback;
    if (!fallback) return;
    const [{ toast }, { m }] = await Promise.all([
      import('svelte-sonner'),
      import('$shared/paraglide/messages.js'),
    ]);
    toast(m.layout_daemonStatus_bootFallback_notice({ label: fallback.label }));
  } catch {
    // Advisory-only: a failed fetch/toast just means no notice this launch.
  }
}

export function createBootFallbackToastMiddleware(): StoreMiddleware {
  return () => {
    if (isElectron()) {
      void surfaceBootFallbackNotice();
    }
    return (next) => (action) => next(action);
  };
}
