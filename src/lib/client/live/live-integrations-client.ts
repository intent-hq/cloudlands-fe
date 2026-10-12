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
    // Resolve legacy transport exports before each operation's arguments, as before extraction.
    super({
      get backendRequest() {
        const request = backendRequest;
        return <T>(...args: Parameters<typeof request>) => request<T>(...args);
      },
      get captureBackendRepositoryCheckout() {
        const capture = captureBackendRepositoryCheckout;
        return (...args: Parameters<typeof capture>) => capture(...args);
      },
      get captureBackendRepositoryResource() {
        const capture = captureBackendRepositoryResource;
        return (...args: Parameters<typeof capture>) => capture(...args);
      },
    });
  }
}

// Preserve the AppClient contract check at the legacy composition boundary.
const _interfaceCheck: AppClient['integrations'] | undefined = undefined as
  LiveIntegrationsClient | undefined;
void _interfaceCheck;
