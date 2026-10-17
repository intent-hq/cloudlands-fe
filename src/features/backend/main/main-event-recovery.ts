import { createEventRecoverySession } from '../../../shared/event-recovery/session';
import { EventRecoveryCoordinator } from '../../events/event-recovery-coordinator';
import {
  captureRecoveryRequests,
  onRecoveryRequestsReady,
  type JsonRpcClient,
} from './json-rpc-client';

/** Main-only capture. No IPC forwarding, backend fallback, reconnect, or identity renewal. */
export function captureMainEventRecovery(client: JsonRpcClient, retired: () => void) {
  const connection = client.getRepositoryConnection?.();
  if (!connection) return undefined;
  const requests = captureRecoveryRequests(client, connection);
  if (!requests) return undefined;
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
    request: (method, params, observe) => requests.request(method, params, observe),
    dispose: () => requests.dispose(),
  });
  const coordinator = new EventRecoveryCoordinator(session);
  session.onRetired(retired);
  return { session, coordinator };
}

/** Ready is distinct from immediate retirement and ordinary socket reconnect. */
export function onMainEventRecoveryReady(client: JsonRpcClient, handler: () => void): () => void {
  return onRecoveryRequestsReady(client, handler);
}
