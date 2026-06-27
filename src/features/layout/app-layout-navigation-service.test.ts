import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seam: appClient.agents.get is stubbed so dispatching openAgentTabRequested
// (which kicks off ensureAgentSessionLoaded) never hits the daemon. The service
// runs against the REAL configured store so the navigation middleware, the agent
// read middleware wiring, and the panel-layout reducer are exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    agents: {
      get: vi.fn(() => Promise.resolve(null as AgentSession | null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { openAgentTabRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import { bulkUpsertSessions } from "$store/renderer/slices/agent-session/agent-session-slice";
import { selectAllTabs, selectPanels } from "$store/renderer/slices/panel-layout/panel-layout-selectors";

const agentsApi = appClient.agents as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-nav-1",
    backendSessionId: null,
    workspaceId: "ws-nav",
    name: "Agent One",
    status: AgentStatus.Active,
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function agentTabs(wsId: string, agentId: string) {
  return selectAllTabs.select(appStore.state, wsId).filter((t) => t.type === "agent" && t.agentId === agentId);
}

describe("appLayoutNavigationService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    agentsApi.get.mockResolvedValue(null as never);
  });

  it("opens an agent tab and triggers a session load on openAgentTabRequested", async () => {
    const WS = "ws-nav-open";
    const AGENT = "agent-nav-open";

    appStore.dispatch(openAgentTabRequested(WS, { agentId: AGENT }));
    await flush();

    const tabs = agentTabs(WS, AGENT);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ type: "agent", agentId: AGENT, workspaceId: WS, closable: true });
    // ensureAgentSessionLoaded was dispatched and handled by the agent read middleware.
    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
  });

  it("focuses the existing tab on re-click instead of duplicating it", async () => {
    const WS = "ws-nav-dedup";
    const AGENT = "agent-nav-dedup";

    appStore.dispatch(openAgentTabRequested(WS, { agentId: AGENT }));
    appStore.dispatch(openAgentTabRequested(WS, { agentId: AGENT }));
    await flush();

    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("opens the agent tab in an adjacent panel when requested", async () => {
    const WS = "ws-nav-adjacent";
    const AGENT = "agent-nav-adjacent";

    appStore.dispatch(openAgentTabRequested(WS, { agentId: AGENT, openInAdjacentPanel: true }));
    await flush();

    const panels = selectPanels.select(appStore.state, WS);
    expect(Object.keys(panels).length).toBeGreaterThanOrEqual(2);
    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("titles the tab from the already-loaded agent session name", async () => {
    const WS = "ws-nav-title";
    const AGENT = "agent-nav-title";
    appStore.dispatch(bulkUpsertSessions([makeSession({ id: AGENT, workspaceId: WS, name: "Reviewer" })]));

    appStore.dispatch(openAgentTabRequested(WS, { agentId: AGENT }));
    await flush();

    expect(agentTabs(WS, AGENT)[0]?.title).toBe("Reviewer");
  });

  it("ignores the trigger when the agentId is missing", async () => {
    const WS = "ws-nav-noop";

    appStore.dispatch(openAgentTabRequested(WS, { agentId: "" }));
    await flush();

    expect(selectAllTabs.select(appStore.state, WS).filter((t) => t.type === "agent")).toHaveLength(0);
    expect(agentsApi.get).not.toHaveBeenCalled();
  });
});
