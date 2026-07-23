import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seams: the agent factory (create seam) and appClient.agents.get (the open
// path's on-demand session load) are stubbed so no IPC/daemon call happens. The
// service runs against the REAL configured store so the agent-creation
// middleware, the open path (openAgentTabRequested → app-layout navigation
// middleware → panel-layout reducer), and store hydration are exercised end to
// end. Each test asserts the trigger routes to the create seam AND opens a tab.
const createAgent = vi.fn();
vi.mock("$features/agent/services/agent-factory", () => ({
  agentFactory: { createAgent },
}));
vi.mock("$lib/client", () => ({
  appClient: { agents: { get: vi.fn(() => Promise.resolve(null as AgentSession | null)) } },
}));

import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import { loadWorkspaceNotesSucceeded } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { selectAllTabs } from "$store/renderer/slices/panel-layout/panel-layout-selectors";
import {
  createAgentRequested,
  createAgentFromConfigRequested,
  createAgentWithSpecialistRequested,
  runAgentForNoteRequested,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { agentSessionLaunchAgentRequested } from "$store/renderer/slices/agent-session/agent-session-slice";
import { CHIEF_WORKSPACE_ID, WorkspaceId } from "$shared/types/branded-ids";
import { createAgentTypeId } from "$shared/types/agent.types";
import type { Note, Workspace } from "$shared/types";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Warm the module cache for the factory + selector modules the service imports
 * dynamically, so the first handler invocation resolves them synchronously fast
 * and pending imports never outlive the test environment.
 */
async function warmDeps(): Promise<void> {
  await Promise.all([
    import("$features/agent/services/agent-factory"),
    import("$store/renderer/slices/workspace/workspace-selectors"),
    import("$store/renderer/slices/workspace-agents/workspace-agents-selectors"),
    import("$store/renderer/slices/model/model-selectors"),
    import("$store/renderer/slices/provider-settings/provider-settings-selectors"),
    import("$store/renderer/slices/specialists/specialists-selectors"),
    import("$store/renderer/slices/agent-session/agent-session-selectors"),
    import("$store/renderer/slices/workspace-notes/workspace-notes-selectors"),
  ]);
}

function seedWorkspace(wsId: string): void {
  appStore.dispatch(
    setWorkspaceEntity({ id: wsId, title: "WS", repositoryPath: "/tmp/repo" } as Workspace),
  );
}

function makeSession(id: string, wsId: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    backendSessionId: "backend-" + id,
    workspaceId: wsId,
    name: "Created Agent",
    status: AgentStatus.Idle,
    messages: [],
    model: "sonnet",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function agentTabs(wsId: string, agentId: string) {
  return selectAllTabs
    .select(appStore.state, wsId)
    .filter((t) => t.type === "agent" && t.agentId === agentId);
}

describe("agentCreationService (fake factory + client, real store)", () => {
  beforeAll(async () => {
    appStore.init();
    await warmDeps();
  });
  beforeEach(() => {
    createAgent.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("createAgentRequested routes to the factory (chat) and opens the tab", async () => {
    const WS = "ws-create";
    const AGENT = "agent-create";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: true, agent: makeSession(AGENT, WS), agentId: AGENT });

    appStore.dispatch(createAgentRequested(WS));
    await waitFor(() => agentTabs(WS, AGENT).length > 0);

    expect(createAgent).toHaveBeenCalledTimes(1);
    const [, config] = createAgent.mock.calls[0];
    expect(config).toMatchObject({ source: "keyboard-shortcut", agentType: "chat" });
    // Generated placeholder name ("Agent N") — flagged so the daemon keeps
    // the session self-renameable (wire `nameExplicitlySet`, PROTOCOL §5.5).
    expect(config.nameExplicitlySet).toBe(false);
    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("createAgentWithSpecialistRequested routes to the factory and opens the tab", async () => {
    const WS = "ws-spec";
    const AGENT = "agent-spec";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: true, agent: makeSession(AGENT, WS), agentId: AGENT });

    appStore.dispatch(createAgentWithSpecialistRequested(WS, "implementor"));
    await waitFor(() => agentTabs(WS, AGENT).length > 0);

    expect(createAgent).toHaveBeenCalledTimes(1);
    const [, config] = createAgent.mock.calls[0];
    expect(config).toMatchObject({ source: "specialist-picker", agentType: "chat" });
    expect(config.metadata).toMatchObject({ specialist: "implementor" });
    // Generated placeholder name ("<Specialist> N") — flagged as not
    // user-chosen so the agent can rename itself.
    expect(config.nameExplicitlySet).toBe(false);
    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("runAgentForNoteRequested creates a task-loop agent for the note and opens the tab", async () => {
    const WS = "ws-run";
    const AGENT = "agent-run";
    const NOTE = "note-run";
    seedWorkspace(WS);
    appStore.dispatch(
      loadWorkspaceNotesSucceeded(
        [WS],
        { [WS]: [{ id: NOTE, workspaceId: WS, title: "My Task", content: "Do it" } as Note] },
      ),
    );
    createAgent.mockResolvedValueOnce({ success: true, agent: makeSession(AGENT, WS), agentId: AGENT });

    appStore.dispatch(runAgentForNoteRequested(WS, NOTE, "My Task"));
    await waitFor(() => agentTabs(WS, AGENT).length > 0);

    expect(createAgent).toHaveBeenCalledTimes(1);
    const [, config] = createAgent.mock.calls[0];
    expect(config).toMatchObject({ source: "task-metadata-bar-run", agentType: "task-loop" });
    expect(config.metadata).toMatchObject({ taskNoteId: NOTE, specialist: "implementor" });
    expect(typeof config.initialMessage).toBe("string");
    // Name derived from the note title, not typed for the agent — flagged as
    // not user-chosen so the agent can rename itself.
    expect(config.nameExplicitlySet).toBe(false);
    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("ignores the trigger when the workspace is missing (no factory call)", async () => {
    appStore.dispatch(createAgentRequested("ws-missing"));
    await flush();
    await flush();
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("createAgentFromConfigRequested resolves with the created session and opens a tab when openAgent is true", async () => {
    const WS = "ws-from-config";
    const AGENT = "agent-from-config";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: true, agent: makeSession(AGENT, WS), agentId: AGENT });

    const action = createAgentFromConfigRequested(
      WS,
      { name: "Cfg", workspaceId: WorkspaceId(WS), agentType: createAgentTypeId("chat"), source: "test" },
      { openAgent: true },
    );
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.id).toBe(AGENT);
    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(agentTabs(WS, AGENT)).toHaveLength(1);
  });

  it("createAgentFromConfigRequested does NOT open a tab when openAgent is false", async () => {
    const WS = "ws-no-open";
    const AGENT = "agent-no-open";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: true, agent: makeSession(AGENT, WS), agentId: AGENT });

    const action = createAgentFromConfigRequested(
      WS,
      { name: "Silent", workspaceId: WorkspaceId(WS), agentType: createAgentTypeId("chat"), source: "test" },
      { openAgent: false },
    );
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.id).toBe(AGENT);
    expect(agentTabs(WS, AGENT)).toHaveLength(0);
  });

  it("createAgentFromConfigRequested rejects when the factory fails", async () => {
    const WS = "ws-config-fail";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: false, error: "boom" });

    const action = createAgentFromConfigRequested(
      WS,
      { name: "X", workspaceId: WorkspaceId(WS), agentType: createAgentTypeId("chat"), source: "test" },
    );
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow(/boom/);
  });

  it("createAgentFromConfigRequested rejects when the workspace is missing", async () => {
    const action = createAgentFromConfigRequested(
      "ws-missing-cfg",
      { name: "X", workspaceId: WorkspaceId("ws-missing-cfg"), agentType: createAgentTypeId("chat"), source: "test" },
    );
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow(/Workspace is not available/);
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("agentSessionLaunchAgentRequested resolves with the created session (chief workspace)", async () => {
    const AGENT = "agent-chief-launch";
    createAgent.mockResolvedValueOnce({
      success: true,
      agent: makeSession(AGENT, CHIEF_WORKSPACE_ID),
      agentId: AGENT,
    });

    const action = agentSessionLaunchAgentRequested(
      CHIEF_WORKSPACE_ID,
      { name: "Chief thread", agentType: createAgentTypeId("workspace"), source: "chief-card" },
      { openAgent: false },
    );
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.id).toBe(AGENT);
    expect(createAgent).toHaveBeenCalledTimes(1);
    const [, config] = createAgent.mock.calls[0];
    expect(config).toMatchObject({ agentType: "workspace", source: "chief-card" });
    // Chief thread is created with openAgent: false — no tab is opened.
    expect(agentTabs(CHIEF_WORKSPACE_ID, AGENT)).toHaveLength(0);
  });

  it("agentSessionLaunchAgentRequested rejects (with a clean error) on failure", async () => {
    const WS = "ws-launch-fail";
    seedWorkspace(WS);
    createAgent.mockResolvedValueOnce({ success: false, error: "nope" });

    const action = agentSessionLaunchAgentRequested(
      WS,
      { name: "Launch", agentType: createAgentTypeId("chat"), source: "test" },
    );
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow(/nope/);
  });
});
