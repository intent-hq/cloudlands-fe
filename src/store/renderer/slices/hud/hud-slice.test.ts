import { describe, expect, it } from 'vitest';
import {
  HUD_FEED_LIMIT,
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudGridFilterRepoPicked,
  hudGridFilterStatesCleared,
  hudGridFilterStateToggled,
  hudQuestionCaptured,
  hudQuestionsResolvedForWorkspace,
  hudRateHistoryFailed,
  hudRateHistoryLoaded,
  hudReducer,
  hudTakeoverRequestCleared,
  hudTakeoverRequested,
  hudUsageFailed,
  hudUsageLoaded,
  initialState,
  type HudFeedEntry,
  type HudState,
} from './hud-slice';
import type { Workspace, WorkspaceDisplayStatus } from '$shared/types';
import { replaceWorkspaceList, setWorkspaceEntity } from '../workspace/workspace-slice';

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

  it("'unread' stores a tracked (non-urgent) flag and 'none' (markSeen) clears it", () => {
    let state = activeState();
    state = hudReducer(state, hudAttentionChanged('ws-1', 'unread', '2026-07-30T12:00:00Z'));
    expect(state.attentionByWorkspaceId).toEqual({
      'ws-1': { attention: 'unread', raisedAtTs: '2026-07-30T12:00:00Z' },
    });
    // `workspace.markSeen` emits attention-changed with "none" (§9.9): clear.
    state = hudReducer(state, hudAttentionChanged('ws-1', 'none', '2026-07-30T12:05:00Z'));
    expect(state.attentionByWorkspaceId).toEqual({});
  });

  it("the single-valued wire field swaps between 'unread' and 'review_required'", () => {
    let state = activeState();
    state = hudReducer(
      state,
      hudAttentionChanged('ws-1', 'review_required', '2026-07-30T12:00:00Z'),
    );
    state = hudReducer(state, hudAttentionChanged('ws-1', 'unread', '2026-07-30T12:05:00Z'));
    expect(state.attentionByWorkspaceId).toEqual({
      'ws-1': { attention: 'unread', raisedAtTs: '2026-07-30T12:05:00Z' },
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

  describe('displayStatus override reconciliation', () => {
    function withOverrides(): HudState {
      let state = activeState();
      state = hudReducer(state, hudDisplayStatusChanged('ws-1', 'pr_open'));
      return hudReducer(state, hudDisplayStatusChanged('ws-2', 'in_progress'));
    }

    function entity(id: string, displayStatus?: WorkspaceDisplayStatus): Workspace {
      return { id, displayStatus } as Workspace;
    }

    it('an entity that agrees with the override retires it immediately', () => {
      const state = hudReducer(withOverrides(), setWorkspaceEntity(entity('ws-1', 'pr_open')));
      expect(state.displayStatusByWorkspaceId).toEqual({ 'ws-2': 'in_progress' });
    });

    it('the FIRST contradicting entity keeps the override (it may be an in-flight refetch)', () => {
      const state = hudReducer(withOverrides(), setWorkspaceEntity(entity('ws-1', 'pr_merged')));
      expect(state.displayStatusByWorkspaceId).toEqual({
        'ws-1': 'pr_open',
        'ws-2': 'in_progress',
      });
      expect(state.displayStatusOverridesContradicted).toEqual({ 'ws-1': true });
    });

    it('a SECOND contradicting entity retires the override', () => {
      let state = hudReducer(withOverrides(), setWorkspaceEntity(entity('ws-1', 'pr_merged')));
      state = hudReducer(state, setWorkspaceEntity(entity('ws-1', 'pr_merged')));
      expect(state.displayStatusByWorkspaceId).toEqual({ 'ws-2': 'in_progress' });
      expect(state.displayStatusOverridesContradicted).toEqual({});
    });

    it('a refetch that predates the event cannot clobber the override (reverse race)', () => {
      // `workspace.list` starts, the event lands mid-flight, then the stale
      // response resolves: the override must survive and keep rendering.
      let state = hudReducer(activeState(), hudDisplayStatusChanged('ws-1', 'failed'));
      state = hudReducer(state, replaceWorkspaceList([entity('ws-1', 'in_progress')]));
      expect(state.displayStatusByWorkspaceId).toEqual({ 'ws-1': 'failed' });
    });

    it('a newer event restarts the two-strike count', () => {
      let state = hudReducer(withOverrides(), setWorkspaceEntity(entity('ws-1', 'pr_merged')));
      state = hudReducer(state, hudDisplayStatusChanged('ws-1', 'complete'));
      expect(state.displayStatusOverridesContradicted).toEqual({});
      state = hudReducer(state, setWorkspaceEntity(entity('ws-1', 'pr_merged')));
      expect(state.displayStatusByWorkspaceId['ws-1']).toBe('complete');
    });

    it('replaceWorkspaceList reconciles every row carrying a value', () => {
      let state = hudReducer(
        withOverrides(),
        replaceWorkspaceList([entity('ws-1', 'complete'), entity('ws-2', 'in_progress')]),
      );
      // ws-2 agreed (retired now); ws-1 contradicted once (survives).
      expect(state.displayStatusByWorkspaceId).toEqual({ 'ws-1': 'pr_open' });
      state = hudReducer(state, replaceWorkspaceList([entity('ws-1', 'complete')]));
      expect(state.displayStatusByWorkspaceId).toEqual({});
    });

    it('an entity without a displayStatus keeps the override (nothing fresher arrived)', () => {
      const state = withOverrides();
      expect(hudReducer(state, setWorkspaceEntity(entity('ws-1')))).toBe(state);
    });

    it('an unrelated workspace leaves the overrides untouched', () => {
      const state = withOverrides();
      expect(hudReducer(state, setWorkspaceEntity(entity('ws-9', 'complete')))).toBe(state);
    });
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

  it('workspace resolution clears only that workspace\u2019s captured questions', () => {
    // Pendingness is persistent: the daemon's needs_attention rollup dropping
    // is the release signal, and it is workspace-scoped.
    const elsewhere = { ...QUESTION, agentId: 'agent-9', workspaceId: 'ws-2' };
    let state = hudReducer(activeState(), hudQuestionCaptured(QUESTION));
    state = hudReducer(state, hudQuestionCaptured(elsewhere));
    state = hudReducer(state, hudQuestionsResolvedForWorkspace(QUESTION.workspaceId));
    expect(state.questionsByAgentId).toEqual({ 'agent-9': elsewhere });
    // Nothing left for that workspace: no state churn.
    const repeat = hudReducer(state, hudQuestionsResolvedForWorkspace(QUESTION.workspaceId));
    expect(repeat).toBe(state);
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
