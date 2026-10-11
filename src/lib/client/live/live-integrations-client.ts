import type { AppClient } from '../app-client';
import {
  backendRequest,
  captureBackendRepositoryCheckout,
  captureBackendRepositoryResource,
} from './backend-transport';
import { LiveIntegrationsClientCore } from './live-integrations-client-core';

/** Compatibility constructor for LiveAppClient until the legacy renderer is retired. */
export class LiveIntegrationsClient extends LiveIntegrationsClientCore {
  constructor() {
    super({ backendRequest, captureBackendRepositoryCheckout, captureBackendRepositoryResource });
  }
}

// Preserve the AppClient contract check at the legacy composition boundary.
const _interfaceCheck: AppClient['integrations'] | undefined = undefined as
  LiveIntegrationsClient | undefined;
void _interfaceCheck;
