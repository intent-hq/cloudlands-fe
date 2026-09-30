import { AgentPlacementSchema } from '$shared/types/agent-node';
import { NodeExecutionClient } from '$features/agent/services/node-execution';

type Request = (method: string, params?: unknown) => Promise<unknown>;
type Params = Record<string, unknown>;
function object(value: unknown): Params {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Params) : {};
}

export function needsPlacementPolicy(method: string, params: unknown): boolean {
  return (
    ['agent.create', 'agent.delegate', 'agent.wakeOrCreate', 'workspace.create'].includes(method) ||
    (method === 'workspace.update' && 'defaultAgentPlacement' in object(params))
  );
}

/** Guard all renderer entry routes at their final wire boundary, including commands/proposals. */
export async function prepareNodeRequest(
  method: string,
  input: unknown,
  request: Request,
  remoteEnabled: () => boolean,
): Promise<unknown> {
  const params = object(input);
  assertRemoteRequestEnabled(method, input, remoteEnabled());
  if (method === 'agent.delegate' && Array.isArray(params.tasks)) {
    const tasks = [];
    for (const task of params.tasks) {
      const entry = typeof task === 'string' ? { taskNoteId: task } : object(task);
      const resolved = object(
        await prepareNodeRequest(
          method,
          { ...params, tasks: undefined, ...entry },
          request,
          remoteEnabled,
        ),
      );
      tasks.push({ ...entry, ...(resolved.placement ? { placement: resolved.placement } : {}) });
    }
    const result = { ...params, tasks };
    assertRemoteRequestEnabled(method, result, remoteEnabled());
    return result;
  }
  const client = new NodeExecutionClient(request, remoteEnabled);
  if (method === 'workspace.update') {
    if (params.defaultAgentPlacement != null) {
      await client.preparePlacement(AgentPlacementSchema.parse(params.defaultAgentPlacement));
    }
    return input;
  }
  const nestedKey =
    method === 'workspace.create'
      ? 'initialAgent'
      : method === 'agent.wakeOrCreate'
        ? 'create'
        : undefined;
  if (nestedKey && !params[nestedKey]) return input;
  const creation = nestedKey ? object(params[nestedKey]) : params;
  if (creation.isolation === 'cow')
    throw new Error('Per-agent CoW isolation is retired. Choose node placement.');
  if (creation.placement !== undefined && creation.isolation !== undefined) {
    throw new Error('Placement cannot be combined with legacy isolation.');
  }
  let placement = creation.placement;
  if (placement !== undefined) {
    placement = await client.preparePlacement(AgentPlacementSchema.parse(placement));
  } else {
    const caps = await client.capabilities();
    if (!caps.agentNodes) return input;
    const workspaceId = params.workspaceId;
    const specialistId = creation.specialistId ?? creation.specialist;
    if (typeof specialistId === 'string' && specialistId) {
      const result = object(
        await request('specialist.get', {
          id: specialistId,
          ...(workspaceId ? { workspaceId } : {}),
        }),
      );
      placement = object(result.specialist).runsOn;
    }
    if (placement === undefined && typeof workspaceId === 'string') {
      const result = object(await request('workspace.get', { workspaceId }));
      placement = object(result.workspace ?? result).defaultAgentPlacement;
    }
    if (method === 'agent.delegate' && !specialistId && !remoteEnabled()) {
      // The public contract does not expose task-resolved specialist placement.
      // Require an explicit choice rather than accidentally starting remote work.
      throw new Error(
        'Choose an explicit local placement before delegating with Remote agents disabled.',
      );
    }
    if (placement != null)
      placement = await client.preparePlacement(AgentPlacementSchema.parse(placement));
  }
  // No await after this current-state check and before handing the request to transport.
  if (object(placement).target === 'remote' && !remoteEnabled()) {
    throw new Error('Enable Remote agents in Labs before starting remote work.');
  }
  if (placement == null) return input;
  const resolved = { ...creation, placement };
  return nestedKey ? { ...params, [nestedKey]: resolved } : resolved;
}

/** Synchronous final check; call after every await and directly before transport dispatch. */
export function assertRemoteRequestEnabled(method: string, input: unknown, enabled: boolean): void {
  if (enabled) return;
  const params = object(input);
  const creation =
    method === 'workspace.create'
      ? object(params.initialAgent)
      : method === 'agent.wakeOrCreate'
        ? object(params.create)
        : params;
  const placements = [creation.placement, params.defaultAgentPlacement];
  if (Array.isArray(creation.tasks)) {
    for (const task of creation.tasks) placements.push(object(task).placement);
  }
  if (placements.some((placement) => object(placement).target === 'remote')) {
    throw new Error('Enable Remote agents in Labs before starting remote work.');
  }
}
