/**
 * Provider models cache seeder.
 *
 * Registers mock-harness parity for the session-lifetime provider-models
 * cache. Production reconnect invalidation is owned by `daemonEventsSaga`,
 * which already owns the root-lifetime `onBackendReconnected` subscription.
 *
 * No connect-time hydration happens here — the cache starts empty by design
 * (session-lifetime only) and is populated lazily by the picker fetch paths
 * dispatching `providerModelsLoaded`.
 */
import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { registerMockSeeder } from '../mock-bootstrap';
import { providerModelsCacheCleared } from '../slices/provider-models/provider-models-slice';

/** Disposer for the mock reconnect listener (guards repeated seedMockStore runs). */
let offMockReconnect: (() => void) | undefined;

registerMockSeeder('provider-models', ({ store }) => {
  offMockReconnect?.();
  offMockReconnect = onBackendReconnected(() => {
    store.dispatch(providerModelsCacheCleared());
  });
});
