import { describe, expect, it } from "vitest";
import { appClient } from "./index";
import {
  MOCK_AGENT_ID,
  mockChatHistory,
  mockSkills,
  mockSystemStatus,
  mockTokenUsage,
  mockWorkspaceEvents,
} from "./mock/fixtures";

// `appClient` is a LiveAppClient. The `workspaces`, `agents`, `notes`, `tasks`,
// `comments`, `git`, and `files` domains are backed by the live daemon (covered
// by the live-client tests), while the remaining domains still delegate to the
// in-memory MockAppClient. These tests exercise those mock-delegated domains
// through the singleton seam.
describe("appClient seam (mock-delegated domains)", () => {
  it("resolves representative query stubs to deterministic fixtures", async () => {
    expect(await appClient.skills.list("ws-mock-1")).toEqual(mockSkills);
    expect(await appClient.system.status()).toEqual(mockSystemStatus);
  });

  it("resolves seeded chat to deterministic fixtures", async () => {
    expect(await appClient.chat.history(MOCK_AGENT_ID)).toEqual(mockChatHistory[MOCK_AGENT_ID]);
    expect(await appClient.chat.tokenUsage(MOCK_AGENT_ID)).toEqual(mockTokenUsage[MOCK_AGENT_ID]);
  });

  it("subscribes to keyed domains and emits an initial snapshot", () => {
    const seen: unknown[] = [];
    const unsubscribe = appClient.events.subscribe("ws-mock-1", (snapshot) => seen.push(snapshot));

    expect(seen).toEqual([mockWorkspaceEvents]);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("accepts mock-delegated mutations as no-op successes", async () => {
    expect(await appClient.settings.setUserPreferences({})).toEqual({ success: true });
    expect(await appClient.terminals.create("ws-mock-1")).toEqual({ success: true });
  });
});
