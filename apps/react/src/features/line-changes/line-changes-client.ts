import { backend } from '../backend/backend-transport';
import { createBackendLineChangesClient } from '$lib/client/live/backend-line-changes-client';

export const lineChangesClient = createBackendLineChangesClient(backend);
