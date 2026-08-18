import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '$shared/types';
import {
  classifyScrollbackGesture,
  composeTranscript,
  estimateSeekLandingStartOrdinal,
  estimateVirtualSpacerHeight,
  isConversationStartLoaded,
  mapScrollTopToOrdinal,
  reconcileVirtualSpacer,
  restateFrozenSpacers,
  SCROLLBACK_PAGE_ROWS,
  SCROLLBACK_SEEK_NEAR_PAGES,
  seekLandingScrollTop,
  shouldChainOlderHistoryOnSettle,
  shouldRequestOlderHistory,
  smoothRowHeightEstimate,
  splitUnloadedRows,
  VIRTUAL_ROW_EMA_ALPHA,
  VIRTUAL_ROW_HEIGHT_MAX_PX,
  VIRTUAL_ROW_HEIGHT_MIN_PX,
  VIRTUAL_SPACER_HYSTERESIS_RATIO,
} from '../chat-scrollback-composition';
import { indexConversationTurns } from '../conversation-turns';

function msg(id: string, role: 'user' | 'assistant', timestamp: string): AgentMessage {
  return { id, role, content: id, timestamp } as unknown as AgentMessage;
}

describe('composeTranscript', () => {
  it('returns the tail-only grouping (no group keys, no gap) when history is empty', () => {
    const tail = [msg('t1', 'user', '2026-08-01T10:00:00Z'), msg('t2', 'assistant', '2026-08-01T10:01:00Z')];
    const composed = composeTranscript([], tail, false);
    expect(composed.gapBeforeGroupIndex).toBeNull();
    expect(composed.groups).toHaveLength(1);
    expect(composed.groups[0].groupKey).toBeUndefined();
    expect(composed.groups[0].messages.map((m) => m.id)).toEqual(['t1', 't2']);
  });

  it('merges history and tail seamlessly when the gap is closed', () => {
    const history = [msg('h1', 'user', '2026-08-01T09:00:00Z')];
    const tail = [msg('t1', 'assistant', '2026-08-01T10:00:00Z')];
    const composed = composeTranscript(history, tail, false);
    expect(composed.gapBeforeGroupIndex).toBeNull();
    expect(composed.groups).toHaveLength(1);
    expect(composed.groups[0].messages.map((m) => m.id)).toEqual(['h1', 't1']);
    // A same-day turn stitches across the closed junction.
    const indexed = indexConversationTurns(composed.groups);
    expect(indexed.turnKeyByMessageId.get('t1')).toBe('h1');
  });

  it('keeps history and tail as separate groups when the gap is open (hard turn boundary)', () => {
    const history = [msg('h1', 'user', '2026-08-01T09:00:00Z')];
    const tail = [msg('t1', 'assistant', '2026-08-01T10:00:00Z')];
    const composed = composeTranscript(history, tail, true);
    expect(composed.groups).toHaveLength(2);
    expect(composed.gapBeforeGroupIndex).toBe(1);
    // The orphaned tail assistant is NOT stitched into the history turn.
    const indexed = indexConversationTurns(composed.groups);
    expect(indexed.turnKeyByMessageId.get('t1')).not.toBe('h1');
  });

  it('keeps tail turn keys stable across history prepends (LazyTurn cache survival)', () => {
    const tail = [msg('t-orphan', 'assistant', '2026-08-02T10:00:00Z')];
    const history1 = [msg('h2', 'user', '2026-08-01T09:00:00Z')];
    const history2 = [msg('h1', 'user', '2026-07-30T08:00:00Z'), ...history1];
    const before = indexConversationTurns(composeTranscript(history1, tail, true).groups);
    const after = indexConversationTurns(composeTranscript(history2, tail, true).groups);
    expect(before.turnKeyByMessageId.get('t-orphan')).toBeDefined();
    expect(after.turnKeyByMessageId.get('t-orphan')).toBe(
      before.turnKeyByMessageId.get('t-orphan'),
    );
  });

  it('disambiguates duplicate day keys from out-of-order timestamps', () => {
    const history = [
      msg('h1', 'user', '2026-08-01T09:00:00Z'),
      msg('h2', 'user', '2026-08-02T09:00:00Z'),
      msg('h3', 'user', '2026-08-01T23:00:00Z'),
    ];
    const composed = composeTranscript(history, [], true);
    const keys = composed.groups.map((g) => g.groupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Regression (tiny-caps QA): repeated scroll-to-top → scroll-back-down
  // cycles rendered the same sections 3-4x. History rows are deduped against
  // the tail only when the history reducer runs; the TAIL later re-acquires
  // rows already resident in history (chat-read's older-history fetch tops
  // the tail up to the cap on every rehydration; seq-0 snapshots replace it
  // wholesale). Composition must therefore drop tail-resident rows from the
  // history side at render time, whichever path put them in the tail.
  describe('history/tail dual residency (duplicate sections regression)', () => {
    // Rows shaped as the real paging RPC returns them: daemon `msg_` ids,
    // ISO timestamps, contentBlocks; user rows may carry an echoed
    // appMessageId (PROTOCOL §5.5).
    function wireRow(
      id: string,
      role: 'user' | 'assistant',
      timestamp: string,
      appMessageId?: string,
    ): AgentMessage {
      return {
        id,
        role,
        timestamp,
        ...(appMessageId ? { appMessageId } : {}),
        contentBlocks: [{ type: 'text', text: `content of ${id}` }],
      } as unknown as AgentMessage;
    }

    const h1 = wireRow('msg_h1', 'user', '2026-08-01T09:00:00Z');
    const h2 = wireRow('msg_h2', 'assistant', '2026-08-01T09:01:00Z');
    const shared = wireRow('msg_shared', 'user', '2026-08-01T09:02:00Z');
    const appEcho = wireRow('msg_echo_hist', 'user', '2026-08-01T09:03:00Z', 'app_echo_1');

    it('drops history rows the tail re-acquired (same id), closed gap', () => {
      // Cycle: rows paged into history, then a tail refill (older-history
      // fetch / snapshot replaceMessages) re-added `msg_shared` to the tail.
      const history = [h1, h2, shared];
      const tail = [
        wireRow('msg_shared', 'user', '2026-08-01T09:02:00Z'),
        wireRow('msg_t1', 'assistant', '2026-08-01T09:04:00Z'),
      ];
      const composed = composeTranscript(history, tail, false);
      const ids = composed.groups.flatMap((g) => g.messages.map((m) => m.id));
      expect(ids.filter((id) => id === 'msg_shared')).toHaveLength(1);
      expect(ids).toEqual(['msg_h1', 'msg_h2', 'msg_shared', 'msg_t1']);
    });

    it('drops history rows the tail re-acquired (same id), open gap', () => {
      const history = [h1, h2, shared];
      const tail = [
        wireRow('msg_shared', 'user', '2026-08-01T09:02:00Z'),
        wireRow('msg_t1', 'assistant', '2026-08-01T09:04:00Z'),
      ];
      const composed = composeTranscript(history, tail, true);
      const ids = composed.groups.flatMap((g) => g.messages.map((m) => m.id));
      expect(ids.filter((id) => id === 'msg_shared')).toHaveLength(1);
    });

    it('drops history rows matching a tail row by appMessageId', () => {
      // The daemon-canonical copy landed in the tail under a different row
      // id but the same echoed appMessageId (optimistic-send identity).
      const history = [h1, appEcho];
      const tail = [wireRow('user-msg-echo-tail', 'user', '2026-08-01T09:03:05Z', 'app_echo_1')];
      const composed = composeTranscript(history, tail, false);
      const ids = composed.groups.flatMap((g) => g.messages.map((m) => m.id));
      expect(ids).toEqual(['msg_h1', 'user-msg-echo-tail']);
    });

    it('collapses to tail-only composition when the tail re-acquired every history row', () => {
      const history = [shared];
      const tail = [
        wireRow('msg_shared', 'user', '2026-08-01T09:02:00Z'),
        wireRow('msg_t1', 'assistant', '2026-08-01T09:04:00Z'),
      ];
      const composed = composeTranscript(history, tail, true);
      expect(composed.gapBeforeGroupIndex).toBeNull();
      const ids = composed.groups.flatMap((g) => g.messages.map((m) => m.id));
      expect(ids).toEqual(['msg_shared', 'msg_t1']);
    });

    it('stays duplicate-free across repeated prepend → tail-refill cycles', () => {
      // Simulate three scroll-up/scroll-down cycles: each cycle pages more
      // rows into history while the tail refill re-acquires the boundary
      // rows history already holds (rows shaped as the paging RPC returns
      // them). The composed output must never render an identity twice.
      const mkRow = (i: number, role: 'user' | 'assistant') =>
        wireRow(`msg_${String(i).padStart(3, '0')}`, role, ts(i));
      const ts = (i: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + i * 60_000).toISOString();
      const all = Array.from({ length: 24 }, (_, i) => mkRow(i, i % 2 === 0 ? 'user' : 'assistant'));

      let history: AgentMessage[] = [];
      let tail = all.slice(18); // newest 6 resident
      for (let cycle = 0; cycle < 3; cycle++) {
        // Scroll up: an older page (6 rows) lands in history, overlapping
        // one row the tail held at fetch time is dropped by the reducer —
        // model that by just prepending disjoint rows.
        const start = Math.max(0, 18 - (cycle + 1) * 6);
        history = [...all.slice(start, start + 6), ...history].filter(
          (row, index, rows) => rows.findIndex((other) => other.id === row.id) === index,
        );
        // Scroll down: the tail refill tops the tail back up with rows
        // adjacent to (and overlapping) history's newest rows.
        tail = all.slice(Math.max(0, 18 - (cycle + 1) * 3));
        const composed = composeTranscript(history, tail, cycle % 2 === 0);
        const ids = composed.groups.flatMap((g) => g.messages.map((m) => m.id));
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });
});

describe('shouldRequestOlderHistory', () => {
  const base = {
    scrollTop: 100,
    threshold: 240,
    canScroll: true,
    fetching: false,
    exhausted: false,
    historyCount: 0,
    tailCount: 30,
    tailTruncated: true,
    totalMessages: 30,
  };

  it('fires near the top when older rows exist beyond the tail', () => {
    expect(shouldRequestOlderHistory(base)).toBe(true);
  });

  it('fires when history rows are already hydrated even if the tail flag is stale', () => {
    expect(
      shouldRequestOlderHistory({ ...base, tailTruncated: false, historyCount: 5 }),
    ).toBe(true);
  });

  it('fires on client-pruned rows: totalMessages > resident rows with truncated=false', () => {
    // Client cap (30) < daemon snapshot page: rows pruned locally, daemon
    // `truncated` stays false — totalMessages is the only evidence.
    expect(
      shouldRequestOlderHistory({ ...base, tailTruncated: false, totalMessages: 120 }),
    ).toBe(true);
    expect(
      shouldRequestOlderHistory({
        ...base,
        tailTruncated: false,
        historyCount: 10,
        totalMessages: 41,
      }),
    ).toBe(true);
  });

  it('never fires for short conversations (all rows resident, tail not truncated)', () => {
    expect(shouldRequestOlderHistory({ ...base, tailTruncated: false })).toBe(false);
    expect(
      shouldRequestOlderHistory({
        ...base,
        tailTruncated: false,
        tailCount: 12,
        totalMessages: 12,
      }),
    ).toBe(false);
  });

  it('does not fire away from the top, while unscrollable, fetching, or exhausted', () => {
    expect(shouldRequestOlderHistory({ ...base, scrollTop: 500 })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, canScroll: false })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, fetching: true })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, exhausted: true })).toBe(false);
  });

  it('extends the near-top threshold by the virtual spacer height (thumb drag)', () => {
    // Thumb dragged INTO the estimated region: scrollTop is far beyond the
    // resident threshold but inside spacer + threshold — fires.
    expect(
      shouldRequestOlderHistory({ ...base, scrollTop: 5000, spacerAbove: 10000 }),
    ).toBe(true);
    // Below the spacer region: does not fire.
    expect(
      shouldRequestOlderHistory({ ...base, scrollTop: 10500, spacerAbove: 10000 }),
    ).toBe(false);
    // No spacer keeps the resident-only behavior byte-identical.
    expect(shouldRequestOlderHistory({ ...base, scrollTop: 500, spacerAbove: 0 })).toBe(false);
  });
});

