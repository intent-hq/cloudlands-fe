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
  it("maps agent:started to an info row carrying agent identity out-of-band", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("agent:started", { agentId: "agent-1", agentName: "Implementor" }),
    );
    expect(entry).toEqual({
      id: "evt-agent:started",
      ts: "2026-07-30T12:00:00.000Z",
      colorClass: "info",
      source: WS_ID,
      kind: "agent:started",
      text: "",
      agentId: "agent-1",
      agentName: "Implementor",
    });
  });

  it("never leaks the raw agent UUID into text when agentName is absent", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("agent:started", { agentId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(entry?.text).toBe("");
    expect(entry?.agentId).toBe("22222222-2222-4222-8222-222222222222");
    expect(entry?.agentName).toBeUndefined();
  });

  it("maps agent:failed { agentId, error, turnId? } to an err row without the id", () => {
    const entry = mapEventToFeedEntry(
      wireEvent("agent:failed", { agentId: "agent-1", error: "spawn failed", turnId: "t-1" }),
    );
    expect(entry).toMatchObject({ colorClass: "err", text: "spawn failed", agentId: "agent-1" });
  });

  it("colors agent:status-changed by target status and carries it out-of-band", () => {
    // The raw status word never lands in `text` — the chip label derives from
    // the out-of-band `agentStatus` (AGENT RUNNING / IDLE / FAILED …).
    const failed = mapEventToFeedEntry(
      wireEvent("agent:status-changed", {
        agentId: "agent-1",
        previousStatus: "responding",
        status: "failed",
      }),
    );
    expect(failed).toMatchObject({
      colorClass: "err",
      text: "",
      agentId: "agent-1",
      agentStatus: "failed",
    });

    // Canonical table: WAITING is not running work — grey, not yellow.
    const waiting = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "waiting" }),
    );
    expect(waiting).toMatchObject({ colorClass: "idle", text: "", agentStatus: "waiting" });

    const completed = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "completed" }),
    );
    expect(completed).toMatchObject({ colorClass: "ok", text: "", agentStatus: "completed" });

    // RUNNING is green (the same info/live token the cards pulse).
    const running = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "active" }),
    );
    expect(running).toMatchObject({ colorClass: "info", agentStatus: "active" });
  });

  it("suppresses went-idle agent:status-changed rows (duplicate of agent:idle)", () => {
    // The daemon emits agent:idle AND agent:status-changed → idle at the same
    // instant; both would chip "AGENT IDLE" in different colors. Only the
    // canonical agent:idle renders.
    expect(
      mapEventToFeedEntry(
        wireEvent("agent:status-changed", {
          agentId: "agent-1",
          previousStatus: "responding",
          status: "idle",
        }),
      ),
    ).toBeNull();
    // Unknown statuses bucket idle too — same AGENT IDLE chip, same suppression.
    expect(
      mapEventToFeedEntry(
        wireEvent("agent:status-changed", { agentId: "agent-1", status: "someday-status" }),
      ),
    ).toBeNull();
    // The canonical agent:idle row still renders — GREY (canonical table:
    // IDLE is grey, never green).
    expect(
      mapEventToFeedEntry(wireEvent("agent:idle", { agentId: "agent-1", agentName: "Coordinator" })),
    ).toMatchObject({ colorClass: "idle", kind: "agent:idle", agentId: "agent-1" });
    // Non-idle transitions (running / waiting / done / failed chips) keep rendering.
    expect(
      mapEventToFeedEntry(wireEvent("agent:status-changed", { agentId: "agent-1", status: "active" })),
    ).not.toBeNull();
    expect(
      mapEventToFeedEntry(wireEvent("agent:status-changed", { agentId: "agent-1", status: "pending" })),
    ).not.toBeNull();
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
    // The raw wire value never renders as text — the row carries it
    // out-of-band (`displayStatus`) for the localized card-state label.
    expect(merged).toMatchObject({ colorClass: "ok", text: "", displayStatus: "pr_merged" });

    const open = mapEventToFeedEntry(
      wireEvent("workspace:displayStatus-changed", { workspaceId: WS_ID, displayStatus: "pr_open" }),
    );
    expect(open).toMatchObject({ colorClass: "accent", displayStatus: "pr_open" });

    // Other kinds never carry the field.
    const other = mapEventToFeedEntry(
      wireEvent("agent:status-changed", { agentId: "agent-1", status: "active" }),
    );
    expect(other?.displayStatus).toBeUndefined();
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

    // `unread` (the main app's blue dot) is suppressed entirely — it would
    // double-post with the `agent:idle` the daemon emits at the same turn end.
    const unread = mapEventToFeedEntry(
      wireEvent("workspace:attention-changed", { workspaceId: WS_ID, attention: "unread" }),
    );
    expect(unread).toBeNull();
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

  it("never renders agent:deleted (deletions are roster-only, no feed row)", () => {
    expect(
      mapEventToFeedEntry(
        wireEvent("agent:deleted", { agentId: "agent-1", agentName: "Implementor" }),
      ),
    ).toBeNull();
    // The other lifecycle kinds keep rendering.
    for (const type of ["agent:started", "agent:completed", "agent:idle"]) {
      expect(mapEventToFeedEntry(wireEvent(type, { agentId: "agent-1" }))).toMatchObject({
        kind: type,
      });
    }
  });

  it("never renders agent:created (creation is feed noise — the AGENT DELEGATED row lands on first start)", () => {
    expect(
      mapEventToFeedEntry(wireEvent("agent:created", { agentId: "agent-1", name: "Implementor" })),
    ).toBeNull();
  });

  it("returns null when envelope identity fields are missing", () => {
    const noId = wireEvent("agent:started", { agentName: "X" });
    (noId as { id?: string }).id = undefined;
    expect(mapEventToFeedEntry(noId)).toBeNull();
  });
});
