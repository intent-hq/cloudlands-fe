// Svelte lifetime binding; retire with the Svelte renderer.
import { readConnectedPrincipal } from '$lib/client/live/live-principal-client';
import { selectPrincipalConnectionContext, selectPrincipalState } from '../principal-selectors';
import { createPrincipalSaga } from './principal-saga-factory';
export { PRINCIPAL_RETRY_DELAYS_MS } from './principal-saga-factory';
export const principalSaga = createPrincipalSaga({
  readConnectedPrincipal,
  selectPrincipalConnectionContext,
  principalStateEffect: selectPrincipalState.effect,
});