describe('shouldChainOlderHistoryOnSettle (continuous paging)', () => {
  // Post-settle state: the prepend landed (history hydrated), the fetching
  // flag just cleared, and the anchor restore kept the viewport near the top.
  const afterSettle = {
    scrollTop: 100,
    threshold: 240,
    canScroll: true,
    fetching: false,
    exhausted: false,
    historyCount: 10,
    tailCount: 30,
    tailTruncated: true,
    totalMessages: 200,
  };

  it('chains the next page when the settle leaves the viewport within the threshold', () => {
    expect(shouldChainOlderHistoryOnSettle(true, afterSettle)).toBe(true);
  });

  it('does not fire without a settle transition (edge, not level)', () => {
    expect(shouldChainOlderHistoryOnSettle(false, afterSettle)).toBe(false);
  });

  it('stops when the anchor restore moved the viewport past the threshold', () => {
    expect(shouldChainOlderHistoryOnSettle(true, { ...afterSettle, scrollTop: 800 })).toBe(false);
  });

  it('stops when the walk exhausted history (oldest row hydrated)', () => {
    expect(shouldChainOlderHistoryOnSettle(true, { ...afterSettle, exhausted: true })).toBe(false);
  });

  it('stops when everything is resident (nothing older to fetch)', () => {
    expect(
      shouldChainOlderHistoryOnSettle(true, {
        ...afterSettle,
        historyCount: 0,
        tailTruncated: false,
        totalMessages: 30,
      }),
    ).toBe(false);
  });

  it('does not re-enter while the next fetch is already in flight', () => {
    expect(shouldChainOlderHistoryOnSettle(true, { ...afterSettle, fetching: true })).toBe(false);
  });

  it('chains repeatedly until exhaustion, then stops (simulated walk)', () => {
    // Simulate holding the viewport at the top through a 3-page walk: each
    // settle re-evaluates; the last settle sets exhausted and the chain ends.
    const pages = [
      { ...afterSettle, historyCount: 10 },
      { ...afterSettle, historyCount: 20 },
      { ...afterSettle, historyCount: 30, exhausted: true },
    ];
    const fired = pages.map((page) => shouldChainOlderHistoryOnSettle(true, page));
    expect(fired).toEqual([true, true, false]);
  });
});

