/**
 * Live agents domain backed by the intentd daemon.
 *
 * Reads resolve via `agent.list({ workspaceId })` / `agent.get({ agentId })`.
 * `subscribe` aggregates agents across workspaces — converging via one typed
 * per-workspace `agent.subscribe` channel per workspace (PROTOCOL §6.9) on
 * liveState daemons, and refetching on agent LIFECYCLE events otherwise —
 * `agent:stream:*` and `agent:message` are high-volume, so the legacy path
 * intentionally narrows to start/complete/idle/status-changed rather than
 * blanket-subscribing `agent:*`.
 */
import { AgentStatus } from "$shared/types";
import { AgentId, WorkspaceId } from "$shared/types/branded-ids";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { QueuedMessage } from "$shared/types/agent-session";
import type {
  AgentCreateRequest,
  AgentsClient,
  ImageBlock,
  MutationResult,
  PermissionOutcome,
  RespondPermissionResult,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import {
  isEventOneOf,
  listWorkspaceIds,
  mutationErrorMessage,
  newIdempotencyKey,
  runMutation,
  subscribeWorkspaceIds,
} from "./live-support";

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
  // `nextToken` to assemble the full transcript. `aroundMessageId` (§5.5 seek,
  // additive) takes precedence over any token daemon-side and resolves to the
  // page containing that message; seek pages carry `prevToken` (forward cursor
  // toward the live tail — normalized to null on legacy backward pages, which
  // never include the key). `messages` is returned raw; the agent-session
  // reducer normalizes/sorts/dedups/prunes on ingest.
  async getConversation(
    agentId: string,
    limit = 200,
    pageToken?: string,
    aroundMessageId?: string,
  ): Promise<{
    messages: AgentMessage[];
    truncated: boolean;
    totalMessages: number;
    nextToken: string | null;
    prevToken: string | null;
  }> {
    const params: Record<string, unknown> = { agentId, limit };
    if (pageToken !== undefined) params.nextToken = pageToken;
    if (aroundMessageId !== undefined) params.aroundMessageId = aroundMessageId;
    const result = await backendRequest<{
      messages?: unknown[];
      truncated?: boolean;
      totalMessages?: number;
      nextToken?: unknown;
      prevToken?: unknown;
    }>("agent.getConversation", params);
    if (!result || typeof result !== "object") {
      return { messages: [], truncated: false, totalMessages: 0, nextToken: null, prevToken: null };
    }
    const messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
    return {
      messages,
      truncated: Boolean(result.truncated),
      totalMessages: typeof result.totalMessages === "number" ? result.totalMessages : 0,
      nextToken: typeof result.nextToken === "string" ? result.nextToken : null,
      prevToken: typeof result.prevToken === "string" ? result.prevToken : null,
    };
  }

  // Mutations forward to the daemon (§7.2); daemon agent-lifecycle events
  // drive the reactive refresh. `create` returns the full session projection
  // (widened in P2-12a) so the caller can upsert without a follow-up `agent.get`.
  async create(request: AgentCreateRequest): Promise<AgentSession> {
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
    if (request.model !== undefined) params.model = request.model;
    if (request.specialist !== undefined && request.specialist !== null) {
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
    // The daemon-assigned `agent.id` is the only way to address follow-up
    // sends/streams (no client id is forwarded). Fail loudly rather than let
    // normalizeAgent coerce a missing id into an empty-string session key.
    const rawId = (raw as Record<string, unknown>).id;
    if (typeof rawId !== "string" || rawId.length === 0) {
      throw new Error("agent.create response missing daemon-assigned agent.id");
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
  async editAndRegenerate(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
    content: string;
    model?: string;
  }): Promise<MutationResult> {
    // `agent.editAndRegenerate` (§5.5 catalog-parity extension) edits a past
    // user message and regenerates from that point. The daemon truncates the
    // transcript to just before the edited message and emits `agent:updated`
    // with `{ truncatedCount, remainingCount }`; the fresh turn then follows
    // the normal `agent:message` / `agent:stream:*` lifecycle. `model` is only
    // forwarded when the caller supplied it so the daemon sees an omitted
    // param rather than an explicit null it would reject.
    const rpcParams: Record<string, unknown> = {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      messageId: params.messageId,
      content: params.content,
    };
    if (params.model !== undefined) rpcParams.model = params.model;
    return runMutation("agent.editAndRegenerate", rpcParams);
  }
  async queue(
    agentId: string,
    message: string,
    options?: {
      imageBlocks?: ImageBlock[];
    },
  ): Promise<MutationResult> {
    // `agent.queueMessage` returns `{ success, queuedMessage, turnId }`
    // (§5.5); we surface `queuedMessage` on the MutationResult so callers can
    // render the queue position / id without an extra `agent.getQueue`
    // round-trip, plus the entry's turn-correlation id (monorepo#1057 —
    // top-level `turnId` preferred, `queuedMessage.turnId` as the fallback).
    // Optional `imageBlocks` only ride along when supplied so the daemon sees
    // an omitted param otherwise.
    try {
      const params: Record<string, unknown> = { agentId, content: message };
      if (options?.imageBlocks !== undefined) params.imageBlocks = options.imageBlocks;
      const result = await backendRequest<
        { queuedMessage?: QueuedMessage; turnId?: unknown } | undefined
      >("agent.queueMessage", params);
      const queuedMessage = result?.queuedMessage;
      const turnId =
        typeof result?.turnId === "string"
          ? result.turnId
          : typeof queuedMessage?.turnId === "string"
            ? queuedMessage.turnId
            : undefined;
      const mutation: MutationResult = { success: true };
      if (queuedMessage) mutation.queuedMessage = queuedMessage;
      if (turnId !== undefined) mutation.turnId = turnId;
      return mutation;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async editQueued(
    agentId: string,
    messageId: string,
    content: string,
    editing?: boolean,
  ): Promise<MutationResult> {
    // `agent.editQueuedMessage` (§5.5) returns `{ success, queuedMessage }`
    // like `agent.queueMessage`; surface `queuedMessage` so callers can render
    // the updated entry. The `editing` flag (STAB-27) holds the message during
    // edit — daemon drain skips held entries — and is only forwarded when the
    // caller supplied it so older daemons see an omitted param.
    try {
      const params: Record<string, unknown> = { agentId, messageId, content };
      if (editing !== undefined) params.editing = editing;
      const result = await backendRequest<{ queuedMessage?: QueuedMessage } | undefined>(
        "agent.editQueuedMessage",
        params,
      );
      const queuedMessage = result?.queuedMessage;
      return queuedMessage ? { success: true, queuedMessage } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async sendQueuedNow(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    // `agent.sendQueuedMessageNow` (§5.5) atomically dequeues the persisted
    // entry and delivers its content as an interrupt send. NOT idempotent:
    // a missing entry (already drained/removed) rejects with -32602, folded
    // into `{ success: false, error }` — callers surface it non-destructively
    // (the entry is gone; nothing to roll back). The delivered arm carries
    // `turnId` (the entry's preserved turn-correlation id — this path emits
    // NO `agent:queue:processing` event, the RPC response replaces it, §5.5),
    // surfaced on the MutationResult (monorepo#1057).
    try {
      const result = await backendRequest<{ turnId?: unknown } | undefined>(
        "agent.sendQueuedMessageNow",
        {
          agentId: params.agentId,
          workspaceId: params.workspaceId,
          messageId: params.messageId,
        },
      );
      return typeof result?.turnId === "string"
        ? { success: true, turnId: result.turnId }
        : { success: true };
    } catch (error) {
      // Same error shaping as `runMutation` (which this method bypassed to
      // extract `turnId`): fold JSON-RPC "Internal error" + `data.detail`
      // into an actionable message.
      return { success: false, error: mutationErrorMessage(error) };
    }
  }
  async getQueue(agentId: string): Promise<QueuedMessage[]> {
    // `agent.getQueue` (§5.5/§6.6) returns `{ success, queue }`; hand the
    // daemon's queue array through verbatim (incl. optional `messageMetadata`).
    // Errors propagate as rejections, like the other reads.
    const result = await backendRequest<{ queue?: QueuedMessage[] }>("agent.getQueue", {
      agentId,
    });
    return Array.isArray(result?.queue) ? result.queue : [];
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
  async cancelSubscriptions(params: {
    agentId: string;
    workspaceId: string;
    subscriptionId?: string;
    groupId?: string;
  }): Promise<MutationResult> {
    // `agent.cancelSubscriptions` (§5.5) takes `{ agentId, workspaceId }` plus
    // optional `subscriptionId` / `groupId` scoping. The optional keys are
    // omitted entirely when unset — the daemon rejects a present-but-non-string
    // id with `-32602` rather than coercing it into an unscoped cancel, so an
    // explicit `undefined` must never hit the wire. Scoped removals publish
    // `agent:subscriptions-changed` (§6.5), which reconciles the footer UI.
    const rpcParams: Record<string, unknown> = {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
    };
    if (params.subscriptionId !== undefined) rpcParams.subscriptionId = params.subscriptionId;
    if (params.groupId !== undefined) rpcParams.groupId = params.groupId;
    return runMutation("agent.cancelSubscriptions", rpcParams);
  }
  async dismissQuestions(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    // `agent.dismissQuestions` (§5.5) takes `{ agentId, workspaceId,
    // messageId }` (all required — workspace mismatch surfaces as NotFound)
    // and returns `{ success: true, dismissedQuestionsMessageId }`. The daemon
    // persists the marker in session metadata (survives reload), emits
    // `agent:updated`, and kicks the queue drain so messages held by the
    // question hold resume. Idempotent on the same messageId.
    return runMutation("agent.dismissQuestions", {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      messageId: params.messageId,
    });
  }
  async markSeen(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    // `agent.markSeen` (§5.5) takes `{ workspaceId, agentId, messageId }`
    // (all required — workspace mismatch surfaces as NotFound); the wire ack
    // is `{ success: true, lastSeenMessageId }`, folded by `runMutation` into
    // a plain `MutationResult`. The daemon persists the marker in session
    // metadata (survives reload) and emits `agent:updated` so all clients
    // converge on the advanced marker. Idempotent on the same messageId.
    // Transport / daemon errors fold into `{ success: false, error }` — the
    // fire-and-forget trigger never awaits this for UI flow.
    return runMutation("agent.markSeen", {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      messageId: params.messageId,
    });
  }
  async rename(
    agentId: string,
    name: string,
    _workspaceId?: string,
    options?: { skipIfExplicitlySet?: boolean },
  ): Promise<MutationResult> {
    // `agent.rename` (§5.5) takes `{ agentId, name }` (name non-empty) and
    // returns `{ success: true, name }`; an applied rename emits
    // `agent:renamed` (in AGENT_LIFECYCLE_EVENTS), which reconciles the list.
    // The optional `skipIfExplicitlySet` guard only rides along when a caller
    // opts in (automated renames such as the chief first-message rename); a
    // user-initiated rename omits it — a user rename always wins. workspaceId
    // is not part of the wire contract, so the seam's optional third argument
    // (kept for AgentsClient contract parity) stays off the wire.
    const params: Record<string, unknown> = { agentId, name };
    if (options?.skipIfExplicitlySet === true) params.skipIfExplicitlySet = true;
    return runMutation("agent.rename", params);
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
  ): Promise<{ ok: true; redriven?: boolean; turnId?: string } | { ok: false; error: string }> {
    // `agent.retry` redrives a failed agent spawn. Only valid when agent status
    // is `error`; returns `{ ok: false }` otherwise. On ok:true, `redriven`
    // reports whether a queued message existed and is being redriven (status
    // cleared to pending) or the queue was empty (status cleared to idle —
    // nothing to redrive). `turnId` (present only with redriven:true, §5.5)
    // is the redriven head entry's preserved turn-correlation id — the same
    // id the original send/enqueue RPC returned (monorepo#1057). Emits
    // agent:status-changed events.
    try {
      const result = await backendRequest<
        { ok?: unknown; redriven?: unknown; turnId?: unknown } | undefined
      >("agent.retry", { agentId, workspaceId });
      if (result?.ok !== true) {
        return { ok: false, error: "Agent not in error status" };
      }
      const redriven = typeof result.redriven === "boolean" ? result.redriven : undefined;
      const turnId = typeof result.turnId === "string" ? result.turnId : undefined;
      return turnId !== undefined ? { ok: true, redriven, turnId } : { ok: true, redriven };
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

  async listInterrupted(): Promise<import("../app-client").InterruptedAgent[]> {
    // `agent.listInterrupted` (wire contract in spec) returns agents interrupted by
    // daemon restart. Older daemons lacking this method throw -32601 (method not
    // found) — we silently return an empty array so the modal doesn't appear.
    try {
      const result = await backendRequest<{ agents?: unknown[] } | undefined>(
        "agent.listInterrupted",
        {},
      );
      const agents = Array.isArray(result?.agents) ? result.agents : [];
      return agents.map((raw) => {
        const a = raw as Record<string, unknown>;
        return {
          agentId: String(a.agentId ?? ""),
          workspaceId: String(a.workspaceId ?? ""),
          workspaceName: String(a.workspaceName ?? ""),
          agentName: String(a.agentName ?? ""),
          prevStatus: String(a.prevStatus ?? ""),
          interruptedAt: String(a.interruptedAt ?? ""),
        };
      });
    } catch (error) {
      // -32601 = method not found (older daemon). Fail silently per spec.
      if (
        error &&
        typeof error === "object" &&
        "rpcCode" in error &&
        error.rpcCode === -32601
      ) {
        return [];
      }
      throw error;
    }
  }

  async resolveInterrupted(params: {
    resume?: string[];
    abandon?: string[];
  }): Promise<import("../app-client").ResolveInterruptedResult> {
    // `agent.resolveInterrupted` resumes selected agents, abandons the rest. The
    // daemon is idempotent — calling with already-resolved IDs is safe.
    try {
      const result = await backendRequest<
        { resumed?: string[]; abandoned?: string[]; failed?: unknown[] } | undefined
      >("agent.resolveInterrupted", params);
      return {
        resumed: Array.isArray(result?.resumed) ? result.resumed : [],
        abandoned: Array.isArray(result?.abandoned) ? result.abandoned : [],
        failed: Array.isArray(result?.failed)
          ? result.failed.map((f) => {
              const obj = f as Record<string, unknown>;
              return {
                agentId: String(obj.agentId ?? ""),
                error: String(obj.error ?? ""),
              };
            })
          : [],
      };
    } catch (error) {
      // Transport/RPC errors propagate so callers can surface them.
      throw error;
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

  /**
   * Subscribe to agents across every workspace.
   *
   * Typed §6.9 channel: on liveState daemons one per-workspace
   * `agent.subscribe` (bare `{ workspaceId }` — the params shape that routes
   * to the collection channel rather than the deprecated `eventTypes` service
   * alias) is registered per id yielded by `subscribeWorkspaceIds` — the same
   * enumeration `fetchAll` flattens over. The channel carries `AgentLite`
   * entities; `agent:deleted` (the soft-hide-then-commit deletion flow's
   * convergence signal) arrives as a `removedIds` delta, which the reconciler
   * drops. Workspace add → a new channel registers and its snapshot merges
   * in; workspace delete → the channel unsubscribes and its agents are
   * evicted. While ANY workspace channel lacks a push-confirmed registration
   * the subscription stays legacy and refetches keep serving (the #775
   * safety net); daemons without liveState never register channels at all.
   * Every push entity flows through `normalizeAgent`, so the
   * `agentWorkspaceIndex` cache is primed exactly like the list/get paths.
   */
  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe {
    return createDeltaSubscription<AgentSession>({
      eventTypes: [...AGENT_LIFECYCLE_EVENTS],
      channel: {
        subscribeMethod: "agent.subscribe",
        unsubscribeMethod: "agent.unsubscribe",
        dynamic: {
          subscribeIds: subscribeWorkspaceIds,
          paramsForId: (id) => ({ workspaceId: id }),
        },
      },
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
