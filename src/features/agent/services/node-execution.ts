import { m } from '$shared/paraglide/messages.js';
import { z } from 'zod';
import { AgentPlacementSchema, type AgentPlacement } from '$shared/types/agent-node';

export interface NodeCapabilities {
  agentNodes: boolean;
  localNodeIsolation: boolean;
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
  ) {}

  async capabilities(): Promise<NodeCapabilities> {
    const hello = (await this.request('client.hello', {})) as {
      server?: { capabilities?: { agentNodes?: unknown; localNodeIsolation?: unknown } };
    } | null;
    const caps = hello?.server?.capabilities;
    return {
      agentNodes: caps?.agentNodes === 1,
      localNodeIsolation: caps?.agentNodes === 1 && caps?.localNodeIsolation === 1,
    };
  }

  async preparePlacement(input: AgentPlacement): Promise<AgentPlacement> {
    const placement = AgentPlacementSchema.parse(input);
    const checkLabs = () => {
      if (placement.target === 'remote' && !this.remoteEnabled()) {
        throw new Error(m.agent_placement_labsRequired());
      }
    };
    checkLabs();
    const capabilities = await this.capabilities();
    checkLabs();
    if (
      !capabilities.agentNodes ||
      (placement.target === 'local' &&
        placement.checkout === 'isolated' &&
        !capabilities.localNodeIsolation)
    ) {
      throw new Error(m.agent_placement_unavailable());
    }
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
