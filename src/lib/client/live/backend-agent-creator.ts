import type { AgentCreateRequest } from '../app-client';
import type { AgentSession } from '$shared/types/agent-session';
import type { BackendRuntime } from './backend-transport-runtime';
import { normalizeAgent } from './agent-normalization';
import { newIdempotencyKey } from './idempotency-key';

/** Canonical agent.create wire mapping with a caller-owned transport. */
export function createBackendAgentCreator({
  backendRequest,
}: Pick<BackendRuntime, 'backendRequest'>) {
  return async function create(
    request: AgentCreateRequest,
    onDispatch?: () => void,
  ): Promise<AgentSession> {
    // create requires an idempotencyKey (§5.6). The widened P2-12a wire also
    // accepts optional `name` / `provider` / `agentType` / `metadata` /
    // `workspacePath` / `workspaceContext`; each is only sent when the caller
    // supplied it so the daemon sees `undefined` params (equivalent to
    // omitted) rather than explicit nulls it would reject.
    //
    // `agentId` is intentionally NEVER forwarded: the daemon assigns the
    // session id and returns it on the created agent. Callers must adopt the
    // response id (a follow-up intentd change rejects client-supplied ids).
    const params: Record<string, unknown> = {
      workspaceId: request.workspaceId,
      idempotencyKey: newIdempotencyKey(),
    };
    if (request.placement !== undefined) params.placement = request.placement;
    if (request.model !== undefined) params.model = request.model;
    if (request.reasoningEffort !== undefined) params.reasoningEffort = request.reasoningEffort;
    if (request.rememberSpecialist !== undefined)
      params.rememberSpecialist = request.rememberSpecialist;
    if (
      request.specialist !== undefined &&
      (request.specialist !== null || request.rememberSpecialist)
    ) {
      params.specialistId = request.specialist;
    }
    if (request.prompt !== undefined) params.behaviorPrompt = request.prompt;
    if (request.name !== undefined) params.name = request.name;
    // Strict boolean on the wire (§5.5): only sent when the caller supplied it,
    // so older daemons and name-less creates keep the daemon-side default
    // (name-present ⇒ explicitly set).
    if (request.nameExplicitlySet !== undefined) {
      params.nameExplicitlySet = request.nameExplicitlySet;
    }
    if (request.provider !== undefined) params.provider = request.provider;
    if (request.agentType !== undefined) params.agentType = request.agentType;
    if (request.metadata !== undefined) params.metadata = request.metadata;
    if (request.workspacePath !== undefined) params.workspacePath = request.workspacePath;
    if (request.workspaceContext !== undefined) {
      params.workspaceContext = request.workspaceContext;
    }
    const result = onDispatch
      ? await backendRequest<unknown>('agent.create', params, { onDispatch })
      : await backendRequest<unknown>('agent.create', params);
    // Widened §5.5 wire returns `{ agent: AgentLite }`; the pre-widening
    // `{ id, name }` shape is a strict subset, so we tolerate a bare object
    // for older daemons without healing anything the current contract owns.
    const raw =
      result && typeof result === 'object' && 'agent' in result
        ? (result as { agent?: unknown }).agent
        : result;
    if (!raw || typeof raw !== 'object') {
      throw new Error('agent.create returned no agent object');
    }
    // The daemon-assigned `agent.id` is the only way to address follow-up
    // sends/streams (no client id is forwarded). Fail loudly rather than let
    // normalizeAgent coerce a missing id into an empty-string session key.
    const rawId = (raw as Record<string, unknown>).id;
    if (typeof rawId !== 'string' || rawId.length === 0) {
      throw new Error('agent.create response missing daemon-assigned agent.id');
    }
    return normalizeAgent(raw as Record<string, unknown>);
  };
}
