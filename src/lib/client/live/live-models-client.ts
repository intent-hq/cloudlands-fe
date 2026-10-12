import { backendRequest } from './backend-transport';
import { BackendModelsClient } from './backend-models-client';
import type { ModelsClient } from '../app-client';

/** Svelte transport binding; remove when the Svelte AppClient retires. */
export class LiveModelsClient extends BackendModelsClient implements ModelsClient {
  constructor() {
    super(<T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
      backendRequest<T>(...args),
    );
  }
}