describe('isConversationStartLoaded (conversation-start header gate)', () => {
  it('true when the older walk exhausted history (oldestReached)', () => {
    expect(
      isConversationStartLoaded({
        exhausted: true,
        historyCount: 40,
        tailCount: 30,
        tailTruncated: true,
        totalMessages: 200,
      }),
    ).toBe(true);
  });

  it('true for a short conversation fully resident in the tail', () => {
    expect(
      isConversationStartLoaded({
        exhausted: false,
        historyCount: 0,
        tailCount: 12,
        tailTruncated: false,
        totalMessages: 12,
      }),
    ).toBe(true);
    // No snapshot yet (totalMessages 0) and no truncation evidence: the
    // resident tail is all there is.
    expect(
      isConversationStartLoaded({
        exhausted: false,
        historyCount: 0,
        tailCount: 5,
        tailTruncated: false,
        totalMessages: 0,
      }),
    ).toBe(true);
  });

  it('false while older rows exist beyond the tail (truncated snapshot)', () => {
    expect(
      isConversationStartLoaded({
        exhausted: false,
        historyCount: 0,
        tailCount: 30,
        tailTruncated: true,
        totalMessages: 200,
      }),
    ).toBe(false);
  });

  it('false on client-pruned rows: totalMessages > tail with truncated=false', () => {
    expect(
      isConversationStartLoaded({
        exhausted: false,
        historyCount: 0,
        tailCount: 30,
        tailTruncated: false,
        totalMessages: 120,
      }),
    ).toBe(false);
  });

  it('false mid-history: hydrated history segment without oldestReached', () => {
    // Even when the counts happen to cover totalMessages (cap-pruned rows
    // above the segment are invisible to them), a non-exhausted walk means
    // the true start is NOT proven resident.
    expect(
      isConversationStartLoaded({
        exhausted: false,
        historyCount: 170,
        tailCount: 30,
        tailTruncated: false,
        totalMessages: 200,
      }),
    ).toBe(false);
  });
});

