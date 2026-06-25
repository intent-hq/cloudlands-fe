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
  mockWorkspaces,
} from "./mock/fixtures";

describe("appClient (MockAppClient seam)", () => {
  it("resolves representative query stubs to deterministic fixtures", async () => {
    expect(await appClient.workspaces.list()).toEqual(mockWorkspaces);
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

  it("emits the initial snapshot synchronously on subscribe and returns a disposer", () => {
    const seen: unknown[] = [];
    const unsubscribe = appClient.workspaces.subscribe((snapshot) => seen.push(snapshot));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(mockWorkspaces);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("subscribes to keyed domains and emits an initial snapshot", () => {
    const seen: unknown[] = [];
    const unsubscribe = appClient.events.subscribe("ws-mock-1", (snapshot) => seen.push(snapshot));

    expect(seen).toEqual([[]]);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("accepts mutations as no-op successes", async () => {
    expect(await appClient.workspaces.setActive("ws-mock-1")).toEqual({ success: true });
    expect(await appClient.agents.send("agent-mock-1", "hi")).toEqual({ success: true });
  });
});
