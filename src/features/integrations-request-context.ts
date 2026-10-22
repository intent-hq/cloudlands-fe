import { onBackendReconnected } from '$lib/client/live/backend-transport';

let connection = 0;
let observing = false;

/** Capture an integration action's connection and explicit originating workspace. */
export function captureIntegrationContext(workspaceId?: string) {
  if (!observing) {
    onBackendReconnected(() => {
      connection += 1;
    });
    observing = true;
  }
  const originConnection = connection;
  return {
    workspaceId,
    key: JSON.stringify([originConnection, workspaceId ?? null]),
    isCurrent: () => originConnection === connection,
  };
}

/** Let all synchronous reconnect observers invalidate old state before starting fresh reads.
 * The connection observer stays lazy and may have been registered after a consumer.
 */
export function integrationReconnectSettled(): Promise<void> {
  return Promise.resolve();
}