describe('estimateVirtualSpacerHeight (virtual scrollbar)', () => {
  // 30 resident rows at 100px average, 200 total → 170 unloaded above.
  const base = {
    totalMessages: 200,
    residentCount: 30,
    exhausted: false,
    residentContentHeight: 3000,
  };

  it('sizes the spacer as unloaded rows x average resident row height', () => {
    expect(estimateVirtualSpacerHeight(base)).toBe(170 * 100);
  });

  it('keeps total extent ~stable as pages land (spacer shrinks by the rows loaded)', () => {
    // A 10-row page lands at the same average height: resident content grows
    // by 1000px while the spacer shrinks by exactly the same 1000px.
    const before = estimateVirtualSpacerHeight(base);
    const after = estimateVirtualSpacerHeight({
      ...base,
      residentCount: 40,
      residentContentHeight: 4000,
    });
    expect(before - after).toBe(1000);
    expect(before + base.residentContentHeight).toBe(after + 4000);
  });

  it('returns 0 when the walk is exhausted (true start resident)', () => {
    expect(estimateVirtualSpacerHeight({ ...base, exhausted: true })).toBe(0);
  });

  it('returns 0 when totalMessages is unknown (graceful fallback)', () => {
    expect(estimateVirtualSpacerHeight({ ...base, totalMessages: 0 })).toBe(0);
  });

  it('returns 0 when everything is resident and never goes negative', () => {
    expect(estimateVirtualSpacerHeight({ ...base, residentCount: 200 })).toBe(0);
    // Estimate overshoot: more resident rows than the (stale) snapshot total.
    expect(estimateVirtualSpacerHeight({ ...base, residentCount: 240 })).toBe(0);
  });

  it('returns 0 before any rows are resident (nothing to average over)', () => {
    expect(
      estimateVirtualSpacerHeight({ ...base, residentCount: 0, residentContentHeight: 0 }),
    ).toBe(0);
  });

  it('clamps degenerate average row heights', () => {
    // Zero-height measurement (container mid-layout) → min clamp, not 0.
    expect(
      estimateVirtualSpacerHeight({ ...base, residentContentHeight: 0 }),
    ).toBe(170 * VIRTUAL_ROW_HEIGHT_MIN_PX);
    // One enormous turn skewing the mean → max clamp.
    expect(
      estimateVirtualSpacerHeight({ ...base, residentContentHeight: 300000 }),
    ).toBe(170 * VIRTUAL_ROW_HEIGHT_MAX_PX);
  });
});

