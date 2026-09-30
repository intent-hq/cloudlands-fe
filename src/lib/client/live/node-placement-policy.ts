import { AgentPlacementSchema, type AgentPlacement } from '$shared/types/agent-node';
import {
  NodeExecutionClient,
  type NodeCapabilities,
} from '$features/agent/services/node-execution';
import { m } from '$shared/paraglide/messages.js';

type Request = (method: string, params?: unknown) => Promise<unknown>;
type Params = Record<string, unknown>;
type ChooseLocal = (capabilities: NodeCapabilities) => Promise<AgentPlacement>;
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

/** Final synchronous completeness check, including an on→off change after preflight. */
export function needsLocalPlacement(method: string, input: unknown): boolean {
  if (method === 'workspace.update') return false;
  const params = object(input);
  const key = nestedKey(method);
  if (key === 'initialAgent' && !params[key]) return false;
  const creation = key ? object(params[key]) : params;
  if (Array.isArray(creation.tasks))
    return creation.tasks.some(
      (task) => object(object(task).placement ?? creation.placement).target !== 'local',
    );
  return object(creation.placement).target !== 'local';
}

/** Whole-object precedence: task > call > selected specialist > workspace. */
export async function prepareNodeRequest(
  method: string,
  input: unknown,
  request: Request,
  remoteEnabled: () => boolean,
  chooseLocal: ChooseLocal = async () => {
    throw new Error(m.agent_placement_chooseLocal());
  },
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
          chooseLocal,
        ),
      );
      tasks.push({ ...entry, ...(resolved.placement ? { placement: resolved.placement } : {}) });
    }
    // Every task now carries its own resolved override; the call default is no longer needed.
    const { placement: _placement, ...rest } = params;
    return { ...rest, tasks };
  }
  const client = new NodeExecutionClient(request, remoteEnabled);
  if (method === 'workspace.update') {
    if (params.defaultAgentPlacement != null)
      await client.preparePlacement(AgentPlacementSchema.parse(params.defaultAgentPlacement));
    return input;
  }
  const key = nestedKey(method);
  if (key === 'initialAgent' && !params[key]) return input;
  const creation = key ? object(params[key]) : params;
  if (creation.isolation === 'cow')
    throw new Error('Per-agent CoW isolation is retired. Choose node placement.');
  if (creation.placement !== undefined && creation.isolation !== undefined)
    throw new Error('Placement cannot be combined with legacy isolation.');
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
      if (!result.specialist)
        throw new Error('The selected specialist is unavailable. Select a specialist again.');
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
  let checked = placement == null ? undefined : AgentPlacementSchema.parse(placement);
  if (!remoteEnabled() && checked?.target !== 'local') {
    checked = AgentPlacementSchema.parse(await chooseLocal(capabilities));
    if (checked.target !== 'local') throw new Error(m.agent_placement_chooseLocal());
    readDefaults = true;
  }
  if (readDefaults) capabilities = await client.capabilities();
  if (
    !capabilities.agentNodes ||
    (checked?.target === 'local' &&
      checked.checkout === 'isolated' &&
      !capabilities.localNodeIsolation)
  )
    throw new Error(m.agent_placement_unavailable());
  // Reapply the off rule after capability/default/dialog awaits without changing inherited choices silently.
  if (!remoteEnabled() && checked?.target !== 'local') {
    checked = AgentPlacementSchema.parse(await chooseLocal(capabilities));
    if (checked.target !== 'local') throw new Error(m.agent_placement_chooseLocal());
    checked = await client.preparePlacement(checked);
  }
  if (!checked) return input;
  if (creation.isolation !== undefined)
    throw new Error('Placement cannot be combined with legacy isolation.');
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
  if (placements.some((placement) => object(placement).target === 'remote'))
    throw new Error(m.agent_placement_labsRequired());
}
