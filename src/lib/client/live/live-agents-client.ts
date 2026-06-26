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
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { isEventOneOf, listWorkspaceIds } from "./live-support";

const OK: MutationResult = { success: true };

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

  // Mutations are out of scope for this wave; accept as no-op successes so the
  // existing renderer flows are not regressed by the agents migration.
  async create(_request: AgentCreateRequest): Promise<MutationResult> {
    return OK;
  }
  async send(_agentId: string, _message: string): Promise<MutationResult> {
    return OK;
  }
  async queue(_agentId: string, _message: string): Promise<MutationResult> {
    return OK;
  }
  async setAvailability(_agentId: string, _available: boolean): Promise<MutationResult> {
    return OK;
  }
  async follow(_agentId: string, _follow: boolean): Promise<MutationResult> {
    return OK;
  }
  async lock(_agentId: string, _locked: boolean): Promise<MutationResult> {
    return OK;
  }

  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe {
    let disposed = false;
    let subscriptionId: string | undefined;

    const emit = () => {
      listWorkspaceIds()
        .then((ids) => Promise.all(ids.map((id) => this.list(id))))
        .then((perWorkspace) => {
          if (!disposed) handler(perWorkspace.flat());
        })
        .catch(() => {
          // Snapshot refresh failures are non-fatal for the subscription.
        });
    };

    emit();

    const off = onBackendNotification((n) => {
      if (isEventOneOf(n.method, n.params, AGENT_LIFECYCLE_EVENTS)) emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: [...AGENT_LIFECYCLE_EVENTS] })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we still serve the initial snapshot.
      });

    return () => {
      disposed = true;
      off();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}
