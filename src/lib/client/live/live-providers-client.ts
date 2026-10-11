import { backendRequest } from './backend-transport';
import { BackendProvidersClient } from './backend-providers-client';
import type { ProvidersClient } from '../app-client';

/** Svelte transport binding; remove when the Svelte AppClient retires. */
export class LiveProvidersClient extends BackendProvidersClient implements ProvidersClient {
  constructor() {
    super(backendRequest);
  }
}
