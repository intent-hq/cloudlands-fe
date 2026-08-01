import { describe, expect, it } from 'vitest';
import {
  HUD_FEED_LIMIT,
  HUD_RATE_5S_BAR_COUNT,
  HUD_RATE_5S_BUCKET_MS,
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudGridFilterRepoPicked,
  hudGridFilterStatesCleared,
  hudGridFilterStateToggled,
  hudQuestionCaptured,
  hudRate5sBackfilled,
  hudRate5sTokensObserved,
  hudRateHistoryFailed,
  hudRateHistoryLoaded,
  hudReducer,
  hudSystemStatusReceived,
  hudTakeoverRequestCleared,
  hudTakeoverRequested,
  hudUsageFailed,
  hudUsageLoaded,
  initialState,
  toRate5sBucketStart,
  type HudFeedEntry,
  type HudState,
} from './hud-slice';

function makeEntry(id: string, overrides: Partial<HudFeedEntry> = {}): HudFeedEntry {
  return {
    id,
    ts: '2026-07-30T00:00:00.000Z',
    colorClass: 'info',
    source: 'ws-1',
    kind: 'agent:started',
    text: 'Implementor',
    ...overrides,
  };
}

function activeState(): HudState {
  return hudReducer(initialState, hudActivated());
}

describe('hud-slice reducer', () => {
  it('starts inactive with an empty feed', () => {
    expect(initialState.active).toBe(false);
    expect(initialState.feed).toEqual([]);
    expect(initialState.usage).toBeNull();
    expect(initialState.system.online).toBe(false);
  });

  it('hudActivated resets to a clean active slate (live-only feed, no backfill)', () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-1')));
    state = hudReducer(state, hudActivated());
    expect(state.active).toBe(true);
    expect(state.feed).toEqual([]);
  });

  it('hudDeactivated returns to the initial state', () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-1')));
    state = hudReducer(state, hudDeactivated());
    expect(state).toEqual(initialState);
  });

  it('prepends feed entries newest-first while active', () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-1')));
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-2')));
    expect(state.feed.map((e) => e.id)).toEqual(['evt-2', 'evt-1']);
  });

  it('ignores feed entries while inactive (live-only)', () => {
    const state = hudReducer(initialState, hudFeedEntryReceived(makeEntry('evt-1')));
    expect(state.feed).toEqual([]);
  });

  it('dedupes on event id (overlapping-subscription fan-out, PROTOCOL §6.3)', () => {
    let state = activeState();
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-1')));
    state = hudReducer(state, hudFeedEntryReceived(makeEntry('evt-1')));
    expect(state.feed).toHaveLength(1);
  });

  it('caps the ring buffer at HUD_FEED_LIMIT, dropping the oldest', () => {
    let state = activeState();
    for (let i = 0; i < HUD_FEED_LIMIT + 5; i++) {
      state = hudReducer(state, hudFeedEntryReceived(makeEntry(`evt-${i}`)));
    }
    expect(state.feed).toHaveLength(HUD_FEED_LIMIT);
    expect(state.feed[0].id).toBe(`evt-${HUD_FEED_LIMIT + 4}`);
    expect(state.feed[state.feed.length - 1].id).toBe('evt-5');
  });

  it("raises and clears attention flags ('none' removes the key)", () => {
    let state = activeState();
    state = hudReducer(
      state,
      hudAttentionChanged('ws-1', 'review_required', '2026-07-30T12:00:00Z'),
    );
    expect(state.attentionByWorkspaceId).toEqual({
      'ws-1': { attention: 'review_required', raisedAtTs: '2026-07-30T12:00:00Z' },
    });
    state = hudReducer(state, hudAttentionChanged('ws-1', 'none', '2026-07-30T12:01:00Z'));
    expect(state.attentionByWorkspaceId).toEqual({});
  });

  it('re-raising the same attention value keeps the original raise time', () => {
    let state = activeState();
    state = hudReducer(
      state,
      hudAttentionChanged('ws-1', 'review_required', '2026-07-30T12:00:00Z'),
    );
    const next = hudReducer(
      state,
      hudAttentionChanged('ws-1', 'review_required', '2026-07-30T12:05:00Z'),
    );
    expect(next).toBe(state);
    expect(next.attentionByWorkspaceId['ws-1'].raisedAtTs).toBe('2026-07-30T12:00:00Z');
  });

  it('a different attention value replaces the flag and its raise time', () => {
    let state = activeState();
    state = hudReducer(state, hudAttentionChanged('ws-1', 'unread', '2026-07-30T12:00:00Z'));
    state = hudReducer(
      state,
      hudAttentionChanged('ws-1', 'review_required', '2026-07-30T12:05:00Z'),
    );
    expect(state.attentionByWorkspaceId).toEqual({
      'ws-1': { attention: 'review_required', raisedAtTs: '2026-07-30T12:05:00Z' },
    });
  });

  it('clearing attention for an unknown workspace is a no-op', () => {
    const state = activeState();
    const next = hudReducer(state, hudAttentionChanged('ws-x', 'none', '2026-07-30T12:00:00Z'));
    expect(next).toBe(state);
  });

  it('records live displayStatus overrides per workspace', () => {
    let state = activeState();
    state = hudReducer(state, hudDisplayStatusChanged('ws-1', 'pr_open'));
    state = hudReducer(state, hudDisplayStatusChanged('ws-1', 'pr_merged'));
    expect(state.displayStatusByWorkspaceId).toEqual({ 'ws-1': 'pr_merged' });
  });

  it('hudUsageLoaded stores the rollup and clears a prior error', () => {
    let state = hudReducer(activeState(), hudUsageFailed('boom'));
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

  it('hudUsageFailed keeps the last good rollup', () => {
    const usage = {
      totals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      runs: 1,
      rateSamples: [],
      fetchedAtMs: 1,
    };
    let state = hudReducer(activeState(), hudUsageLoaded(usage));
    state = hudReducer(state, hudUsageFailed('daemon offline'));
    expect(state.usage).toEqual(usage);
    expect(state.usageError).toBe('daemon offline');
  });

  it('hudSystemStatusReceived replaces the system snapshot', () => {
    const system = { online: true, uptimeSeconds: 4200, version: '1.2.3', fetchedAtMs: 42 };
    const state = hudReducer(activeState(), hudSystemStatusReceived(system));
    expect(state.system).toEqual(system);
  });

  it('hudRateHistoryLoaded replaces the history and clears the error', () => {
    const rateHistory = {
      samples: [{ bucketUtc: '2026-07-30T14:07:00Z', tokens: 170 }],
      fetchedAtMs: 7,
    };
    let state = hudReducer(activeState(), hudRateHistoryFailed('daemon offline'));
    state = hudReducer(state, hudRateHistoryLoaded(rateHistory));
    expect(state.rateHistory).toEqual(rateHistory);
    expect(state.rateHistoryError).toBeNull();
  });

  it('hudRateHistoryFailed keeps the last good history', () => {
    const rateHistory = {
      samples: [{ bucketUtc: '2026-07-30T14:07:00Z', tokens: 170 }],
      fetchedAtMs: 7,
    };
    let state = hudReducer(activeState(), hudRateHistoryLoaded(rateHistory));
    state = hudReducer(state, hudRateHistoryFailed('daemon offline'));
    expect(state.rateHistory).toEqual(rateHistory);
    expect(state.rateHistoryError).toBe('daemon offline');
  });

  it('hudTakeoverRequested records the workspace id (idempotent on repeats)', () => {
    let state = hudReducer(activeState(), hudTakeoverRequested('ws-1'));
    expect(state.takeoverRequestWorkspaceId).toBe('ws-1');
    const repeat = hudReducer(state, hudTakeoverRequested('ws-1'));
    expect(repeat).toBe(state);
    state = hudReducer(state, hudTakeoverRequested('ws-2'));
    expect(state.takeoverRequestWorkspaceId).toBe('ws-2');
  });

  it('hudTakeoverRequestCleared resets the pending request (no-op when empty)', () => {
    const empty = hudReducer(activeState(), hudTakeoverRequestCleared());
    expect(empty.takeoverRequestWorkspaceId).toBeNull();
    let state = hudReducer(activeState(), hudTakeoverRequested('ws-1'));
    state = hudReducer(state, hudTakeoverRequestCleared());
    expect(state.takeoverRequestWorkspaceId).toBeNull();
  });
});

