/**
 * @vitest-environment jsdom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/svelte';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faRotateRight: { iconName: 'rotate-right' },
}));

import StreamingStatus from '../StreamingStatus.svelte';
import {
  formatDuration,
  computeCompletedEvents,
  shouldAppendStreamingEvent,
  type StatusEvent,
} from '../streaming-status-utils';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StreamingStatus rendered UI', () => {
  it('renders explicit failed response copy, alert semantics, and retry action for inactive errors', async () => {
    const onRetry = vi.fn();
    const { container } = render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
        onRetry,
      },
    });

    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.getByTestId('error-message').textContent).toBe('Stream timeout after 10 minutes');
    expect(container.firstElementChild?.className).toContain('bg-destructive/10');

    await fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps terminal failure visible even if a stale permission request flag remains set', () => {
    render(StreamingStatus, {
      props: {
        error: 'The agent response timed out before it finished.',
        hasPendingPermission: true,
      },
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
  });

  it('shows failure copy without retry while active flags are still clearing', () => {
    const onRetry = vi.fn();
    render(StreamingStatus, {
      props: {
        isStreaming: true,
        error: 'Provider crashed while finalizing the stream',
        onRetry,
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('prioritizes model-unavailable recovery over generic failure copy', async () => {
    const onRetryWithModel = vi.fn();
    const { container } = render(StreamingStatus, {
      props: {
        error: 'Model failed to start',
        modelUnavailable: {
          failedModel: 'gpt5.5',
          nextAvailableModel: 'gpt5.5-fast',
        },
        onRetryWithModel,
      },
    });

    expect(screen.queryByTestId('error-title')).toBeNull();
    expect(container.textContent).toContain('gpt5.5');
    expect(container.textContent).toContain('is not available');

    await fireEvent.click(screen.getByRole('button', { name: /retry with gpt5\.5-fast/i }));
    expect(onRetryWithModel).toHaveBeenCalledWith('gpt5.5-fast');
  });

  it('clears failed presentation when a new stream starts', async () => {
    const { rerender } = render(StreamingStatus, {
      props: {
        error: 'Previous response failed',
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');

    await rerender({
      error: null,
      isProcessing: true,
      seed: 'agent-1',
    });

    expect(screen.queryByTestId('error-title')).toBeNull();
    expect(screen.getByTestId('streaming-status-thinking').textContent).toBe('Thinking');
  });
});

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
});
