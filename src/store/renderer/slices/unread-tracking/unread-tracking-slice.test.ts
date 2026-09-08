import { describe, expect, it } from 'vitest';
import {
  initialState,
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
  startDividerSession,
  endDividerSession,
  recordWatchedStreamingTail,
  unreadTrackingReducer,
} from './unread-tracking-slice';
import type { UnreadTrackingState } from './unread-tracking-types';

const reduce = unreadTrackingReducer;

describe('unreadTrackingReducer', () => {
  it('should return initial state', () => {
    const state = reduce(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('markAgentAsViewed', () => {
    it('should set currentlyViewedAgentId', () => {
      const state = reduce(initialState, markAgentAsViewed('a1'));
      expect(state.currentlyViewedAgentId).toBe('a1');
    });

    it('should be no-op for empty agentId', () => {
      expect(reduce(initialState, markAgentAsViewed(''))).toBe(initialState);
    });

    it('should return same ref when already viewing same agent', () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: 'a1' };
      expect(reduce(before, markAgentAsViewed('a1'))).toBe(before);
    });
  });

  describe('clearCurrentlyViewedAgent', () => {
    it('should clear the currently viewed agent', () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: 'a1' };
      const state = reduce(before, clearCurrentlyViewedAgent());
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it('should be no-op when already null', () => {
      expect(reduce(initialState, clearCurrentlyViewedAgent())).toBe(initialState);
    });

    it('should clear when scoped to the currently viewed agent', () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: 'a1' };
      const state = reduce(before, clearCurrentlyViewedAgent('a1'));
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it('should be no-op when scoped to a different agent', () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: 'a1' };
      expect(reduce(before, clearCurrentlyViewedAgent('a2'))).toBe(before);
    });
  });

  describe('startDividerSession', () => {
    it('should latch an anchor for a new session', () => {
      const state = reduce(initialState, startDividerSession('a1', 'msg-5'));
      expect(state.dividerSessionByAgentId).toEqual({ a1: { anchorId: 'msg-5' } });
    });

    it('should latch a null anchor (session started, no divider)', () => {
      const state = reduce(initialState, startDividerSession('a1', null));
      expect(state.dividerSessionByAgentId).toEqual({ a1: { anchorId: null } });
    });

    it('should be first-write-wins: second start is a no-op', () => {
      const first = reduce(initialState, startDividerSession('a1', 'msg-5'));
      const second = reduce(first, startDividerSession('a1', 'msg-9'));
      expect(second).toBe(first);
      expect(second.dividerSessionByAgentId.a1).toEqual({ anchorId: 'msg-5' });
    });

    it('should not overwrite a latched null anchor', () => {
      const first = reduce(initialState, startDividerSession('a1', null));
      const second = reduce(first, startDividerSession('a1', 'msg-9'));
      expect(second).toBe(first);
    });

    it('should track sessions for multiple agents independently', () => {
      const one = reduce(initialState, startDividerSession('a1', 'msg-1'));
      const two = reduce(one, startDividerSession('a2', null));
      expect(two.dividerSessionByAgentId).toEqual({
        a1: { anchorId: 'msg-1' },
        a2: { anchorId: null },
      });
    });

    it('should be no-op for empty agentId', () => {
      expect(reduce(initialState, startDividerSession('', 'msg-1'))).toBe(initialState);
    });

    it('should suppress the anchor and consume the record when a watched streaming tail matches', () => {
      const withRecord = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      const state = reduce(withRecord, startDividerSession('a1', 'msg-5'));
      expect(state.dividerSessionByAgentId).toEqual({ a1: { anchorId: null } });
      expect(state.watchedStreamingTailByAgentId).toEqual({});
    });

    it("should consume (but not use) a stale watched streaming tail record that doesn't match the anchor", () => {
      const withRecord = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      const state = reduce(withRecord, startDividerSession('a1', 'msg-9'));
      expect(state.dividerSessionByAgentId).toEqual({ a1: { anchorId: 'msg-9' } });
      expect(state.watchedStreamingTailByAgentId).toEqual({});
    });

    it("should not touch an unrelated agent's watched streaming tail record", () => {
      const withRecord = reduce(initialState, recordWatchedStreamingTail('a2', 'msg-5'));
      const state = reduce(withRecord, startDividerSession('a1', 'msg-1'));
      expect(state.watchedStreamingTailByAgentId).toEqual({ a2: 'msg-5' });
    });
  });

  describe('endDividerSession', () => {
    it("should remove only that agent's session", () => {
      const one = reduce(initialState, startDividerSession('a1', 'msg-1'));
      const two = reduce(one, startDividerSession('a2', 'msg-2'));
      const state = reduce(two, endDividerSession('a1'));
      expect(state.dividerSessionByAgentId).toEqual({ a2: { anchorId: 'msg-2' } });
    });

    it('should be no-op when the agent has no session', () => {
      expect(reduce(initialState, endDividerSession('a1'))).toBe(initialState);
    });

    it('should allow a fresh latch after the session ended', () => {
      const started = reduce(initialState, startDividerSession('a1', 'msg-1'));
      const ended = reduce(started, endDividerSession('a1'));
      const restarted = reduce(ended, startDividerSession('a1', 'msg-9'));
      expect(restarted.dividerSessionByAgentId.a1).toEqual({ anchorId: 'msg-9' });
    });
  });

  describe('recordWatchedStreamingTail', () => {
    it('should record the watched streaming tail for an agent', () => {
      const state = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      expect(state.watchedStreamingTailByAgentId).toEqual({ a1: 'msg-5' });
    });

    it('should overwrite a previous record for the same agent', () => {
      const one = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      const two = reduce(one, recordWatchedStreamingTail('a1', 'msg-9'));
      expect(two.watchedStreamingTailByAgentId).toEqual({ a1: 'msg-9' });
    });

    it('should track records for multiple agents independently', () => {
      const one = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      const two = reduce(one, recordWatchedStreamingTail('a2', 'msg-9'));
      expect(two.watchedStreamingTailByAgentId).toEqual({ a1: 'msg-5', a2: 'msg-9' });
    });

    it('should be no-op for empty agentId', () => {
      expect(reduce(initialState, recordWatchedStreamingTail('', 'msg-1'))).toBe(initialState);
    });

    it('should be no-op for empty messageId', () => {
      expect(reduce(initialState, recordWatchedStreamingTail('a1', ''))).toBe(initialState);
    });

    it('should be no-op when the same record already exists', () => {
      const one = reduce(initialState, recordWatchedStreamingTail('a1', 'msg-5'));
      expect(reduce(one, recordWatchedStreamingTail('a1', 'msg-5'))).toBe(one);
    });
  });
});
