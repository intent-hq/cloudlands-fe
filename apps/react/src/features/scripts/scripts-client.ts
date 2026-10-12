import { backend } from '../backend/backend-transport';
import { createBackendScriptsClient } from '$lib/client/live/backend-scripts-client';

export const scriptsClient = createBackendScriptsClient(backend);
