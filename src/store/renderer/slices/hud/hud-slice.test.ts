import { describe, expect, it } from "vitest";
import {
  HUD_FEED_LIMIT,
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudReducer,
  hudSystemStatusReceived,
  hudUsageFailed,
  hudUsageLoaded,
  initialState,
  type HudFeedEntry,
  type HudState,
} from "./hud-slice";

function makeEntry(id: string, overrides: Partial<HudFeedEntry> = {}): HudFeedEntry {
  return {
    id,
    ts: "2026-07-30T00:00:00.000Z",
    colorClass: "info",
    source: "ws-1",
    kind: "agent:started",
    text: "Implementor",
    ...overrides,
  };
}

function activeState(): HudState {
  return hudReducer(initialState, hudActivated());
}

describe("hud-slice reducer", () => {
  it("starts inactive with an empty feed", () => {
    expect(initialState.active).toBe(false);
    expect(initialState.feed).toEqual([]);
    expect(initialState.usage).toBeNull();
    expect(initialState.system.online).toBe(false);
  });

  it("hudActivated resets to a clean active slate (live-only feed, no backfill)", () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-1")));
    state = hudReducer(state, hudActivated());
    expect(state.active).toBe(true);
    expect(state.feed).toEqual([]);
  });

  it("hudDeactivated returns to the initial state", () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-1")));
    state = hudReducer(state, hudDeactivated());
    expect(state).toEqual(initialState);
  });

  it("prepends feed entries newest-first while active", () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-1")));
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-2")));
    expect(state.feed.map((e) => e.id)).toEqual(["evt-2", "evt-1"]);
  });

  it("ignores feed entries while inactive (live-only)", () => {
    const state = hudReducer(initialState, hudFeedEntryReceived(makeEntry("evt-1")));
    expect(state.feed).toEqual([]);
  });

  it("dedupes on event id (overlapping-subscription fan-out, PROTOCOL §6.3)", () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-1")));
    state = hudReducer(state, hudFeedEntryReceived(makeEntry("evt-1")));
    expect(state.feed).toHaveLength(1);
  });

  it("caps the ring buffer at HUD_FEED_LIMIT, dropping the oldest", () => {
    let state = activeState();
    for (let i = 0; i < HUD_FEED_LIMIT + 5; i++) {
      state = hudReducer(state, hudFeedEntryReceived(makeEntry(`evt-${i}`)));
    }
    expect(state.feed).toHaveLength(HUD_FEED_LIMIT);
    expect(state.feed[0].id).toBe(`evt-${HUD_FEED_LIMIT + 4}`);
    expect(state.feed[state.feed.length - 1].id).toBe("evt-5");
  });

  it("raises and clears attention flags ('none' removes the key)", () => {
    let state = activeState();
    state = hudReducer(state, hudAttentionChanged("ws-1", "review_required"));
    expect(state.attentionByWorkspaceId).toEqual({ "ws-1": "review_required" });
    state = hudReducer(state, hudAttentionChanged("ws-1", "none"));
    expect(state.attentionByWorkspaceId).toEqual({});
  });

  it("clearing attention for an unknown workspace is a no-op", () => {
    const state = activeState();
    const next = hudReducer(state, hudAttentionChanged("ws-x", "none"));
    expect(next).toBe(state);
  });

  it("records live displayStatus overrides per workspace", () => {
    let state = activeState();
    state = hudReducer(state, hudDisplayStatusChanged("ws-1", "pr_open"));
    state = hudReducer(state, hudDisplayStatusChanged("ws-1", "pr_merged"));
    expect(state.displayStatusByWorkspaceId).toEqual({ "ws-1": "pr_merged" });
  });

  it("hudUsageLoaded stores the rollup and clears a prior error", () => {
    let state = hudReducer(activeState(), hudUsageFailed("boom"));
    const usage = {
      totals: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 },
      runs: 3,
      rateSamples: [{ hour: 13, tokens: 140 }],
      fetchedAtMs: 1_753_000_000_000,
    };
    state = hudReducer(state, hudUsageLoaded(usage));
    expect(state.usage).toEqual(usage);
    expect(state.usageError).toBeNull();
  });

  it("hudUsageFailed keeps the last good rollup", () => {
    const usage = {
      totals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      runs: 1,
      rateSamples: [],
      fetchedAtMs: 1,
    };
    let state = hudReducer(activeState(), hudUsageLoaded(usage));
    state = hudReducer(state, hudUsageFailed("daemon offline"));
    expect(state.usage).toEqual(usage);
    expect(state.usageError).toBe("daemon offline");
  });

  it("hudSystemStatusReceived replaces the system snapshot", () => {
    const system = { online: true, uptimeSeconds: 4200, version: "1.2.3", fetchedAtMs: 42 };
    const state = hudReducer(activeState(), hudSystemStatusReceived(system));
    expect(state.system).toEqual(system);
  });
});