describe('smoothRowHeightEstimate (EMA)', () => {
  it('seeds from the first (clamped) sample', () => {
    expect(smoothRowHeightEstimate(null, 100)).toBe(100);
    expect(smoothRowHeightEstimate(null, 1)).toBe(VIRTUAL_ROW_HEIGHT_MIN_PX);
    expect(smoothRowHeightEstimate(null, 10000)).toBe(VIRTUAL_ROW_HEIGHT_MAX_PX);
  });

  it('bounds single-sample influence to alpha x deviation', () => {
    // One page of tall messages (300px avg vs 100px estimate) moves the
    // estimate by only alpha x 200 = 40px, not to 300.
    const next = smoothRowHeightEstimate(100, 300);
    expect(next).toBeCloseTo(100 + VIRTUAL_ROW_EMA_ALPHA * 200);
    expect(next).toBeLessThan(200);
  });

  it('clamps the sample before mixing so outliers cannot drag the estimate past the bounds', () => {
    const next = smoothRowHeightEstimate(100, 100000);
    expect(next).toBeCloseTo(100 + VIRTUAL_ROW_EMA_ALPHA * (VIRTUAL_ROW_HEIGHT_MAX_PX - 100));
  });

  it('converges toward a repeated sample over many pages', () => {
    let estimate = 100;
    for (let i = 0; i < 50; i++) estimate = smoothRowHeightEstimate(estimate, 200);
    expect(estimate).toBeGreaterThan(195);
    expect(estimate).toBeLessThanOrEqual(200);
  });
});

describe('restateFrozenSpacers (frozen-phase invariant)', () => {
  it('derives both spacers from the split counts x the frozen EMA', () => {
    expect(restateFrozenSpacers({ above: 100, below: 40 }, 72)).toEqual({
      above: 7200,
      below: 2880,
    });
  });

  it('shrinks the above spacer monotonically through a cap-pruned chain', () => {
    // Cap-pruned regime: each page moves rows from above into the hole, so
    // measured resident height is ~constant — but the counts still move.
    // The restatement tracks the counts with a locked EMA, so above shrinks
    // monotonically while below grows, page after page.
    const ema = 72;
    let previous = restateFrozenSpacers({ above: 600, below: 0 }, ema);
    for (let page = 1; page <= 3; page++) {
      const next = restateFrozenSpacers({ above: 600 - page * 200, below: page * 200 }, ema);
      expect(next.above).toBeLessThan(previous.above);
      expect(next.below).toBeGreaterThan(previous.below);
      expect(next.above + next.below).toBe(previous.above + previous.below);
      previous = next;
    }
    expect(previous.above).toBe(0);
  });

  it('zeroes exactly at the boundaries (exhausted split / closed gap)', () => {
    expect(restateFrozenSpacers({ above: 0, below: 120 }, 72)).toEqual({ above: 0, below: 8640 });
    expect(restateFrozenSpacers({ above: 0, below: 0 }, 72)).toEqual({ above: 0, below: 0 });
  });

  it('clamps a degenerate/missing EMA into the row-height bounds', () => {
    expect(restateFrozenSpacers({ above: 10, below: 0 }, null)).toEqual({
      above: 10 * VIRTUAL_ROW_HEIGHT_MIN_PX,
      below: 0,
    });
    expect(restateFrozenSpacers({ above: 10, below: 0 }, 10_000)).toEqual({
      above: 10 * VIRTUAL_ROW_HEIGHT_MAX_PX,
      below: 0,
    });
    expect(restateFrozenSpacers({ above: -5, below: -2 }, 72)).toEqual({ above: 0, below: 0 });
  });
});

