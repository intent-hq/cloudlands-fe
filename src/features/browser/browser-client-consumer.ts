import { store as appStore } from '$store/renderer/store';
import {
  browserClientsConsumerMounted,
  browserClientsConsumerUnmounted,
} from '$store/renderer/slices/browser-clients/browser-clients-slice';

/** A DOM consumer owns a lease, including when it is a retained browser surface. */
export function browserClientConsumer(_node: HTMLElement, workspaceId?: string) {
  const consumerId = crypto.randomUUID();
  let current: string | undefined;
  function update(next?: string) {
    if (next === current) return;
    if (current) appStore.dispatch(browserClientsConsumerUnmounted(current, consumerId));
    current = next;
    if (current) appStore.dispatch(browserClientsConsumerMounted(current, consumerId));
  }
  update(workspaceId);
  return { update, destroy: () => update(undefined) };
}
