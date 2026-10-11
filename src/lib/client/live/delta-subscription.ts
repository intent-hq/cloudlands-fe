/** Svelte transport binding retained for existing live domain clients. */
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import {
  createDeltaSubscriptionRuntime,
  type DeltaSubscriptionConfig,
} from './delta-subscription-runtime';
export { DeltaReconciler, parseSubscriptionPush } from './delta-subscription-runtime';
export type {
  DeltaPayload,
  SubscriptionPush,
  TypedChannelDescriptor,
  DeltaSubscriptionConfig,
} from './delta-subscription-runtime';
export function createDeltaSubscription<T>(config: DeltaSubscriptionConfig<T>) {
  return createDeltaSubscriptionRuntime(
    { ...config, handler: (snapshot) => config.handler(snapshot) },
    {
      backendRequest,
      onBackendNotification,
      onBackendReconnected,
    },
  );
}