describe('reconcileVirtualSpacer (quiet-point reconcile)', () => {
  // 40 resident rows, 200 total, resident content 4000px (100px average).
  const base = {
    totalMessages: 200,
    residentCount: 40,
    exhausted: false,
    residentContentHeight: 4000,
    currentSpacerHeight: 16000,
    rowHeightEma: 100,
    viewportHeight: 800,
  };

  it('hysteresis skips small drifts (target within the ratio of current)', () => {
    // EMA nudges from 100 toward 110: target 160 x ~102 ≈ 16320 — a ~2%
    // drift, well inside the hysteresis band → keep the current height.
    const result = reconcileVirtualSpacer({ ...base, residentContentHeight: 4400 });
    expect(result.applied).toBe(false);
    expect(result.spacerHeight).toBe(base.currentSpacerHeight);
    expect(result.scrollTopDelta).toBe(0);
    // The EMA still advanced (carried for the next reconcile).
    expect(result.rowHeightEma).toBeCloseTo(100 + VIRTUAL_ROW_EMA_ALPHA * 10);
  });

  it('applies drifts beyond the hysteresis ratio with compensating scrollTop delta', () => {
    // Current is far off (say the chain floored the spacer low): target
    // 160 x 100 = 16000 vs current 12000 → >12% drift, applied.
    const result = reconcileVirtualSpacer({ ...base, currentSpacerHeight: 12000 });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(16000);
    // Compensation = exact height change above the viewport, so applying
    // scrollTop += delta keeps content and thumb position stable.
    expect(result.scrollTopDelta).toBe(16000 - 12000);
    expect(
      result.spacerHeight - result.scrollTopDelta,
    ).toBe(12000);
  });

  it('applies drifts larger than one viewport even when under the ratio', () => {
    // 5% drift on a huge spacer: 16000 → 16800 (800px = one viewport is the
    // absolute threshold; use a smaller viewport to cross it).
    const result = reconcileVirtualSpacer({
      ...base,
      rowHeightEma: 105,
      residentContentHeight: 4200,
      viewportHeight: 700,
    });
    expect(result.applied).toBe(true);
    expect(result.scrollTopDelta).toBe(result.spacerHeight - base.currentSpacerHeight);
  });

  it('exhaustion zeroes the spacer exactly, bypassing hysteresis', () => {
    const result = reconcileVirtualSpacer({ ...base, exhausted: true });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(0);
    expect(result.scrollTopDelta).toBe(-16000);
  });

  it('all-resident boundary also zeroes exactly', () => {
    const result = reconcileVirtualSpacer({ ...base, residentCount: 200 });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(0);
  });

  it('first-ever spacer (current 0) applies immediately', () => {
    const result = reconcileVirtualSpacer({ ...base, currentSpacerHeight: 0, rowHeightEma: null });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBeGreaterThan(0);
    expect(result.rowHeightEma).toBe(100);
  });

  it('no-op when the target equals the current height', () => {
    const result = reconcileVirtualSpacer(base);
    expect(result.applied).toBe(false);
    expect(result.scrollTopDelta).toBe(0);
  });

  it('EMA bounds one wild page: reconcile after tall-message pages stays within alpha influence', () => {
    // Resident average jumps to 250px after a page of huge messages, but
    // the EMA only moves 100 → 130; the target uses the SMOOTHED estimate.
    const result = reconcileVirtualSpacer({
      ...base,
      residentContentHeight: 10000,
      currentSpacerHeight: 16000,
    });
    expect(result.rowHeightEma).toBeCloseTo(130);
    const expectedTarget = Math.round(160 * 130);
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(expectedTarget);
    expect(result.spacerHeight).toBeLessThan(160 * 250);
  });

  it('hysteresis ratio constant is meaningful (10-15% band)', () => {
    expect(VIRTUAL_SPACER_HYSTERESIS_RATIO).toBeGreaterThanOrEqual(0.1);
    expect(VIRTUAL_SPACER_HYSTERESIS_RATIO).toBeLessThanOrEqual(0.15);
  });
});

