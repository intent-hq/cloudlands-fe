/**
 * Live agents domain backed by the intentd daemon.
 *
 * Reads resolve via `agent.list({ workspaceId })` / `agent.get({ agentId })`.
 * `subscribe` emits an initial snapshot aggregated across workspaces, then
 * refetches on agent LIFECYCLE events only — `agent:stream:*` and `agent:message`
 * are high-volume, so this intentionally narrows to start/complete/idle/
 * status-changed rather than blanket-subscribing `agent:*`.
 */
import { AgentStatus } from "$shared/types";
import { AgentId, WorkspaceId } from "$shared/types/branded-ids";
import type { AgentSession } from "$shared/types";
import type {
  AgentCreateRequest,
  AgentsClient,
  MutationResult,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import { isEventOneOf, listWorkspaceIds, newIdempotencyKey, runMutation } from "./live-support";

/** Lifecycle events that warrant an agent-list refresh (NOT stream/message). */
const AGENT_LIFECYCLE_EVENTS = [
  "agent:started",
  "agent:completed",
  "agent:failed",
  "agent:created",
  "agent:deleted",
  "agent:idle",
  "agent:status-changed",
  "agent:renamed",
] as const;

/** Coerce a raw daemon agent object into the renderer `AgentSession` shape. */
function normalizeAgent(raw: Record<string, unknown>): AgentSession {
  const now = new Date().toISOString();
  const id = String(raw.id ?? "");
  const acpSessionId = raw.acpSessionId ? String(raw.acpSessionId) : null;
  return {
    ...(raw as Partial<AgentSession>),
    id: AgentId(id),
    backendSessionId: acpSessionId ? AgentId(acpSessionId) : null,
    workspaceId: WorkspaceId(String(raw.workspaceId ?? "")),
    name: String(raw.name ?? id),
    status: (typeof raw.status === "string" ? raw.status : AgentStatus.Pending) as AgentStatus,
    // The list/get payloads carry message COUNTS, not transcripts; chat history
    // is served by the (still-mock) chat domain, so messages start empty here.
    messages: Array.isArray(raw.messages) ? (raw.messages as AgentSession["messages"]) : [],
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  } as AgentSession;
}

export class LiveAgentsClient implements AgentsClient {
  async list(workspaceId: string): Promise<AgentSession[]> {
    const result = await backendRequest<{ agents?: unknown[] }>("agent.list", { workspaceId });
    const agents = Array.isArray(result?.agents) ? result.agents : [];
    return agents.map((a) => normalizeAgent(a as Record<string, unknown>));
  }

  async get(agentId: string): Promise<AgentSession | null> {
    const result = await backendRequest<{ agent?: unknown } | unknown>("agent.get", { agentId });
    const raw =
      result && typeof result === "object" && "agent" in result
        ? (result as { agent?: unknown }).agent
        : result;
    if (!raw || typeof raw !== "object") return null;
    return normalizeAgent(raw as Record<string, unknown>);
  }

  // Mutations forward to the daemon (§7.2) and fold the outcome into a
  // MutationResult; daemon agent-lifecycle events drive the reactive refresh.
  async create(request: AgentCreateRequest): Promise<MutationResult> {
    // create requires an idempotencyKey (§5.6). The seam's AgentCreateRequest
    // only carries workspaceId/model/specialist/prompt; prompt maps to the
    // wire `behaviorPrompt`. (name/provider/agentType/taskNoteId are not on the
    // request — see the gap noted in the task report.)
    return runMutation("agent.create", {
      workspaceId: request.workspaceId,
      model: request.model,
      specialist: request.specialist,
      behaviorPrompt: request.prompt,
      idempotencyKey: newIdempotencyKey(),
    });
  }
  async send(agentId: string, message: string): Promise<MutationResult> {
    return runMutation("agent.send", { agentId, content: message });
  }
  async queue(agentId: string, message: string): Promise<MutationResult> {
    return runMutation("agent.queue", { agentId, content: message });
  }
  async setAvailability(agentId: string, available: boolean): Promise<MutationResult> {
    return runMutation("agent.setAvailability", { agentId, available });
  }
  async follow(agentId: string, follow: boolean): Promise<MutationResult> {
    return runMutation("agent.follow", { agentId, follow });
  }
  async lock(agentId: string, locked: boolean): Promise<MutationResult> {
    return runMutation("agent.lock", { agentId, locked });
  }

  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe {
    return createDeltaSubscription<AgentSession>({
      eventTypes: [...AGENT_LIFECYCLE_EVENTS],
      matchLegacyEvent: (method, params) => isEventOneOf(method, params, AGENT_LIFECYCLE_EVENTS),
      fetchAll: async () => {
        const ids = await listWorkspaceIds();
        const perWorkspace = await Promise.all(ids.map((id) => this.list(id)));
        return perWorkspace.flat();
      },
      getId: (raw) => String(raw.id ?? ""),
      normalize: (raw) => normalizeAgent(raw),
      handler,
    });
  }
}
