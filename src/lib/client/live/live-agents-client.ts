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
import type { AgentMessage, AgentSession } from "$shared/types";
import type { QueuedMessage } from "$shared/types/agent-session";
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

/**
 * agentId → workspaceId cache populated by every `normalizeAgent` call (so any
 * `list`/`get`/subscribe ingest also primes it). `agent.sendMessage` (§5.5)
 * requires `workspaceId`, but the seam's `send(agentId, message)` does not
 * carry it — this index lets us recover it without changing the public method
 * signature. Miss → fall back to a fresh `agent.get`.
 */
const agentWorkspaceIndex = new Map<string, string>();

function rememberAgentWorkspace(agentId: string, workspaceId: string): void {
  if (agentId && workspaceId) agentWorkspaceIndex.set(agentId, workspaceId);
}

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
  const workspaceId = String(raw.workspaceId ?? "");
  rememberAgentWorkspace(id, workspaceId);
  return {
    ...(raw as Partial<AgentSession>),
    id: AgentId(id),
    backendSessionId: acpSessionId ? AgentId(acpSessionId) : null,
    workspaceId: WorkspaceId(workspaceId),
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

  // The list/get payloads carry message COUNTS only; the real transcript comes
  // from `agent.getConversation` (§5.5), which returns most-recent-N messages
  // (no continuation token — older history beyond `limit` is a documented daemon
  // gap). `messages` is returned raw; the agent-session reducer normalizes/sorts/
  // dedups/prunes on ingest.
  async getConversation(
    agentId: string,
    limit = 500,
  ): Promise<{ messages: AgentMessage[]; truncated: boolean; totalMessages: number }> {
    const result = await backendRequest<{
      messages?: unknown[];
      truncated?: boolean;
      totalMessages?: number;
    }>("agent.getConversation", { agentId, limit });
    if (!result || typeof result !== "object") {
      return { messages: [], truncated: false, totalMessages: 0 };
    }
    const messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
    return {
      messages,
      truncated: Boolean(result.truncated),
      totalMessages: typeof result.totalMessages === "number" ? result.totalMessages : 0,
    };
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
    const workspaceId = await this.resolveAgentWorkspaceId(agentId);
    if (!workspaceId) {
      return { success: false, error: `Unknown workspace for agent ${agentId}` };
    }
    // The seam's `send(agentId, message)` does not carry a messageId, so we mint
    // a stable uuid here. The daemon echoes it back on `agent:user-message:sent`,
    // which the renderer can use to reconcile the optimistic message it inserted
    // (§10.3). `agent.sendMessage` auto-queues internally if the agent is
    // mid-stream — the seam's `queue` is the explicit-enqueue path.
    const messageId = newIdempotencyKey();
    return runMutation("agent.sendMessage", { agentId, content: message, workspaceId, messageId });
  }
  async queue(agentId: string, message: string): Promise<MutationResult> {
    // `agent.queueMessage` returns `{ success, queuedMessage }` (§5.5); we
    // surface `queuedMessage` on the MutationResult so callers can render the
    // queue position / id without an extra `agent.getQueue` round-trip.
    try {
      const result = await backendRequest<{ queuedMessage?: QueuedMessage } | undefined>(
        "agent.queueMessage",
        { agentId, content: message },
      );
      const queuedMessage = result?.queuedMessage;
      return queuedMessage ? { success: true, queuedMessage } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async removeQueued(agentId: string, messageId: string): Promise<MutationResult> {
    // `agent.removeQueuedMessage` is **idempotent** on the daemon (§5.5): the
    // BE returns `{ success: true }` whether or not the messageId existed in
    // the persisted queue. `runMutation` folds the daemon body into a uniform
    // success result; any thrown error is a transport/RPC failure, NOT a
    // "not found" — callers (e.g. the queue-mutation handler in
    // chat-send-service) must treat both branches as "already removed" and
    // never roll the optimistic delete back, since the BE may have already
    // self-drained or the FE's seeded queue may diverge after a daemon restart.
    return runMutation("agent.removeQueuedMessage", { agentId, messageId });
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

  /**
   * Resolve the workspace this agent belongs to. Cached on every `normalizeAgent`
   * call (list/get/subscribe paths); on miss we lazily refetch via `agent.get`,
   * which normalizes the response and primes the cache as a side effect. Returns
   * null if the agent cannot be located — caller surfaces the error rather than
   * sending a malformed `agent.sendMessage` request.
   */
  private async resolveAgentWorkspaceId(agentId: string): Promise<string | null> {
    const cached = agentWorkspaceIndex.get(agentId);
    if (cached) return cached;
    const agent = await this.get(agentId);
    if (!agent) return null;
    const resolved = String(agent.workspaceId ?? "");
    return resolved.length > 0 ? resolved : null;
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
