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
  PermissionOutcome,
  RespondPermissionResult,
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
  // from `agent.getConversation` (§5.5), which returns one page of messages
  // (oldest→newest within the page). The daemon clamps `limit` to `[1,200]` —
  // `pageToken` walks backward to older pages, and `nextToken` is `null` once
  // the oldest message has been returned. The chat-read-service loops on
  // `nextToken` to assemble the full transcript. `messages` is returned raw;
  // the agent-session reducer normalizes/sorts/dedups/prunes on ingest.
  async getConversation(
    agentId: string,
    limit = 200,
    pageToken?: string,
  ): Promise<{
    messages: AgentMessage[];
    truncated: boolean;
    totalMessages: number;
    nextToken: string | null;
  }> {
    const params: Record<string, unknown> = { agentId, limit };
    if (pageToken !== undefined) params.nextToken = pageToken;
    const result = await backendRequest<{
      messages?: unknown[];
      truncated?: boolean;
      totalMessages?: number;
      nextToken?: unknown;
    }>("agent.getConversation", params);
    if (!result || typeof result !== "object") {
      return { messages: [], truncated: false, totalMessages: 0, nextToken: null };
    }
    const messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
    return {
      messages,
      truncated: Boolean(result.truncated),
      totalMessages: typeof result.totalMessages === "number" ? result.totalMessages : 0,
      nextToken: typeof result.nextToken === "string" ? result.nextToken : null,
    };
  }

  // Mutations forward to the daemon (§7.2); daemon agent-lifecycle events
  // drive the reactive refresh. `create` returns the full session projection
  // (widened in P2-12a) so the caller can upsert without a follow-up `agent.get`.
  async create(request: AgentCreateRequest): Promise<AgentSession> {
    // create requires an idempotencyKey (§5.6). The widened P2-12a wire also
    // accepts optional `name` / `agentId` / `provider` / `agentType` /
    // `metadata` / `workspacePath` / `workspaceContext`; each is only sent
    // when the caller supplied it so the daemon sees `undefined` params
    // (equivalent to omitted) rather than explicit nulls it would reject.
    const params: Record<string, unknown> = {
      workspaceId: request.workspaceId,
      idempotencyKey: newIdempotencyKey(),
    };
    if (request.model !== undefined) params.model = request.model;
    if (request.specialist !== undefined && request.specialist !== null) {
      params.specialistId = request.specialist;
    }
    if (request.prompt !== undefined) params.behaviorPrompt = request.prompt;
    if (request.name !== undefined) params.name = request.name;
    if (request.agentId !== undefined) params.agentId = request.agentId;
    if (request.provider !== undefined) params.provider = request.provider;
    if (request.agentType !== undefined) params.agentType = request.agentType;
    if (request.metadata !== undefined) params.metadata = request.metadata;
    if (request.workspacePath !== undefined) params.workspacePath = request.workspacePath;
    if (request.workspaceContext !== undefined) {
      params.workspaceContext = request.workspaceContext;
    }
    const result = await backendRequest<{ agent?: unknown } | unknown>("agent.create", params);
    // Widened §5.5 wire returns `{ agent: AgentLite }`; the pre-widening
    // `{ id, name }` shape is a strict subset, so we tolerate a bare object
    // for older daemons without healing anything the current contract owns.
    const raw =
      result && typeof result === "object" && "agent" in result
        ? (result as { agent?: unknown }).agent
        : result;
    if (!raw || typeof raw !== "object") {
      throw new Error("agent.create returned no agent object");
    }
    return normalizeAgent(raw as Record<string, unknown>);
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
  async stop(agentId: string): Promise<MutationResult> {
    // `agent.stop` (§5.5) takes `{ agentId }` and acks `{ success: true }`.
    // The daemon cancels the in-flight stream and emits the terminal
    // `agent:stream:end` (§7), which converges the FE streaming state.
    return runMutation("agent.stop", { agentId });
  }
  async delete(agentId: string): Promise<MutationResult> {
    // `agent.delete` (§5.5) takes `agentId` (req) and an optional `workspaceId`;
    // the daemon resolves the workspace itself (agent_delete_op only consumes
    // agent_id) and is idempotent, so we forward just `{ agentId }` and rely on
    // the emitted `agent:deleted` event to reconcile the list.
    return runMutation("agent.delete", { agentId });
  }
  async retry(
    agentId: string,
    workspaceId: string,
  ): Promise<{ ok: true; redriven?: boolean } | { ok: false; error: string }> {
    // `agent.retry` redrives a failed agent spawn. Only valid when agent status
    // is `error`; returns `{ ok: false }` otherwise. On ok:true, `redriven`
    // reports whether a queued message existed and is being redriven (status
    // cleared to pending) or the queue was empty (status cleared to idle —
    // nothing to redrive). Emits agent:status-changed events.
    try {
      const result = await backendRequest<{ ok?: unknown; redriven?: unknown } | undefined>(
        "agent.retry",
        { agentId, workspaceId },
      );
      if (result?.ok !== true) {
        return { ok: false, error: "Agent not in error status" };
      }
      const redriven = typeof result.redriven === "boolean" ? result.redriven : undefined;
      return { ok: true, redriven };
    } catch (error) {
      // Transport/RPC errors return { ok: false, error } rather than throwing so
      // callers can surface the error and keep the retry button visible.
      const errorMsg = error instanceof Error ? error.message : "Failed to retry agent spawn";
      return { ok: false, error: errorMsg };
    }
  }
  async respondPermission(
    requestId: string,
    outcome: PermissionOutcome,
  ): Promise<RespondPermissionResult> {
    // `agent.respondPermission` (PROTOCOL §8) forwards the caller's outcome to
    // the blocked provider and emits `agent:permission:resolved` so any other
    // client can clear its inline prompt. The daemon returns `{ resolved }` —
    // `false` when the pending prompt is already gone (5-min timeout or an
    // earlier response) — which we surface on top of MutationResult so callers
    // decide whether to keep the local slice entry visible for a retry.
    try {
      const result = await backendRequest<{ resolved?: unknown } | undefined>(
        "agent.respondPermission",
        { requestId, outcome },
      );
      const resolved = typeof result?.resolved === "boolean" ? result.resolved : undefined;
      return resolved !== undefined ? { success: true, resolved } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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
