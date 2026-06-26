import { describe, expect, it } from "vitest";
import { appClient } from "./index";
import {
  MOCK_AGENT_ID,
  mockAgents,
  mockChatHistory,
  mockGitStatus,
  mockSkills,
  mockSystemStatus,
  mockTokenUsage,
  mockWorkspaceEvents,
} from "./mock/fixtures";

// `appClient` is a LiveAppClient: the `workspaces` domain is backed by the live
// daemon (covered by the JSON-RPC client tests), while every other domain still
// delegates to the in-memory MockAppClient. These tests exercise the delegated
// (mock-backed) domains through the singleton seam.
describe("appClient seam (mock-delegated domains)", () => {
  it("resolves representative query stubs to deterministic fixtures", async () => {
    expect(await appClient.skills.list("ws-mock-1")).toEqual(mockSkills);
    expect(await appClient.git.status("ws-mock-1")).toEqual(mockGitStatus);
    expect(await appClient.system.status()).toEqual(mockSystemStatus);
  });

  it("resolves seeded agents & chat to deterministic fixtures", async () => {
    expect(await appClient.agents.list("ws-mock-1")).toEqual(mockAgents);
    expect(await appClient.agents.get(MOCK_AGENT_ID)).toEqual(mockAgents[0]);
    expect(await appClient.chat.history(MOCK_AGENT_ID)).toEqual(mockChatHistory[MOCK_AGENT_ID]);
    expect(await appClient.chat.tokenUsage(MOCK_AGENT_ID)).toEqual(mockTokenUsage[MOCK_AGENT_ID]);
  });

  it("resolves not-yet-seeded domains to empty collections", async () => {
    expect(await appClient.files.list("ws-mock-1")).toEqual([]);
    expect(await appClient.comments.list("note-mock-1")).toEqual([]);
  });

  it("subscribes to keyed domains and emits an initial snapshot", () => {
    const seen: unknown[] = [];
    const unsubscribe = appClient.events.subscribe("ws-mock-1", (snapshot) => seen.push(snapshot));

    expect(seen).toEqual([mockWorkspaceEvents]);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("accepts mutations as no-op successes", async () => {
    expect(await appClient.workspaces.setActive("ws-mock-1")).toEqual({ success: true });
    expect(await appClient.agents.send("agent-mock-1", "hi")).toEqual({ success: true });
  });
});