describe('classifyScrollbackGesture (far-flick seek)', () => {
  // rowHeight 100 (in-bounds), page 200 rows, near threshold 2 pages =
  // 400 rows = 40000px from the segment start.
  const base = {
    scrollTop: 0,
    spacerAboveHeight: 100_000,
    rowHeightEstimate: 100,
  };

  it('resident positions (at/past the spacer) are serial', () => {
    expect(classifyScrollbackGesture({ ...base, scrollTop: 100_000 })).toBe('serial');
    expect(classifyScrollbackGesture({ ...base, scrollTop: 150_000 })).toBe('serial');
  });

  it('no spacer means serial regardless of position', () => {
    expect(classifyScrollbackGesture({ ...base, spacerAboveHeight: 0 })).toBe('serial');
  });

  it('inside the spacer but within the near threshold stays serial', () => {
    // 300 rows above the segment start (< 400).
    expect(classifyScrollbackGesture({ ...base, scrollTop: 100_000 - 300 * 100 })).toBe('serial');
    // Exactly at the threshold is NOT deeper than it — serial.
    expect(classifyScrollbackGesture({ ...base, scrollTop: 100_000 - 400 * 100 })).toBe('serial');
  });

  it('deeper than the near threshold seeks', () => {
    expect(classifyScrollbackGesture({ ...base, scrollTop: 100_000 - 401 * 100 })).toBe('seek');
    expect(classifyScrollbackGesture({ ...base, scrollTop: 0 })).toBe('seek');
  });

  it('null row-height estimate falls back to the clamp minimum (conservative: more rows per px)', () => {
    // With MIN 24px/row, 40000px spans ~1667 rows > 400 — still a seek.
    expect(
      classifyScrollbackGesture({
        scrollTop: 100_000 - 40_000,
        spacerAboveHeight: 100_000,
        rowHeightEstimate: null,
      }),
    ).toBe('seek');
  });

  it('honors custom pageSize/nearPages', () => {
    const result = classifyScrollbackGesture({
      ...base,
      scrollTop: 100_000 - 50 * 100,
      pageSize: 10,
      nearPages: 3,
    });
    expect(result).toBe('seek');
  });

  it('threshold constants: 2-3 pages of 200 rows', () => {
    expect(SCROLLBACK_PAGE_ROWS).toBe(200);
    expect(SCROLLBACK_SEEK_NEAR_PAGES).toBeGreaterThanOrEqual(2);
    expect(SCROLLBACK_SEEK_NEAR_PAGES).toBeLessThanOrEqual(3);
  });
});

describe('mapScrollTopToOrdinal (position → ordinal mapping)', () => {
  it('maps the spacer fraction into the unloaded ordinal range (0-based from oldest)', () => {
    expect(
      mapScrollTopToOrdinal({ scrollTop: 0, spacerAboveHeight: 10_000, unloadedRowsAbove: 1000 }),
    ).toBe(0);
    expect(
      mapScrollTopToOrdinal({
        scrollTop: 5000,
        spacerAboveHeight: 10_000,
        unloadedRowsAbove: 1000,
      }),
    ).toBe(500);
    expect(
      mapScrollTopToOrdinal({
        scrollTop: 9999,
        spacerAboveHeight: 10_000,
        unloadedRowsAbove: 1000,
      }),
    ).toBe(999);
  });

  it('clamps to the last unloaded ordinal at/past the spacer end', () => {
    expect(
      mapScrollTopToOrdinal({
        scrollTop: 10_000,
        spacerAboveHeight: 10_000,
        unloadedRowsAbove: 1000,
      }),
    ).toBe(999);
  });

  it('negative scrollTop clamps to 0', () => {
    expect(
      mapScrollTopToOrdinal({
        scrollTop: -50,
        spacerAboveHeight: 10_000,
        unloadedRowsAbove: 1000,
      }),
    ).toBe(0);
  });

  it('degenerate inputs return 0', () => {
    expect(
      mapScrollTopToOrdinal({ scrollTop: 100, spacerAboveHeight: 0, unloadedRowsAbove: 10 }),
    ).toBe(0);
    expect(
      mapScrollTopToOrdinal({ scrollTop: 100, spacerAboveHeight: 1000, unloadedRowsAbove: 0 }),
    ).toBe(0);
  });
});

