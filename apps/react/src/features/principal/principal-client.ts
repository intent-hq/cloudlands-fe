import { backendRequest } from '@/features/backend/backend-transport';
import { createReadConnectedPrincipal } from '$lib/client/live/principal-client';
export const readConnectedPrincipal = createReadConnectedPrincipal(backendRequest);
