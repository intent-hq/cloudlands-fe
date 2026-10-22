import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateWorkspaceRequest } from '$shared/types';
import { WorkspaceSchema } from '$shared/schemas';
import { WorkspaceId } from '$shared/types/branded-ids';

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { LiveWorkspacesClient } from './live-workspaces-client';
import { prepareNodeRequest as prepareWithCapabilities } from './node-placement-policy';
function prepareNodeRequest(
  ...args: [string, unknown, (method: string, params?: unknown) => Promise<unknown>, () => boolean]
) {
  return prepareWithCapabilities(...args, () => args[2]('client.hello', {}));
}

const request = vi.mocked(backendRequest);
afterEach(() => vi.resetAllMocks());
const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000123');
const capabilityRequest = (placement: unknown, routing: unknown = 1) =>
  vi.fn(async (method: string) => {
    if (method === 'client.hello')
      return {
        server: {
          capabilities: { agentNodes: 1, agentPlatformRouting: routing, localNodeIsolation: 1 },
        },
      };
    if (method === 'workspace.get')
      return { workspace: { id: workspaceId, defaultAgentPlacement: placement } };
    throw new Error(`Unexpected ${method}`);
  });

describe('workspace placement default compatibility', () => {
  it.each([
    {},
    { arch: 'x86_64' },
    { os: 'linux', arch: 'aarch64' },
    { target: 'local', checkout: 'isolated' },
  ])(
    'preserves the selected stored object %j through schema and workspace read',
    async (placement) => {
      expect(WorkspaceSchema.shape.defaultAgentPlacement.parse(placement)).toEqual(placement);
      request.mockResolvedValue({
        workspace: { id: workspaceId, defaultAgentPlacement: placement },
      });
      const workspace = await new LiveWorkspacesClient().get(workspaceId);
      expect(workspace?.defaultAgentPlacement).toEqual(placement);
      expect(request).toHaveBeenCalledExactlyOnceWith('workspace.get', { workspaceId });
    },
  );

  it('keeps an omitted read default absent', async () => {
    request.mockResolvedValue({ workspace: { id: workspaceId } });
    expect(await new LiveWorkspacesClient().get(workspaceId)).not.toHaveProperty(
      'defaultAgentPlacement',
    );
  });

  it('preserves update null as a clear and omission as no change', async () => {
    request.mockResolvedValue({ workspace: { id: workspaceId } });
    const client = new LiveWorkspacesClient();
    const clear: UpdateWorkspaceRequest = { id: workspaceId, defaultAgentPlacement: null };
    await expect(client.update(clear)).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenLastCalledWith('workspace.update', {
      workspaceId,
      defaultAgentPlacement: null,
    });
    await client.update({ id: workspaceId, title: 'Renamed' });
    expect(request).toHaveBeenLastCalledWith('workspace.update', { workspaceId, title: 'Renamed' });
  });

  it.each([
    null,
    { arch: 'amd64' },
    { arch: 'x86_64', unexpected: true },
    { arch: null },
    { target: 'remote', checkout: 'shared' },
    { nodeId: 'é'.repeat(65) },
  ])('rejects malformed stored defaults instead of losing intent: %j', async (placement) => {
    request.mockResolvedValue({
      workspace: { id: workspaceId, defaultAgentPlacement: placement },
    });
    await expect(new LiveWorkspacesClient().get(workspaceId)).rejects.toThrow();
  });

  it.each([{}, { arch: 'x86_64' }])(
    'forwards an inherited widened object %j only with routing capability',
    async (placement) => {
      const input = { workspaceId };
      await expect(
        prepareNodeRequest('agent.create', input, capabilityRequest(placement), () => true),
      ).resolves.toEqual({ ...input, placement });
      await expect(
        prepareNodeRequest('agent.create', input, capabilityRequest(placement, null), () => true),
      ).rejects.toThrow(/unavailable/);
    },
  );
});
