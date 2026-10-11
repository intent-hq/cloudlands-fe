import { store } from '@/store';

/** Capture the canonical connection generation and explicit originating workspace. */
export function captureIntegrationContext(workspaceId?: string) {
  const originConnection = store.state.daemonHealth.connectionGeneration;
  return {
    workspaceId,
    key: JSON.stringify([originConnection, workspaceId ?? null]),
    isCurrent: () => originConnection === store.state.daemonHealth.connectionGeneration,
  };
}

/** Let synchronous reconnect observers retire old reads before a new request. */
export function integrationReconnectSettled(): Promise<void> {
  return Promise.resolve();
}