describe('splitUnloadedRows (dual-spacer extent split)', () => {
  it('serial-walk segments without a hole estimate fall back to all-above attribution', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 200,
        exhausted: false,
        startOrdinalEstimate: null,
        gapToTail: true,
      }),
    ).toEqual({ above: 800, below: 0 });
  });

  it('serial-walk segments split by the hole estimate (extent 2x-overestimate regression)', () => {
    // Mid-walk on a 1000-row conversation: 200 resident, the cap pruning has
    // moved 400 rows into the hole below the viewport. Attributing them
    // above used to double the above extent (800 instead of 400).
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 200,
        exhausted: false,
        startOrdinalEstimate: null,
        gapToTail: true,
        holeRowsEstimate: 400,
      }),
    ).toEqual({ above: 400, below: 400 });
  });

  it('a drifted hole estimate clamps to the unloaded count (never negative above)', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 900,
        exhausted: false,
        startOrdinalEstimate: null,
        gapToTail: true,
        holeRowsEstimate: 5000,
      }),
    ).toEqual({ above: 0, below: 100 });
  });

  it('serial-walk exhausted with an open hole puts the whole remainder below', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 300,
        exhausted: true,
        startOrdinalEstimate: null,
        gapToTail: true,
        holeRowsEstimate: 500,
      }),
    ).toEqual({ above: 0, below: 700 });
  });

  it('start ordinal wins over a hole estimate when both are present', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 300,
        exhausted: false,
        startOrdinalEstimate: 300,
        gapToTail: true,
        holeRowsEstimate: 650,
      }),
    ).toEqual({ above: 300, below: 400 });
  });

  it('closed gap keeps everything above even with a start ordinal', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 200,
        exhausted: false,
        startOrdinalEstimate: 800,
        gapToTail: false,
      }),
    ).toEqual({ above: 800, below: 0 });
  });

  it('seek-seeded segment splits above/below at the start ordinal', () => {
    // Segment seeded at ordinal 300 with 200 rows; 100 tail rows; 1000 total.
    // Unloaded = 700: 300 above the segment, 400 in the hole below.
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 300,
        exhausted: false,
        startOrdinalEstimate: 300,
        gapToTail: true,
      }),
    ).toEqual({ above: 300, below: 400 });
  });

  it('exhausted zeroes the above side exactly, remainder goes below', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 300,
        exhausted: true,
        startOrdinalEstimate: 0,
        gapToTail: true,
      }),
    ).toEqual({ above: 0, below: 700 });
  });

  it('all rows resident returns zeros', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 300,
        residentCount: 300,
        exhausted: false,
        startOrdinalEstimate: 100,
        gapToTail: true,
      }),
    ).toEqual({ above: 0, below: 0 });
  });

  it('overshooting start ordinal clamps to the unloaded count (never negative below)', () => {
    expect(
      splitUnloadedRows({
        totalMessages: 1000,
        residentCount: 900,
        exhausted: false,
        startOrdinalEstimate: 5000,
        gapToTail: true,
      }),
    ).toEqual({ above: 100, below: 0 });
  });
});

describe('estimateSeekLandingStartOrdinal (daemon page_window_around mirror)', () => {
  it('centers the page on the target (half budget older)', () => {
    expect(estimateSeekLandingStartOrdinal(500, 200, 1000)).toBe(400);
  });

  it('clamps at the oldest edge (page stays full)', () => {
    expect(estimateSeekLandingStartOrdinal(10, 200, 1000)).toBe(0);
  });

  it('clamps at the newest edge (page stays full)', () => {
    expect(estimateSeekLandingStartOrdinal(990, 200, 1000)).toBe(800);
  });

  it('short conversations start at 0', () => {
    expect(estimateSeekLandingStartOrdinal(50, 200, 120)).toBe(0);
    expect(estimateSeekLandingStartOrdinal(0, 200, 0)).toBe(0);
  });

  it('out-of-range targets clamp into the conversation', () => {
    expect(estimateSeekLandingStartOrdinal(5000, 200, 1000)).toBe(800);
    expect(estimateSeekLandingStartOrdinal(-5, 200, 1000)).toBe(0);
  });
});

describe('seekLandingScrollTop', () => {
  it('puts the target row roughly mid-viewport below the above-spacer', () => {
    expect(
      seekLandingScrollTop({
        spacerAboveHeight: 30_000,
        targetOrdinal: 500,
        startOrdinal: 400,
        rowHeight: 100,
        viewportHeight: 800,
      }),
    ).toBe(30_000 + 100 * 100 - 400);
  });

  it('floors at 0 for tiny extents', () => {
    expect(
      seekLandingScrollTop({
        spacerAboveHeight: 0,
        targetOrdinal: 1,
        startOrdinal: 0,
        rowHeight: 50,
        viewportHeight: 800,
      }),
    ).toBe(0);
  });
});

describe('reconcileVirtualSpacer with explicit unloadedRows (dual-spacer mode)', () => {
  const base = {
    totalMessages: 1000,
    residentCount: 300,
    exhausted: false,
    residentContentHeight: 30_000, // avg 100px/row
    currentSpacerHeight: 0,
    rowHeightEma: 100,
    viewportHeight: 800,
  };

  it('sizes from the explicit split instead of totalMessages - residentCount', () => {
    const result = reconcileVirtualSpacer({ ...base, unloadedRows: 250 });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(250 * 100);
  });

  it('explicit 0 unloaded rows zeroes the spacer exactly (boundary)', () => {
    const result = reconcileVirtualSpacer({
      ...base,
      currentSpacerHeight: 5000,
      unloadedRows: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(0);
    expect(result.scrollTopDelta).toBe(-5000);
  });

  it('omitted unloadedRows keeps the legacy derivation', () => {
    const result = reconcileVirtualSpacer(base);
    expect(result.applied).toBe(true);
    expect(result.spacerHeight).toBe(700 * 100);
  });
});