describe('hud-slice 5s token buckets (TOK/S chart)', () => {
  // Aligned base instant so bucket math is exact.
  const BASE = toRate5sBucketStart(1_753_900_000_000);

  it('accumulates same-bucket deltas and keeps buckets chronological', () => {
    let state = activeState();
    state = hudReducer(state, hudRate5sTokensObserved(100, BASE + 1_000));
    state = hudReducer(state, hudRate5sTokensObserved(50, BASE + 4_000));
    state = hudReducer(state, hudRate5sTokensObserved(30, BASE + 6_000));
    expect(state.rate5s.buckets).toEqual([
      { startMs: BASE, tokens: 150 },
      { startMs: BASE + HUD_RATE_5S_BUCKET_MS, tokens: 30 },
    ]);
  });

  it('ignores non-positive deltas and observations while inactive', () => {
    const inactive = hudReducer(initialState, hudRate5sTokensObserved(100, BASE));
    expect(inactive.rate5s.buckets).toEqual([]);
    let state = activeState();
    state = hudReducer(state, hudRate5sTokensObserved(0, BASE));
    state = hudReducer(state, hudRate5sTokensObserved(-5, BASE));
    expect(state.rate5s.buckets).toEqual([]);
  });

  it('prunes buckets outside the trailing 40-slot window', () => {
    let state = activeState();
    state = hudReducer(state, hudRate5sTokensObserved(10, BASE));
    const beyond = BASE + HUD_RATE_5S_BAR_COUNT * HUD_RATE_5S_BUCKET_MS;
    state = hudReducer(state, hudRate5sTokensObserved(20, beyond));
    expect(state.rate5s.buckets).toEqual([{ startMs: beyond, tokens: 20 }]);
  });

  it('backfills minute samples split evenly across 5s slots, once, live buckets winning', () => {
    const nowMs = BASE + 60_000;
    const minuteUtc = new Date(BASE).toISOString();
    let state = activeState();
    state = hudReducer(state, hudRate5sTokensObserved(99, BASE + 10_000));
    state = hudReducer(
      state,
      hudRate5sBackfilled([{ bucketUtc: minuteUtc, tokens: 120 }], nowMs),
    );
    expect(state.rate5s.backfilled).toBe(true);
    const bucketAt = (offset: number) =>
      state.rate5s.buckets.find((b) => b.startMs === BASE + offset);
    expect(bucketAt(0)?.tokens).toBe(10); // 120 / 12 slots
    expect(bucketAt(10_000)?.tokens).toBe(99); // live delta wins
    // Repeat backfills are ignored (one-shot).
    const repeat = hudReducer(
      state,
      hudRate5sBackfilled([{ bucketUtc: minuteUtc, tokens: 999 }], nowMs),
    );
    expect(repeat).toBe(state);
  });

  it('backfill never writes future slots past nowMs', () => {
    const nowMs = BASE + 20_000;
    const minuteUtc = new Date(BASE).toISOString();
    let state = activeState();
    state = hudReducer(state, hudRate5sBackfilled([{ bucketUtc: minuteUtc, tokens: 120 }], nowMs));
    expect(Math.max(...state.rate5s.buckets.map((b) => b.startMs))).toBeLessThanOrEqual(nowMs);
  });
});

