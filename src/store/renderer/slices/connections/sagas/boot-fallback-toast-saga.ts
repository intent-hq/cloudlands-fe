import { call, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ConnectionBootFallbackEvent } from '$shared/types/connections';

type BootFallbackResult = {
  bootFallback?: ConnectionBootFallbackEvent | null;
};

async function consumeBootFallbackNotice(): Promise<BootFallbackResult | undefined> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) return undefined;
  return (await api.invoke(IPC_CHANNELS.CONNECTIONS.GET_BOOT_FALLBACK)) as BootFallbackResult;
}

async function showBootFallbackNotice(fallback: ConnectionBootFallbackEvent): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  toast(m.layout_daemonStatus_bootFallback_notice({ label: fallback.label }));
}

export function* bootFallbackToastSaga(): SagaGenerator<void> {
  if (!isElectron()) return;

  try {
    const result = yield* call(consumeBootFallbackNotice);
    if (result?.bootFallback) {
      yield* call(showBootFallbackNotice, result.bootFallback);
    }
  } catch {
    // Advisory only: a failed fetch/toast just means no notice this launch.
  }
}
