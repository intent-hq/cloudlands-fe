/**
 * Regression tests for AgentCard streaming event isolation.
 *
 * Verifies that window-level streaming events (`agent:stream:<id>`) are
 * scoped per-agent so that streaming state for one agent never bleeds
 * into another agent's card — even when cards are mounted concurrently
 * or when the same card DOM is reused across workspace switches.
 */

import { describe, it, expect, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Dispatch a synthetic agent stream event on `window`. */
function emitStreamEvent(agentId: string, detail: { type: string; content?: string }) {
  window.dispatchEvent(
    new CustomEvent(`agent:stream:${agentId}`, { detail }),
  );
}

/** Dispatch a synthetic agent message-sent event on `window`. */
function emitMessageSent(agentId: string) {
  window.dispatchEvent(new CustomEvent(`agent:message-sent:${agentId}`));
}

/**
 * Minimal reproduction of the AgentCard streaming listener pattern.
 * Mirrors the `onMount` / `onDestroy` logic in AgentCard.svelte without
 * pulling in the full Svelte component tree (which requires heavy mocking).
 */
function createStreamListener(agentId: string) {
  let streamingBuffer = '';
  let isStreamActive = false;

  const streamEventName = `agent:stream:${agentId}`;
  const messageSentEventName = `agent:message-sent:${agentId}`;

  const streamListener = (event: Event) => {
    const { type, content } = (event as CustomEvent).detail || {};
    if (type === 'start') {
      isStreamActive = true;
    } else if (type === 'chunk' && content) {
      streamingBuffer += content;
      isStreamActive = true;
    } else if (type === 'end' || type === 'complete') {
      isStreamActive = false;
      streamingBuffer = '';
    } else if (type === 'error') {
      isStreamActive = false;
      streamingBuffer = '';
    }
  };

  const messageSentListener = () => {
    isStreamActive = true;
  };

  window.addEventListener(streamEventName, streamListener);
  window.addEventListener(messageSentEventName, messageSentListener);

  const cleanup = () => {
    window.removeEventListener(streamEventName, streamListener);
    window.removeEventListener(messageSentEventName, messageSentListener);
  };

  return {
    get buffer() { return streamingBuffer; },
    get active() { return isStreamActive; },
    cleanup,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentCard streaming event isolation', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  });

  it('stream events for agent-X do NOT affect agent-Y listener', () => {
    const listenerX = createStreamListener('agent-X');
    const listenerY = createStreamListener('agent-Y');
    cleanups.push(listenerX.cleanup, listenerY.cleanup);

    // Stream into agent-X
    emitStreamEvent('agent-X', { type: 'start' });
    emitStreamEvent('agent-X', { type: 'chunk', content: 'Hello from X' });

    expect(listenerX.active).toBe(true);
    expect(listenerX.buffer).toBe('Hello from X');

    // agent-Y must remain unaffected
    expect(listenerY.active).toBe(false);
    expect(listenerY.buffer).toBe('');
  });

  it('message-sent event for agent-X does NOT activate agent-Y', () => {
    const listenerX = createStreamListener('agent-X');
    const listenerY = createStreamListener('agent-Y');
    cleanups.push(listenerX.cleanup, listenerY.cleanup);

    emitMessageSent('agent-X');

    expect(listenerX.active).toBe(true);
    expect(listenerY.active).toBe(false);
  });

  it('cleanup removes listeners so late events are ignored', () => {
    const listener = createStreamListener('agent-Z');

    emitStreamEvent('agent-Z', { type: 'start' });
    expect(listener.active).toBe(true);

    // Simulate component unmount
    listener.cleanup();

    // Late event after cleanup should not change state
    // (the listener was removed, so the closure is unreachable)
    emitStreamEvent('agent-Z', { type: 'chunk', content: 'late' });
    // active is still true from the earlier 'start' — but buffer should NOT grow
    expect(listener.buffer).toBe('');
  });

  it('concurrent streams in two workspaces remain isolated', () => {
    // Simulate two AgentCards mounted for agents in different workspaces
    const wsAListener = createStreamListener('ws-a-agent-1');
    const wsBListener = createStreamListener('ws-b-agent-1');
    cleanups.push(wsAListener.cleanup, wsBListener.cleanup);

    // Both start streaming concurrently
    emitStreamEvent('ws-a-agent-1', { type: 'start' });
    emitStreamEvent('ws-b-agent-1', { type: 'start' });

    emitStreamEvent('ws-a-agent-1', { type: 'chunk', content: 'A-content' });
    emitStreamEvent('ws-b-agent-1', { type: 'chunk', content: 'B-content' });

    expect(wsAListener.buffer).toBe('A-content');
    expect(wsBListener.buffer).toBe('B-content');

    // Complete workspace-A, workspace-B keeps streaming
    emitStreamEvent('ws-a-agent-1', { type: 'end' });
    expect(wsAListener.active).toBe(false);
    expect(wsAListener.buffer).toBe('');
    expect(wsBListener.active).toBe(true);
    expect(wsBListener.buffer).toBe('B-content');

    // Complete workspace-B
    emitStreamEvent('ws-b-agent-1', { type: 'complete' });
    expect(wsBListener.active).toBe(false);
    expect(wsBListener.buffer).toBe('');
  });
});

