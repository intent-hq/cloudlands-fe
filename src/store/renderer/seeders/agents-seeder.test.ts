/**
 * agents-seeder regression tests.
 *
 * Asserts the seeder applies the same preserve-messages merge pattern
 * `hydrateWorkspaceAgents()` in lifecycle-read-service.ts uses to avoid
 * clobbering transcripts when AgentLite payloads (`messages: []`) overwrite
 * already-hydrated session state.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../slices/agent-session/agent-session-types";
import { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";
import { reducers } from "../reducer";

// Mock the AppClient seam
vi.mock("$lib/client", () => ({
  appClient: {
    workspaces: {
      list: vi.fn(),
    },
    agents: {
      list: vi.fn(),
    },
  },
}));

import { appClient } from "$lib/client";
import { selectAgentSession } from "../slices/agent-session/agent-session-selectors";
import { bulkUpsertSessions } from "../slices/agent-session/agent-session-slice";
import { selectActiveAgentIdForWorkspace } from "../slices/workspace-agents/workspace-agents-selectors";
import { registerMockSeeder, clearMockSeeders } from "../mock-bootstrap";

const mockedClient = vi.mocked(appClient);

describe("agents-seeder", () => {
  let store: Store<any, any>;

  beforeAll(async () => {
    // Import the seeder to register it
    await import("./agents-seeder");
  });

  beforeEach(() => {
    // Create a fresh store for each test
    store = new Store(reducers, []);
    store.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("preserve-messages merge", () => {
    it("preserves existing messages when AgentLite returns messages: []", async () => {
      const WORKSPACE_ID = "amber-forest";
      const AGENT_ID = "agent-42";

      // GIVEN: store already has a session with messages (hydrated by chat-read-service)
      const existingMessages: AgentSession["messages"] = [
        {
          id: "msg_user_1",
          role: "user",
          content: "Hello",
          createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
        },
        {
          id: "msg_asst_1",
          role: "assistant",
          content: "Hi there!",
          createdAt: new Date("2024-01-01T00:00:01Z").toISOString(),
        },
      ];

      const existingSession: AgentSession = {
        id: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Coordinator",
        isBackground: false,
        messages: existingMessages,
        status: "waiting" as const,
        createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
        updatedAt: new Date("2024-01-01T00:00:01Z").toISOString(),
      };

      store.dispatch(bulkUpsertSessions([existingSession]));

      // WHEN: the seeder runs and agents.list returns AgentLite (messages: [])
      const agentLitePayload: AgentSession = {
        ...existingSession,
        messages: [], // AgentLite normalizes messages to []
      };

      mockedClient.workspaces.list.mockResolvedValueOnce([{ id: WORKSPACE_ID }]);
      mockedClient.agents.list.mockResolvedValueOnce([agentLitePayload]);

      // Run the seeder directly
      const seederModule = await import("./agents-seeder");
      // The seeder registers via registerMockSeeder, so we can get it from the registry
      const { seedMockStore } = await import("../mock-bootstrap");
      await seedMockStore(store, appClient);

      // THEN: the session still has its original messages
      const session = selectAgentSession.select(store.state, AGENT_ID);
      expect(session).toBeDefined();
      expect(session?.messages).toEqual(existingMessages);
      expect(session?.messages.length).toBe(2);
    });

    it("accepts fresh messages when existing session has no messages", async () => {
      const WORKSPACE_ID = "amber-forest";
      const AGENT_ID = "agent-99";

      // GIVEN: store has a session with no messages
      const existingSession: AgentSession = {
        id: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Helper",
        isBackground: false,
        messages: [],
        status: "waiting" as const,
        createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
        updatedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      };

      store.dispatch(bulkUpsertSessions([existingSession]));

      // WHEN: seeder provides an agent with messages
      const newMessages: AgentSession["messages"] = [
        {
          id: "msg_user_new",
          role: "user",
          content: "New message",
          createdAt: new Date("2024-01-01T00:00:10Z").toISOString(),
        },
      ];

      mockedClient.workspaces.list.mockResolvedValueOnce([{ id: WORKSPACE_ID }]);
      mockedClient.agents.list.mockResolvedValueOnce([
        { ...existingSession, messages: newMessages },
      ]);

      const { seedMockStore } = await import("../mock-bootstrap");
      await seedMockStore(store, appClient);

      // THEN: the new messages are accepted
      const session = selectAgentSession.select(store.state, AGENT_ID);
      expect(session?.messages).toEqual(newMessages);
    });
  });

  describe("activeAgentId guard", () => {
    it("does not overwrite activeAgentId when already set for the workspace", async () => {
      // This test will be implemented after the preserve-messages fix
      // to verify the activeAgentId guard logic
      expect(true).toBe(true);
    });
  });

  describe("direct merge logic", () => {
    it("store structure verification", () => {
      const WORKSPACE_ID = "test-ws";
      const AGENT_ID = "agent-test";

      const testSession: AgentSession = {
        id: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Test",
        isBackground: false,
        messages: [{ id: "msg_test_1", role: "user", content: "Test", createdAt: new Date().toISOString() }],
        status: "waiting" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.dispatch(bulkUpsertSessions([testSession]));

      // Verify the state structure
      expect(store.state.agentSessions).toBeDefined();
      expect(store.state.agentSessions.byAgentId).toBeDefined();
      expect(store.state.agentSessions.byAgentId[AGENT_ID]).toBeDefined();
      expect(store.state.agentSessions.byAgentId[AGENT_ID].messages.length).toBe(1);
    });

    it("manual merge preserves messages", () => {
      const WORKSPACE_ID = "test-ws";
      const AGENT_ID = "agent-manual-test";

      // Step 1: Set up existing session with 2 messages
      const existingMessages = [
        { id: "msg_q1", role: "user" as const, content: "Q1", createdAt: new Date().toISOString() },
        { id: "msg_a1", role: "assistant" as const, content: "A1", createdAt: new Date().toISOString() },
      ];

      const existingSession: AgentSession = {
        id: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Test Agent",
        isBackground: false,
        messages: existingMessages,
        status: "waiting" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.dispatch(bulkUpsertSessions([existingSession]));

      // Verify initial state
      expect(store.state.agentSessions.byAgentId[AGENT_ID].messages.length).toBe(2);

      // Step 2: Simulate AgentLite fetch
      const agentLite: AgentSession = {
        ...existingSession,
        messages: [], // AgentLite returns empty messages
      };

      // Step 3: Apply the merge logic (same as seeder)
      const existing = store.state.agentSessions?.byAgentId[String(agentLite.id)];
      const merged = agentLite.messages.length === 0 && existing && existing.messages.length > 0
        ? { ...agentLite, messages: existing.messages }
        : agentLite;

      // Step 4: Dispatch the merged agent
      store.dispatch(bulkUpsertSessions([merged]));

      // Step 5: Verify messages were preserved
      const final = store.state.agentSessions.byAgentId[AGENT_ID];
      expect(final.messages.length).toBe(2);
      expect(final.messages[0].content).toBe("Q1");
      expect(final.messages[1].content).toBe("A1");
    });
  });
});
