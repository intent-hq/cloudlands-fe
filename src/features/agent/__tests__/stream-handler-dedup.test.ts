/**
 * Stream Handler Deduplication Tests
 *
 * Regression tests for the race condition where `agent:stream-starting` global
 * listener creates a duplicate IPC handler while sendMessage() is in the middle
 * of cleaning up and re-registering its own handler.
 *
 * The fix uses a `sendMessageStreamSetup` Set to signal that sendMessage() owns
 * the handler lifecycle for a given agentId, so the global listener skips
 * ensureStreamHandler() during that window.
 *
 * Bug: Electron-initiated messages get doubled text because both the sendMessage
 * handler and the agent:stream-starting handler register IPC listeners that
 * dispatch DOM events for the same stream chunks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Stream Handler Deduplication (sendMessageStreamSetup guard)', () => {
  // Simulate the core data structures from RefactoredAgentService
  let activeStreamHandlers: Map<string, { channel: string; listenerId?: string }>;
  let sendMessageStreamSetup: Set<string>;
  let pendingStreamRegistrations: Set<string>;
  let ensureStreamHandlerCalls: Array<{ agentId: string; workspaceId?: string }>;

  // Simulates ensureStreamHandler — records calls and adds to activeStreamHandlers
  function ensureStreamHandler(
    agentId: string,
    opts?: { workspaceId?: string },
  ): { created: boolean; channel: string } {
    const streamChannel = `agent:stream:${agentId}`;
    if (activeStreamHandlers.has(agentId)) {
      return { created: false, channel: streamChannel };
    }
    ensureStreamHandlerCalls.push({ agentId, workspaceId: opts?.workspaceId });
    activeStreamHandlers.set(agentId, { channel: streamChannel, listenerId: `lid-${agentId}` });
    return { created: true, channel: streamChannel };
  }

  // Simulates the agent:stream-starting global listener (with the fix)
  function handleStreamStarting(data: { agentId: string; workspaceId?: string }) {
    const { agentId, workspaceId } = data;
    // FIX: skip if sendMessage is setting up the handler
    if (sendMessageStreamSetup.has(agentId)) {
      return; // skipped
    }
    ensureStreamHandler(agentId, { workspaceId });
  }

  // Simulates the sendMessage cleanup + registration window (with the fix)
  function simulateSendMessageStreamSetup(agentId: string, workspaceId: string) {
    const streamChannel = `agent:stream:${agentId}`;

    // Step 1: Mark as being set up
    sendMessageStreamSetup.add(agentId);

    // Step 2: Clean up existing handler (the gap where the bug occurs)
    activeStreamHandlers.delete(agentId);
    pendingStreamRegistrations.delete(agentId);

    // Step 3: Register new handler
    activeStreamHandlers.set(agentId, {
      channel: streamChannel,
      listenerId: `new-lid-${agentId}`,
    });

    // Step 4: Clear the guard
    sendMessageStreamSetup.delete(agentId);
  }

  beforeEach(() => {
    activeStreamHandlers = new Map();
    sendMessageStreamSetup = new Set();
    pendingStreamRegistrations = new Set();
    ensureStreamHandlerCalls = [];
  });

  it('should block ensureStreamHandler during sendMessage setup window', () => {
    const agentId = 'agent-1';

    // Pre-existing handler
    activeStreamHandlers.set(agentId, { channel: `agent:stream:${agentId}`, listenerId: 'old' });

    // sendMessage marks the agent
    sendMessageStreamSetup.add(agentId);

    // sendMessage deletes old handler (the vulnerable gap)
    activeStreamHandlers.delete(agentId);

    // agent:stream-starting fires during the gap
    handleStreamStarting({ agentId, workspaceId: 'ws-1' });

    // ensureStreamHandler should NOT have been called
    expect(ensureStreamHandlerCalls).toHaveLength(0);
    // No handler should exist yet (sendMessage hasn't registered its new one)
    expect(activeStreamHandlers.has(agentId)).toBe(false);
  });

  it('should allow ensureStreamHandler after sendMessage completes setup', () => {
    const agentId = 'agent-2';

    // Full sendMessage cycle
    simulateSendMessageStreamSetup(agentId, 'ws-1');

    // Now agent:stream-starting fires — guard is cleared, handler already exists
    handleStreamStarting({ agentId, workspaceId: 'ws-1' });

    // ensureStreamHandler was not called because handler already exists (idempotent)
    expect(ensureStreamHandlerCalls).toHaveLength(0);
    expect(activeStreamHandlers.has(agentId)).toBe(true);
  });

  it('should not affect other agents during sendMessage setup', () => {
    const agentA = 'agent-a';
    const agentB = 'agent-b';

    // sendMessage is setting up agent-a
    sendMessageStreamSetup.add(agentA);

    // agent:stream-starting fires for agent-b (different agent)
    handleStreamStarting({ agentId: agentB, workspaceId: 'ws-1' });

    // agent-b should get a handler
    expect(ensureStreamHandlerCalls).toHaveLength(1);
    expect(ensureStreamHandlerCalls[0].agentId).toBe(agentB);
    expect(activeStreamHandlers.has(agentB)).toBe(true);

    // agent-a should still be blocked
    handleStreamStarting({ agentId: agentA, workspaceId: 'ws-1' });
    expect(ensureStreamHandlerCalls).toHaveLength(1); // no new calls
  });

  it('should clear guard on error so future streams are not permanently blocked', () => {
    const agentId = 'agent-err';

    // Simulate sendMessage hitting an error after marking the guard
    sendMessageStreamSetup.add(agentId);
    activeStreamHandlers.delete(agentId);

    // Simulate catch block clearing the guard
    sendMessageStreamSetup.delete(agentId);

    // Now agent:stream-starting should work
    handleStreamStarting({ agentId, workspaceId: 'ws-1' });
    expect(ensureStreamHandlerCalls).toHaveLength(1);
    expect(activeStreamHandlers.has(agentId)).toBe(true);
  });

  it('should result in exactly one handler after race (no duplicates)', () => {
    const agentId = 'agent-race';
    let handlerCount = 0;

    // Override to count registrations
    const origSet = activeStreamHandlers.set.bind(activeStreamHandlers);
    activeStreamHandlers.set = (key, value) => {
      if (key === agentId) handlerCount++;
      return origSet(key, value);
    };

    // Full sendMessage cycle with stream-starting firing during the gap
    sendMessageStreamSetup.add(agentId);
    activeStreamHandlers.delete(agentId);

    // stream-starting fires during gap — should be blocked
    handleStreamStarting({ agentId, workspaceId: 'ws-1' });

    // sendMessage registers its handler
    activeStreamHandlers.set(agentId, {
      channel: `agent:stream:${agentId}`,
      listenerId: 'sendmsg-lid',
    });
    sendMessageStreamSetup.delete(agentId);

    // Only ONE handler registration should have occurred
    expect(handlerCount).toBe(1);
    expect(activeStreamHandlers.get(agentId)?.listenerId).toBe('sendmsg-lid');
  });
});

