import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '$shared/types';
import {
  composeTranscript,
  isConversationStartLoaded,
  shouldChainOlderHistoryOnSettle,
  shouldRequestOlderHistory,
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
