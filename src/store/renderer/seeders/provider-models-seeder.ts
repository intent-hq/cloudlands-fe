/**
 * Provider models cache seeder.
 *
 * Registers the reconnect invalidation for the session-lifetime
 * provider-models cache (the same RESUB-1 trigger the provider-catalog
 * seeder uses to re-hydrate): a backend reconnect may be to a different
 * daemon binary with different adapters/catalogs, so every cached
 * per-provider model list is dropped and pickers fall back to honest
 * loading states until fresh fetches write through again.
 *
 * No connect-time hydration happens here — the cache starts empty by design
 * (session-lifetime only) and is populated lazily by the picker fetch paths
 * dispatching `providerModelsLoaded`.
 */
import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { registerMockSeeder } from '../mock-bootstrap';
import { providerModelsCacheCleared } from '../slices/provider-models/provider-models-slice';

/** Disposer for the reconnect listener (guards repeated seedMockStore runs). */
let offReconnect: (() => void) | undefined;

registerMockSeeder('provider-models', ({ store }) => {
  offReconnect?.();
  offReconnect = onBackendReconnected(() => {
    store.dispatch(providerModelsCacheCleared());
  });
});
