import { backend } from '../backend/backend-transport';
import { createBackendEventsClient } from '$lib/client/live/backend-events-client';

export const eventsClient = createBackendEventsClient(backend);
