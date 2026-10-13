import { createEventRecoverySession } from '../../../shared/event-recovery/session';
import { EventRecoveryCoordinator } from '../../events/event-recovery-coordinator';
import type { JsonRpcClient } from './json-rpc-client';

/** Main-only capture. No IPC forwarding, backend fallback, reconnect, or identity renewal. */
export function captureMainEventRecovery(client: JsonRpcClient, retired: () => void) {
  const connection = client.getRepositoryConnection?.();
  if (!connection) return undefined;
  const leases = new Set<string>();
  let disposed = false;
  const release = (subscriptionId: string) => {
    leases.delete(subscriptionId);
    // Socket/identity teardown already releases daemon leases. Do not create
    // new work after the client has sealed admission during shutdown.
    if (client.getRepositoryConnection() !== connection) return;
    void client
      .requestOnCapturedConnection(connection, 'events.unsubscribe', { subscriptionId })
      .catch(() => {});
  };
  const session = createEventRecoverySession({
    supported: connection.eventStreamRecovery === true,
    isCurrent: () => client.getRepositoryConnection() === connection,
    onRetired: (handler) =>
      client.onRepositoryConnectionEvent(() => {
        if (client.getRepositoryConnection() !== connection) handler();
      }),
    onNotification: (handler) =>
      client.onRepositoryConnectionEvent((event) => {
        if (
          event.type === 'notification' &&
          event.incarnation === connection.incarnation &&
          (event.notification.method === 'events.event' ||
            event.notification.method === 'events.lost')
        )
          handler(event.notification);
      }),
    request: (method, params, observe) =>
      client.requestOnCapturedConnection(connection, method, params, {
        observe: (result) => {
          if (method === 'events.subscribe') {
            const id = (result as { subscriptionId?: unknown } | null)?.subscriptionId;
            if (typeof id === 'string') {
              if (disposed) release(id);
              else leases.add(id);
            }
          } else if (method === 'events.unsubscribe') {
            leases.delete((params as { subscriptionId: string }).subscriptionId);
          }
          observe?.(result);
        },
      }),
    dispose: () => {
      disposed = true;
      for (const id of [...leases]) release(id);
    },
  });
  const coordinator = new EventRecoveryCoordinator(session);
  session.onRetired(retired);
  return { session, coordinator };
}
