import { AgentPlacementRequestSchema } from '$shared/types/agent-node';
import {
  NodeExecutionClient,
  assertPlacementSupported,
} from '$features/agent/services/node-execution';
import { m } from '$shared/paraglide/messages.js';

type Request = (method: string, params?: unknown) => Promise<unknown>;
type Params = Record<string, unknown>;
function object(value: unknown): Params {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Params) : {};
}
function nestedKey(method: string): string | undefined {
  return method === 'workspace.create'
    ? 'initialAgent'
    : method === 'agent.wakeOrCreate'
      ? 'create'
      : undefined;
}
export function needsPlacementPolicy(method: string, params: unknown): boolean {
  return (
    ['agent.create', 'agent.delegate', 'agent.wakeOrCreate', 'workspace.create'].includes(method) ||
    (method === 'workspace.update' && 'defaultAgentPlacement' in object(params))
  );
}

/** Whole-object precedence: task > call > selected specialist > workspace. */
export async function prepareNodeRequest(
  method: string,
  input: unknown,
  request: Request,
  remoteEnabled: () => boolean,
  observeCapabilities: () => Promise<unknown>,
): Promise<unknown> {
  const params = object(input);
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
          observeCapabilities,
        ),
      );
      tasks.push({ ...entry, ...(resolved.placement ? { placement: resolved.placement } : {}) });
    }
    // Explicit call overrides were copied to each task; unresolved tasks retain omission.
    const { placement: _placement, ...rest } = params;
    return { ...rest, tasks };
  }
  const client = new NodeExecutionClient(request, remoteEnabled, observeCapabilities);
  if (method === 'workspace.update') {
    if (params.defaultAgentPlacement != null)
      await client.preparePlacement(
        AgentPlacementRequestSchema.parse(params.defaultAgentPlacement),
      );
    return input;
  }
  const key = nestedKey(method);
  if (key === 'initialAgent' && !params[key]) return input;
  const creation = key ? object(params[key]) : params;
  if (creation.isolation === 'cow') throw new Error(m.agent_placement_retiredIsolation());
  if (creation.placement !== undefined && creation.isolation !== undefined)
    throw new Error(m.agent_placement_incompatibleIsolation());
  let placement = creation.placement;
  let capabilities = await client.capabilities();
  let readDefaults = false;
  if (placement === undefined) {
    const workspaceId = params.workspaceId;
    let workspace: Params | undefined;
    const getWorkspace = async () => {
      if (!workspace) {
        readDefaults = true;
        const result = object(await request('workspace.get', { workspaceId }));
        workspace = object(result.workspace ?? result);
      }
      return workspace;
    };
    const specialistId = creation.specialistId ?? creation.specialist;
    // Task-only delegation resolves its specialist on the daemon. Promoting the
    // workspace default here would make it outrank that specialist's runsOn.
    if (method === 'agent.delegate' && (typeof specialistId !== 'string' || !specialistId))
      return input;
    if (typeof specialistId === 'string' && specialistId) {
      readDefaults = true;
      const suppliedPath = creation.workspacePath ?? params.workspacePath;
      let workspacePath =
        typeof suppliedPath === 'string' && suppliedPath ? suppliedPath : undefined;
      if (!workspacePath && typeof workspaceId === 'string') {
        const current = await getWorkspace();
        // Public workspace checkout paths only; a nodePath is never a project root.
        const checkoutPath = current.worktreePath ?? current.repositoryPath;
        if (typeof checkoutPath === 'string' && checkoutPath) workspacePath = checkoutPath;
      }
      const result = object(
        await request('specialist.get', {
          id: specialistId,
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspacePath ? { workspacePath } : {}),
        }),
      );
      if (!result.specialist) throw new Error(m.agent_placement_specialistUnavailable());
      placement = object(result.specialist).runsOn;
    }
    if (placement == null && typeof workspaceId === 'string') {
      placement = (await getWorkspace()).defaultAgentPlacement;
    }
  }
  // Even old daemons must not silently discard a known new placement configuration.
  if (!capabilities.agentNodes) {
    if (placement != null) throw new Error(m.agent_placement_unavailable());
    return input;
  }
  const checked = placement == null ? undefined : AgentPlacementRequestSchema.parse(placement);
  if (!remoteEnabled() && (checked?.target === 'remote' || checked?.exclusive === true))
    throw new Error(m.agent_placement_labsRequired());
  if (readDefaults) capabilities = await client.capabilities();
  if (checked) assertPlacementSupported(checked, capabilities);
  else if (!capabilities.agentNodes) throw new Error(m.agent_placement_unavailable());
  // Omitted placement follows the documented head default, without a human launch prompt.
  // Known remote intent remains explicit and must never be converted to a local fallback.
  if (!remoteEnabled() && (checked?.target === 'remote' || checked?.exclusive === true))
    throw new Error(m.agent_placement_labsRequired());
  if (!checked) return input;
  if (creation.isolation !== undefined) throw new Error(m.agent_placement_incompatibleIsolation());
  const resolved = { ...creation, placement: checked };
  return key ? { ...params, [key]: resolved } : resolved;
}

/** Synchronous final check; call directly before transport dispatch. */
export function assertRemoteRequestEnabled(method: string, input: unknown, enabled: boolean): void {
  if (enabled) return;
  const params = object(input);
  const key = nestedKey(method);
  const creation = key ? object(params[key]) : params;
  const placements = Array.isArray(creation.tasks)
    ? creation.tasks.map((task) => object(task).placement ?? creation.placement)
    : [creation.placement];
  placements.push(params.defaultAgentPlacement);
  if (
    placements.some(
      (placement) => object(placement).target === 'remote' || object(placement).exclusive === true,
    )
  )
    throw new Error(m.agent_placement_labsRequired());
}
