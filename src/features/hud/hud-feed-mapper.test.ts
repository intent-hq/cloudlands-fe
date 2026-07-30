import { describe, expect, it } from "vitest";
import type { WorkspaceEvent } from "$features/events/types";
import { mapEventToFeedEntry } from "./hud-feed-mapper";

const WS_ID = "11111111-1111-4111-8111-111111111111";

/** PROTOCOL §6.3 event envelope: exactly type/workspaceId/id/timestamp/actor/data. */
function wireEvent(type: string, data: Record<string, unknown>): WorkspaceEvent {
  return {
    type,
    workspaceId: WS_ID,
    id: `evt-${type}`,
    timestamp: "2026-07-30T12:00:00.000Z",
    actor: { type: "system" },
    data,
  } as WorkspaceEvent;
}

describe("mapEventToFeedEntry (PROTOCOL §6.3/§6.5-shaped payloads)", () => {
  it("maps agent:started to an info row carrying the agent name", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("agent:started", { agentId: "agent-1", agentName: "Implementor" }),
    );
    expect(entry).toEqual({
      id: "evt-agent:started",
      ts: "2026-07-30T12:00:00.000Z",
      colorClass: "info",
      source: WS_ID,
      kind: "agent:started",
      text: "Implementor",
    });
  });

  it("maps agent:failed { agentId, error, turnId? } to an err row", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("agent:failed", { agentId: "agent-1", error: "spawn failed", turnId: "t-1" }),
    );
    expect(entry).toMatchObject({ colorClass: "err", text: "agent-1: spawn failed" });
  });

  it("colors agent:status-changed by target status", () => {
    const failed = mapEventToFeedEntry(
      wireEvent("agent:status-changed", {
        agentId: "agent-1",
        previousStatus: "responding",
        status: "failed",
      }),
    );
    expect(failed).toMatchObject({ colorClass: "err", text: "agent-1 → failed" });

    const waiting = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "waiting" }),
    );
    expect(waiting).toMatchObject({ colorClass: "warn" });

    const completed = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "completed" }),
    );
    expect(completed).toMatchObject({ colorClass: "ok" });
  });

  it("maps task:status-changed with noteTitle → newStatus, ok when complete", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("task:status-changed", {
        noteId: "note-1",
        noteTitle: "Ship HUD",
        previousStatus: "in_progress",
        newStatus: "complete",
        changedAt: "2026-07-30T12:00:00.000Z",
      }),
    );
    expect(entry).toMatchObject({ colorClass: "ok", text: "Ship HUD → complete" });
  });

  it("maps workspace:displayStatus-changed { workspaceId, displayStatus } (§6.5)", () => {
    const merged = mapEventToFeedEntry(
      wireEvent("workspace:displayStatus-changed", {
        workspaceId: WS_ID,
        displayStatus: "pr_merged",
      }),
    );
    expect(merged).toMatchObject({ colorClass: "ok", text: "pr_merged" });

    const open = mapEventToFeedEntry(
      wireEvent("workspace:displayStatus-changed", { workspaceId: WS_ID, displayStatus: "pr_open" }),
    );
    expect(open).toMatchObject({ colorClass: "accent" });
  });

  it("maps workspace:attention-changed to warn when raised, info when cleared", () => {
    const raised = mapEventToFeedEntry(
      wireEvent("workspace:attention-changed", { workspaceId: WS_ID, attention: "review_required" }),
    );
    expect(raised).toMatchObject({ colorClass: "warn", text: "review_required" });

    const cleared = mapEventToFeedEntry(
      wireEvent("workspace:attention-changed", { workspaceId: WS_ID, attention: "none" }),
    );
    expect(cleared).toMatchObject({ colorClass: "info", text: "none" });
  });

  it("maps pr:updated { prNumber, prStatus } to an accent row (§6.5 pr family)", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("pr:updated", {
        workspaceId: WS_ID,
        prNumber: 42,
        prStatus: "merged",
        activePullRequest: {},
        pullRequests: [],
      }),
    );
    expect(entry).toMatchObject({ colorClass: "accent", text: "#42 merged" });
  });

  it("maps git:commit { operation, commit, message } to its message (§6.5 git family)", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("git:commit", {
        workspaceId: WS_ID,
        operation: "commit",
        commit: "abc1234",
        message: "feat: hud data layer",
        files: ["a.ts"],
      }),
    );
    expect(entry).toMatchObject({ colorClass: "info", text: "feat: hud data layer" });
  });

  it("returns null for non-feed event types", () => {
    expect(mapEventToFeedEntry(wireEvent("note:updated", { noteId: "spec" }))).toBeNull();
    expect(mapEventToFeedEntry(wireEvent("agent:stream:chunk", { agentId: "a" }))).toBeNull();
  });

  it("returns null when envelope identity fields are missing", () => {
    const noId = wireEvent("agent:started", { agentName: "X" });
    (noId as { id?: string }).id = undefined;
    expect(mapEventToFeedEntry(noId)).toBeNull();
  });
});
