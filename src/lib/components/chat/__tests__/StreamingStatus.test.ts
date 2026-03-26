import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatDuration,
  computeCompletedEvents,
  shouldAppendStreamingEvent,
  type StatusEvent,
} from '../streaming-status-utils';

describe('StreamingStatus utilities', () => {
  describe('formatDuration', () => {
    it('formats sub-10s with non-zero decimal', () => {
      expect(formatDuration(2300)).toBe('2.3s');
      expect(formatDuration(5700)).toBe('5.7s');
      expect(formatDuration(100)).toBe('0.1s');
    });

    it('formats sub-10s with zero decimal as whole number', () => {
      expect(formatDuration(2000)).toBe('2s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(0)).toBe('0s');
    });

    it('formats >=10s as whole number', () => {
      expect(formatDuration(10000)).toBe('10s');
      expect(formatDuration(15400)).toBe('15s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('formats minutes correctly', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(120000)).toBe('2m 0s');
      expect(formatDuration(3540000)).toBe('59m 0s');
    });

    it('formats hours correctly', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(3661000)).toBe('1h 1m 1s');
      expect(formatDuration(7322000)).toBe('2h 2m 2s');
    });
  });

  describe('computeCompletedEvents', () => {
    const makeEvent = (
      phase: string,
      message: string,
      timestamp: number,
      level: 'info' | 'warn' | 'error' = 'info',
    ) => ({ phase, message, level, timestamp });

    it('returns empty for no events', () => {
      expect(computeCompletedEvents([], false, Date.now())).toEqual([]);
      expect(computeCompletedEvents([], true, Date.now())).toEqual([]);
    });

    it('returns empty for single event in pre-chunk mode (latest excluded)', () => {
      const events = [makeEvent('launch', 'Launching…', 1000)];
      expect(computeCompletedEvents(events, false, 5000)).toEqual([]);
    });

    it('returns single event in post-chunk mode (latest included)', () => {
      const events = [makeEvent('launch', 'Launching…', 1000)];
      const result = computeCompletedEvents(events, true, 3000);
      expect(result).toHaveLength(1);
      expect(result[0].event.message).toBe('Launching…');
      expect(result[0].duration).toBe('2s');
    });

    it('computes durations between consecutive events', () => {
      const events = [
        makeEvent('launch', 'Launching…', 1000),
        makeEvent('init', 'Initializing…', 3500),
        makeEvent('prompt', 'Sent prompt…', 5000),
      ];
      // Pre-chunk mode: exclude latest (prompt), show launch and init
      const result = computeCompletedEvents(events, false, 8000);
      expect(result).toHaveLength(2);
      // Reversed order (newest first)
      expect(result[0].event.message).toBe('Initializing…');
      expect(result[0].duration).toBe('1.5s');
      expect(result[1].event.message).toBe('Launching…');
      expect(result[1].duration).toBe('2.5s');
    });

    it('uses fallbackEndTime for last event in post-chunk mode', () => {
      const events = [
        makeEvent('launch', 'Launching…', 1000),
        makeEvent('prompt', 'Sent prompt…', 3000),
      ];
      const result = computeCompletedEvents(events, true, 15000);
      expect(result).toHaveLength(2);
      // Last event duration uses fallbackEndTime
      expect(result[0].event.message).toBe('Sent prompt…');
      expect(result[0].duration).toBe('12s'); // 15000 - 3000
    });

    it('preserves warn/error levels', () => {
      const events = [
        makeEvent('mcp-init', 'Waiting…', 1000),
        makeEvent('mcp-error', 'MCP failed', 3000, 'warn'),
        makeEvent('prompt', 'Sent prompt…', 4000),
      ];
      const result = computeCompletedEvents(events, false, 6000);
      expect(result[0].event.level).toBe('warn');
    });
  });

  describe('shouldAppendStreamingEvent', () => {
    const makeEvent = (
      phase: string,
      timestamp = 1000,
      level: 'info' | 'warn' | 'error' = 'info',
    ): StatusEvent => ({ phase, message: `${phase} msg`, level, timestamp });

    it('returns true on first chunk with status events, no streaming event, no tool phase', () => {
      const events = [makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns false when receivedFirstChunk is already true (not first chunk)', () => {
      const events = [makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(true, events)).toBe(false);
    });

    it('returns false when statusEvents is empty', () => {
      expect(shouldAppendStreamingEvent(false, [])).toBe(false);
    });

    it('returns false when latest event is already streaming (consecutive dedup)', () => {
      const events = [makeEvent('prompt'), makeEvent('streaming')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(false);
    });

    it('returns true when latest event has phase tool-call (transition allowed)', () => {
      const events = [makeEvent('prompt'), makeEvent('tool-call')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true when latest event has phase tool-waiting (transition allowed)', () => {
      const events = [makeEvent('prompt'), makeEvent('tool-waiting')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true when latest event has phase prompt (non-tool phase)', () => {
      const events = [makeEvent('launch'), makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true even when earlier events contain streaming (only latest matters)', () => {
      const events = [makeEvent('streaming'), makeEvent('tool-call')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });
  });

  describe('tool→streaming lifecycle (state transitions)', () => {
    it('full lifecycle: streaming → tool-call → tool-waiting → streaming again', () => {
      // Phase 1: Initial text chunk (receivedFirstChunk=false, has prompt event)
      const initialEvents: StatusEvent[] = [{ phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 }];
      expect(shouldAppendStreamingEvent(false, initialEvents)).toBe(true);
      // After first chunk: receivedFirstChunk=true, events include streaming

      // Phase 2: More text chunks (receivedFirstChunk=true) — no more streaming events
      const afterFirstChunk: StatusEvent[] = [...initialEvents, { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 }];
      expect(shouldAppendStreamingEvent(true, afterFirstChunk)).toBe(false);

      // Phase 3: Tool-call arrives — receivedFirstChunk reset to false by status handler
      const afterToolCall: StatusEvent[] = [...afterFirstChunk, { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 3000 }];
      // receivedFirstChunk is now false (reset by status handler)
      expect(shouldAppendStreamingEvent(false, afterToolCall)).toBe(true);

      // Phase 4: Tool-waiting arrives — receivedFirstChunk stays false
      const afterToolWaiting: StatusEvent[] = [...afterToolCall, { phase: 'tool-waiting', message: 'Awaiting tool response', level: 'info', timestamp: 4000 }];
      expect(shouldAppendStreamingEvent(false, afterToolWaiting)).toBe(true);

      // Phase 5: Text resumes after tool — streaming event appended
      const afterToolComplete: StatusEvent[] = [...afterToolWaiting, { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 5000 }];
      // After this chunk: receivedFirstChunk=true again
      expect(shouldAppendStreamingEvent(true, afterToolComplete)).toBe(false);
    });

    it('multiple tool cycles produce correct streaming transitions', () => {
      const events: StatusEvent[] = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 },
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 3000 },
        { phase: 'tool-waiting', message: 'Awaiting tool response', level: 'info', timestamp: 4000 },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 5000 },
        // Second tool cycle
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 6000 },
        { phase: 'tool-waiting', message: 'Awaiting tool response', level: 'info', timestamp: 7000 },
      ];
      // After second tool-waiting, receivedFirstChunk is false (reset by status handler)
      // Should allow streaming transition
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('receivedFirstChunk is NOT reset for non-tool status phases', () => {
      // Simulate: prompt status arrives while receivedFirstChunk=true
      // The status handler should NOT reset receivedFirstChunk for non-tool phases
      const events: StatusEvent[] = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 },
      ];
      // receivedFirstChunk stays true for non-tool phases
      expect(shouldAppendStreamingEvent(true, events)).toBe(false);
    });
  });

  describe('Cross-session status event isolation', () => {
    const listeners: Array<{ event: string; handler: EventListener }> = [];

    function addTrackedListener(eventName: string, handler: EventListener) {
      window.addEventListener(eventName, handler);
      listeners.push({ event: eventName, handler });
    }

    afterEach(() => {
      for (const { event, handler } of listeners) {
        window.removeEventListener(event, handler);
      }
      listeners.length = 0;
    });

    function makeStatusDetail() {
      return {
        type: 'status',
        statusData: {
          phase: 'tool-call',
          message: 'Calling tool',
          level: 'info',
          timestamp: Date.now(),
        },
      };
    }

    it('status events for a different session ID are not added to statusEvents', () => {
      // Simulate the ChatService pattern: a Map of stream handlers keyed by sessionId
      const streamHandlers = new Map<string, (data: unknown) => void>();
      const statusEventsA: unknown[] = [];

      // Register handler only for session-A
      streamHandlers.set('session-A', (data) => {
        statusEventsA.push(data);
      });

      // Simulate handleStreamEvent for session-B (no handler registered)
      const incomingSessionId = 'session-B';
      if (streamHandlers.has(incomingSessionId)) {
        streamHandlers.get(incomingSessionId)!(makeStatusDetail());
      }

      // session-A's statusEvents should remain empty
      expect(statusEventsA).toHaveLength(0);
    });

    it('DOM events dispatched on a different session channel are not received', () => {
      const handlerA = vi.fn();

      // Listen on session-A's channel
      addTrackedListener('agent:stream:session-A', handlerA);

      // Dispatch event on session-B's channel
      window.dispatchEvent(
        new CustomEvent('agent:stream:session-B', { detail: makeStatusDetail() }),
      );

      // session-A's listener should NOT have been called
      expect(handlerA).not.toHaveBeenCalled();
    });

    it('only the matching session receives status events when multiple sessions exist', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      // Listen on both session channels
      addTrackedListener('agent:stream:session-A', handlerA);
      addTrackedListener('agent:stream:session-B', handlerB);

      // Dispatch event only for session-A
      const detail = makeStatusDetail();
      window.dispatchEvent(new CustomEvent('agent:stream:session-A', { detail }));

      // Only session-A's listener should have been called
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).not.toHaveBeenCalled();

      // Verify the received detail matches
      const receivedDetail = handlerA.mock.calls[0][0] as CustomEvent;
      expect(receivedDetail.detail).toEqual(detail);
    });
  });
});