describe('hud-slice question capture (§7.1 trailingBlocks)', () => {
  const QUESTION = {
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    header: 'Auth method',
    question: 'Which authentication method should the new endpoint use?',
    ts: '2026-07-30T12:00:00.000Z',
  };

  it('stores the latest question per agent (newer replaces older)', () => {
    let state = activeState();
    state = hudReducer(state, hudQuestionCaptured(QUESTION));
    expect(state.questionsByAgentId['agent-1']).toEqual(QUESTION);
    const newer = { ...QUESTION, question: 'Use OAuth?', ts: '2026-07-30T12:05:00.000Z' };
    state = hudReducer(state, hudQuestionCaptured(newer));
    expect(state.questionsByAgentId['agent-1']).toEqual(newer);
  });

  it('ignores captures while inactive and clears on deactivate', () => {
    const inactive = hudReducer(initialState, hudQuestionCaptured(QUESTION));
    expect(inactive.questionsByAgentId).toEqual({});
    let state = hudReducer(activeState(), hudQuestionCaptured(QUESTION));
    state = hudReducer(state, hudDeactivated());
    expect(state.questionsByAgentId).toEqual({});
  });
});

describe('hud-slice grid filter (header FLEET OPS menus)', () => {
  it('picks and clears the repo (idempotent on repeats)', () => {
    let state = hudReducer(activeState(), hudGridFilterRepoPicked('intent-hq/intentd'));
    expect(state.gridFilter.repo).toBe('intent-hq/intentd');
    const repeat = hudReducer(state, hudGridFilterRepoPicked('intent-hq/intentd'));
    expect(repeat).toBe(state);
    state = hudReducer(state, hudGridFilterRepoPicked(null));
    expect(state.gridFilter.repo).toBeNull();
  });

  it('toggles state keys and clears them', () => {
    let state = hudReducer(activeState(), hudGridFilterStateToggled('failed'));
    state = hudReducer(state, hudGridFilterStateToggled('wait'));
    expect(state.gridFilter.states).toEqual(['failed', 'wait']);
    state = hudReducer(state, hudGridFilterStateToggled('failed'));
    expect(state.gridFilter.states).toEqual(['wait']);
    state = hudReducer(state, hudGridFilterStatesCleared());
    expect(state.gridFilter.states).toEqual([]);
  });
});
