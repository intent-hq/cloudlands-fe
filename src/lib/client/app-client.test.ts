import { describe, expect, it } from "vitest";
import { appClient } from "./index";
import {
  MOCK_AGENT_ID,
  mockChatHistory,
  mockSkills,
  mockSystemStatus,
  mockTokenUsage,
} from "./mock/fixtures";

// `appClient` is a LiveAppClient. The `workspaces`, `agents`, `notes`, `tasks`,
// `comments`, `git`, `files`, `terminals`, `settings`, `specialists`,
// `integrations`, `scripts`, `setupScripts`, and `events` domains are backed by
// the live daemon (covered by the live-client tests), while the remaining
// domains (`chat`, `skills`, `models`, `browser`, `system`) still delegate to
// the in-memory MockAppClient. These tests exercise those mock-delegated
// domains through the singleton seam.
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
    const unsubscribe = appClient.chat.subscribe(MOCK_AGENT_ID, (snapshot) => seen.push(snapshot));

    expect(seen).toEqual([mockChatHistory[MOCK_AGENT_ID]]);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("accepts FE-only setUserPreferences as a no-op success on the live settings client", async () => {
    // UserPreferences are FE-only per PROTOCOL §5.12 — the live client accepts
    // the call but does not forward it to the daemon.
    expect(await appClient.settings.setUserPreferences({})).toEqual({ success: true });
  });
});
