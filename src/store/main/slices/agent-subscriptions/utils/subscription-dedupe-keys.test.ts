import { describe, expect, it } from "vitest";
import {
  buildSweepCatchUpSeenKey,
  buildWorkspaceScopedGroupKey,
  buildWorkspaceScopedSubscriptionKey,
  isKeyForWorkspaceSubscription,
  parseSweepCatchUpSeenKey,
  parseWorkspaceScopedGroupKey,
  parseWorkspaceScopedSubscriptionKey,
} from "./subscription-dedupe-keys";

describe("subscription dedupe keys", () => {
  it("round-trips workspace-scoped subscription keys", () => {
    const key = buildWorkspaceScopedSubscriptionKey("ws-1", "sub-1");

    expect(parseWorkspaceScopedSubscriptionKey(key)).toEqual({
      workspaceId: "ws-1",
      subscriptionId: "sub-1",
    });
  });

  it("parses sweep catch-up keys without accepting them as subscription keys", () => {
    const key = buildSweepCatchUpSeenKey("ws-1", "sub-1", "agent-1", "agent:idle");

    expect(parseSweepCatchUpSeenKey(key)).toEqual({
      workspaceId: "ws-1",
      subscriptionId: "sub-1",
      actorId: "agent-1",
      eventType: "agent:idle",
    });
    expect(parseWorkspaceScopedSubscriptionKey(key)).toBeNull();
  });

  it("matches exact and extended keys for one workspace subscription only", () => {
    const exactKey = buildWorkspaceScopedSubscriptionKey("ws-1", "sub-1");
    const extendedKey = buildSweepCatchUpSeenKey("ws-1", "sub-1", "agent-1", "agent:idle");
    const otherWorkspaceKey = buildSweepCatchUpSeenKey("ws-2", "sub-1", "agent-1", "agent:idle");

    expect(isKeyForWorkspaceSubscription(exactKey, "ws-1", "sub-1")).toBe(true);
    expect(isKeyForWorkspaceSubscription(extendedKey, "ws-1", "sub-1")).toBe(true);
    expect(isKeyForWorkspaceSubscription(otherWorkspaceKey, "ws-1", "sub-1")).toBe(false);
  });

  it("round-trips workspace-scoped group keys and rejects malformed legacy keys", () => {
    const key = buildWorkspaceScopedGroupKey("ws-1", "group-1");

    expect(parseWorkspaceScopedGroupKey(key)).toEqual({ workspaceId: "ws-1", groupId: "group-1" });
    expect(parseWorkspaceScopedGroupKey("group-1")).toBeNull();
    expect(parseSweepCatchUpSeenKey("sub-1:agent-1:agent:idle")).toBeNull();
  });
});