/** Agent model wire binding. Creation and lifecycle mutations remain saga-owned. */
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createBackendAgentClient } from '$lib/client/live/backend-agent-client';
// Resolve source transport exports when called; remove this binding at renderer cutover.
const client = createBackendAgentClient({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
  onBackendNotification: (
    ...args: Parameters<typeof onBackendNotification>
  ): ReturnType<typeof onBackendNotification> => onBackendNotification(...args),
  onBackendReconnected: (
    ...args: Parameters<typeof onBackendReconnected>
  ): ReturnType<typeof onBackendReconnected> => onBackendReconnected(...args),
});
export const agentClient = {
  async setModel(
    agentId: string,
    modelId: string,
    workspaceId: string,
    providerId?: string,
  ): ReturnType<typeof client.setModel> {
    return client.setModel(agentId, modelId, workspaceId, providerId);
  },
};
