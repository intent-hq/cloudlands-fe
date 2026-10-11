// Svelte client compatibility binding; remove at renderer cutover.
import { backendRequest } from './backend-transport';
import { createReadConnectedPrincipal } from './principal-client';
export { IncompatiblePrincipalResponse, isRetryablePrincipalError } from './principal-client';
export const readConnectedPrincipal = createReadConnectedPrincipal(backendRequest);
