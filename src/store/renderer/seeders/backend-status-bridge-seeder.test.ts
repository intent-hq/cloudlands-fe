import { expect, it, vi } from 'vitest';
import { NodeExecutionClient } from '$features/agent/services/node-execution';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import './backend-status-bridge-seeder';

it('refuses node placement when the mock bridge has no acknowledged daemon capabilities', async () => {
  const request = vi.fn();
  const client = new NodeExecutionClient(
    request,
    () => true,
    async () => {
      const response = await mockInvoke<{ result: unknown }>(
        IPC_CHANNELS.BACKEND.NODE_CAPABILITIES,
      );
      return response.result;
    },
  );
  await expect(
    client.preparePlacement({ target: 'local', checkout: 'isolated' }),
  ).rejects.toThrow();
  await expect(
    client.merge({
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: crypto.randomUUID(),
      checkpointId: 'checkpoint',
    }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
