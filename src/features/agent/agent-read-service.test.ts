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
import { selectAgentSession } from "$store/renderer/slices/agent-session/agent-session-selectors";
import { ensureAgentSession } from "./agent-read-service";

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
});
