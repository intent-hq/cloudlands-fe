import { backend } from '../backend/backend-transport';
import { createBackendTerminalsClient } from '$lib/client/live/backend-terminals-client';

export const terminalsClient = createBackendTerminalsClient(backend);
