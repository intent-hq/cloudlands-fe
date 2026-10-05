import { m } from '$shared/paraglide/messages.js';
import { z } from 'zod';
import {
  AgentPlacementSchema,
  AgentPlacementRequestSchema,
  type AgentPlacementRequest,
} from '$shared/types/agent-node';

export interface NodeCapabilities {
  agentNodes: boolean;
  localNodeIsolation: boolean;
  agentPlatformRouting?: boolean;
}
export function assertPlacementSupported(
  placement: AgentPlacementRequest,
  capabilities: NodeCapabilities,
): void {
  if (
    !capabilities.agentNodes ||
    (!AgentPlacementSchema.safeParse(placement).success &&
      capabilities.agentPlatformRouting !== true) ||
    (placement.target === 'local' &&
      (placement.checkout ?? 'isolated') === 'isolated' &&
      !capabilities.localNodeIsolation)
  ) {
    throw new Error(m.agent_placement_unavailable());
  }
}
const hubTarget = z
  .object({
    workspaceId: z.string().min(1),
    agentId: z.string().min(1),
    requestId: z.string().uuid(),
  })
  .strict();
const hubMerge = hubTarget.extend({ checkpointId: z.string().min(1) });
const hubMergeResult = z.object({
  ok: z.literal(true),
  status: z.enum(['merged', 'conflict', 'blocked']),
  commitRange: z.string().optional(),
  canonicalHead: z.string().optional(),
  conflictingPaths: z.array(z.string()).optional(),
  reason: z.string().optional(),
  overlappingPaths: z.array(z.string()).optional(),
});
export type HubMergeResult = z.infer<typeof hubMergeResult>;

/** Client→head public contract (§5.50). Never uses private node lifecycle RPCs. */
export class NodeExecutionClient {
  constructor(
    private readonly request: (method: string, params?: unknown) => Promise<unknown>,
    private readonly remoteEnabled: () => boolean,
    private readonly observeCapabilities: () => Promise<unknown>,
  ) {}

  async capabilities(): Promise<NodeCapabilities> {
    const hello = (await this.observeCapabilities()) as {
      server?: {
        capabilities?: {
          agentNodes?: unknown;
          localNodeIsolation?: unknown;
          agentPlatformRouting?: unknown;
        };
      };
    } | null;
    const caps = hello?.server?.capabilities;
    return {
      agentNodes: caps?.agentNodes === 1,
      ...(caps?.agentNodes === 1 && caps?.agentPlatformRouting === 1
        ? { agentPlatformRouting: true }
        : {}),
      localNodeIsolation: caps?.agentNodes === 1 && caps?.localNodeIsolation === 1,
    };
  }

  async preparePlacement(input: AgentPlacementRequest): Promise<AgentPlacementRequest> {
    const placement = AgentPlacementRequestSchema.parse(input);
    const checkLabs = () => {
      if (
        (placement.target === 'remote' || placement.exclusive === true) &&
        !this.remoteEnabled()
      ) {
        throw new Error(m.agent_placement_labsRequired());
      }
    };
    checkLabs();
    const capabilities = await this.capabilities();
    checkLabs();
    assertPlacementSupported(placement, capabilities);
    return placement;
  }

  private async requireHub(): Promise<void> {
    if (!(await this.capabilities()).agentNodes) {
      throw new Error(m.agent_placement_unavailable());
    }
  }

  async merge(input: z.infer<typeof hubMerge>): Promise<HubMergeResult> {
    const params = hubMerge.parse(input);
    await this.requireHub();
    return hubMergeResult.parse(await this.request('hub.merge', params));
  }

  async discard(input: z.infer<typeof hubTarget>): Promise<{ ok: true }> {
    const params = hubTarget.parse(input);
    await this.requireHub();
    return z.object({ ok: z.literal(true) }).parse(await this.request('hub.discard', params));
  }
}
