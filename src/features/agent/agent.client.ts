/** Agent model wire binding. Creation and lifecycle mutations remain saga-owned. */
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createBackendAgentClient } from '$lib/client/live/backend-agent-client';
const client = createBackendAgentClient({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
});
export const agentClient = { setModel: client.setModel };
