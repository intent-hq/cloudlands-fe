import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seam: appClient.agents.get is stubbed so no daemon call (and never a
// mutation) happens. The service runs against the REAL configured store so the
// ensureAgentSessionLoaded middleware, refresh dedup, and upsert hydration are
// exercised end to end. READ-ONLY: only `get` is stubbed.
vi.mock("$lib/client", () => ({
  appClient: {
    agents: {
      get: vi.fn(() => Promise.resolve(null as AgentSession | null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { ensureAgentSessionLoaded } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { bulkUpsertSessions } from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  selectAgentMessages,
  selectAgentSession,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import type { AgentMessage } from "$shared/types";
import { ensureAgentSession } from "./agent-read-service";
import {
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from "./utils/pending-agent-deletions";

const agentsApi = appClient.agents as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-agent-read-1";
const AGENT = "agent-read-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    backendSessionId: null,
    workspaceId: WS,
    name: "Agent One",
    status: AgentStatus.Active,
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

describe("agentReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    agentsApi.get.mockResolvedValue(null as never);
  });

  it("ensureAgentSession fetches via the seam and hydrates the store", async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession({ name: "fetched" }) as never);

    await ensureAgentSession(AGENT);

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
    expect(selectAgentSession.select(appStore.state, AGENT)?.name).toBe("fetched");
  });

  it("leaves any prior session intact when the read fails", async () => {
    const agentId = "agent-read-prior";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: "prior" }) as never);
    await ensureAgentSession(agentId);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe("prior");

    agentsApi.get.mockRejectedValueOnce(new Error("boom") as never);
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe("prior");
  });

  // Regression: with a soft-hidden deletion pending, the daemon still returns
  // the agent from `agent.get`, so an `agent:created`/`agent:updated`-driven
  // ensureAgentSession refetch used to resurrect the deleted session.
  it("is a no-op while a soft-hidden deletion is pending for the agent", async () => {
    const agentId = "agent-read-pending-del";
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession({ id: agentId }),
      timer: null,
    });
    try {
      await ensureAgentSession(agentId);
      expect(agentsApi.get).not.toHaveBeenCalled();
      expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    } finally {
      removePendingAgentDeletion(agentId);
    }

    // Once the pending entry is gone (undo or commit), loads work again.
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: "revived" }) as never);
    await ensureAgentSession(agentId);
    expect(agentsApi.get).toHaveBeenCalledWith(agentId);
  });

  it("coalesces concurrent loads for the same agent into one fetch", async () => {
    agentsApi.get.mockResolvedValue(makeSession({ name: "shared" }) as never);

    await Promise.all([
      ensureAgentSession(AGENT),
      ensureAgentSession(AGENT),
      ensureAgentSession(AGENT),
    ]);

    expect(agentsApi.get).toHaveBeenCalledTimes(1);
  });

  it("dispatching ensureAgentSessionLoaded triggers a load (middleware wiring)", async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession({ name: "via-action" }) as never);

    appStore.dispatch(ensureAgentSessionLoaded(WS, AGENT));
    await flush();

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
    expect(selectAgentSession.select(appStore.state, AGENT)?.name).toBe("via-action");
  });

  it("rapid ensureAgentSessionLoaded dispatches dedupe to one fetch", async () => {
    agentsApi.get.mockResolvedValue(makeSession({ name: "deduped" }) as never);

    appStore.dispatch(ensureAgentSessionLoaded(WS, AGENT));
    appStore.dispatch(ensureAgentSessionLoaded(WS, AGENT));
    await flush();

    expect(agentsApi.get).toHaveBeenCalledTimes(1);
  });

  // Regression: `agent.get` returns AgentLite (PROTOCOL §5.5) — session
  // metadata + message COUNTS, not the retained transcript. Dispatching that
  // response as-is used to clobber a transcript that `chat-read-service`
  // hydrated via `agent.getConversation`, so the initial user message
  // (seq 0) — and any user follow-ups — disappeared the moment any AgentCard
  // / hover surface dispatched `ensureAgentSessionLoaded`. This service must
  // now preserve the existing transcript on this metadata-only refresh.
  it("does not clobber the existing transcript when agent.get returns no messages", async () => {
    const agentId = "agent-transcript-preserve";
    const existingMessages: AgentMessage[] = [
      {
        id: "019f3d27-user-seq0",
        role: "user",
        timestamp: "2026-07-07T15:17:03.908Z",
        contentBlocks: [{ type: "text", text: "describe the repo" }],
      },
      {
        id: "019f3d27-asst-seq1",
        role: "assistant",
        timestamp: "2026-07-07T15:17:04.100Z",
        contentBlocks: [{ type: "text", text: "here is the repo description" }],
      },
    ];
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ id: agentId, name: "seeded", messages: existingMessages }),
      ]),
    );
    expect(selectAgentMessages.select(appStore.state, agentId).length).toBe(2);

    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, name: "refreshed", messages: [] }) as never,
    );
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe("refreshed");
    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored.map((m) => m.id)).toEqual([
      "019f3d27-user-seq0",
      "019f3d27-asst-seq1",
    ]);
    expect(stored[0].role).toBe("user");
  });

  // Regression: ensureAgentSession must preserve existing messages even when
  // the existing messages array exists but is empty (e.g., during the window
  // between session creation and transcript hydration), because agent.get
  // always returns AgentLite (messages normalized to []).
  it("preserves existing messages array even when empty", async () => {
    const agentId = "agent-preserve-empty";
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ id: agentId, name: "initial", messages: [] })]),
    );
    expect(selectAgentMessages.select(appStore.state, agentId).length).toBe(0);

    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, name: "refreshed", messages: [] }) as never,
    );
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe("refreshed");
    // Empty array should be preserved (not replaced with a different empty array)
    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored).toEqual([]);
  });
});
