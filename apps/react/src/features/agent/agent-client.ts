import { backend } from '@/features/backend/backend-transport';
import { createBackendAgentClient } from '$lib/client/live/backend-agent-client';
export const agentClient = createBackendAgentClient(backend);
