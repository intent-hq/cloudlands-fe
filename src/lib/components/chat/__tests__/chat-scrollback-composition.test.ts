import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '$shared/types';
import {
  composeTranscript,
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
});

describe('shouldRequestOlderHistory', () => {
  const base = {
    scrollTop: 100,
    threshold: 240,
    canScroll: true,
    fetching: false,
    exhausted: false,
    historyCount: 0,
    tailTruncated: true,
  };

  it('fires near the top when older rows exist beyond the tail', () => {
    expect(shouldRequestOlderHistory(base)).toBe(true);
  });

  it('fires when history rows are already hydrated even if the tail flag is stale', () => {
    expect(
      shouldRequestOlderHistory({ ...base, tailTruncated: false, historyCount: 5 }),
    ).toBe(true);
  });

  it('never fires for short conversations (no history, tail not truncated)', () => {
    expect(shouldRequestOlderHistory({ ...base, tailTruncated: false })).toBe(false);
  });

  it('does not fire away from the top, while unscrollable, fetching, or exhausted', () => {
    expect(shouldRequestOlderHistory({ ...base, scrollTop: 500 })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, canScroll: false })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, fetching: true })).toBe(false);
    expect(shouldRequestOlderHistory({ ...base, exhausted: true })).toBe(false);
  });
});
