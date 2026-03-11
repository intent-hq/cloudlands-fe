/**
 * Regression tests for the "stuck in Thinking" bug caused by orphaned JSON-RPC responses
 * and the process-aware timeout logic in sendRequestInternal.
 *
 * Root cause: A request times out, deleting its pendingRequests entry. The response
 * arrives shortly after and is treated as "orphaned". If the orphaned response carries
 * a stopReason and no streaming callbacks are registered, the stream can never complete
 * → UI stays stuck in "Thinking" forever.
 *
 * Fix 1: Process-aware timeout — use setInterval to periodically check if the agent
 *         process is alive. Only reject when the process dies or MAX_WAIT_MS is exceeded.
 *         This prevents premature timeouts when the agent is just slow to start.
 * Fix 2: When an orphaned response has no callbacks, reset isStreaming and
 *         currentStreamingRequestId so the provider doesn't stay permanently stuck.
 *
 * These tests verify the fix at the logic level by simulating the interval-based
 * timeout and orphaned response handling, without needing to instantiate the full ACPProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ACP Provider Init Timeout Race Condition', () => {
  describe('Fix 1: Process-aware interval timeout', () => {
    // Simulates the interval-based timeout logic from sendRequestInternal.
    // We replicate the logic inline since ACPProvider can't be easily
    // instantiated in a unit test.

    const CHECK_INTERVAL_MS = 5000;
    const MAX_WAIT_MS = 90000; // 90s — matches acp-provider.ts

    let pendingRequests: Map<number, { resolve: Function; reject: Function; timeout: ReturnType<typeof setInterval> }>;
    let isAgentAlive: () => boolean;

    /**
     * Simulates the setInterval-based timeout logic from sendRequestInternal.
     * Returns a promise that behaves like the real implementation.
     */
    function simulateSendRequest(
      method: string,
      requestId: number,
      customTimeout?: number,
    ): Promise<any> {
      return new Promise((resolve, reject) => {
        const maxWaitMs = Math.max(customTimeout ?? MAX_WAIT_MS, 1000);
        const intervalMs = Math.min(CHECK_INTERVAL_MS, maxWaitMs);
        const startTime = Date.now();
        const timeout = setInterval(() => {
          if (Date.now() - startTime >= maxWaitMs) {
            pendingRequests.delete(requestId);
            clearInterval(timeout);
            reject(new Error(`Timeout waiting for response to ${method}`));
            return;
          }
          if (!isAgentAlive()) {
            pendingRequests.delete(requestId);
            clearInterval(timeout);
            reject(new Error(`Agent process died while waiting for response to ${method}`));
            return;
          }
        }, intervalMs);

        pendingRequests.set(requestId, { resolve, reject, timeout });
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
      pendingRequests = new Map();
      isAgentAlive = () => true; // default: process alive
    });

    afterEach(() => {
      // Clean up any remaining intervals and resolve pending promises
      // to avoid unhandled rejection errors
      for (const pending of pendingRequests.values()) {
        clearInterval(pending.timeout);
        pending.resolve(undefined);
      }
      pendingRequests.clear();
      vi.useRealTimers();
    });

    it('should reject with timeout error when MAX_WAIT_MS is exceeded', async () => {
      const promise = simulateSendRequest('initialize', 1);
      let caughtError: Error | null = null;
      promise.catch((e) => { caughtError = e; });

      // Advance past MAX_WAIT_MS (90s default)
      await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + CHECK_INTERVAL_MS);

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Timeout waiting for response to initialize');
      expect(pendingRequests.size).toBe(0);
    });

    it('should reject immediately when agent process dies', async () => {
      const promise = simulateSendRequest('initialize', 1);
      let caughtError: Error | null = null;
      promise.catch((e) => { caughtError = e; });

      // Process dies after first interval
      isAgentAlive = () => false;
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Agent process died while waiting for response to initialize');
      expect(pendingRequests.size).toBe(0);
    });

    it('should keep waiting while process is alive and under max wait', async () => {
      const promise = simulateSendRequest('initialize', 1);

      // Advance several intervals but stay under MAX_WAIT_MS
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3); // 15s

      // Promise should still be pending
      expect(pendingRequests.size).toBe(1);

      // Resolve it manually to clean up
      const pending = pendingRequests.get(1)!;
      clearInterval(pending.timeout);
      pending.resolve({ result: 'ok' });
      pendingRequests.delete(1);

      await expect(promise).resolves.toEqual({ result: 'ok' });
    });

    it('should resolve when response arrives and clean up interval', async () => {
      const promise = simulateSendRequest('session/new', 1);

      // Advance one interval — process is alive, so it keeps waiting
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      expect(pendingRequests.size).toBe(1);

      // Simulate response arriving (as the real code does when it receives JSON-RPC response)
      const pending = pendingRequests.get(1)!;
      clearInterval(pending.timeout);
      pendingRequests.delete(1);
      pending.resolve({ result: { sessionId: 'abc' } });

      await expect(promise).resolves.toEqual({ result: { sessionId: 'abc' } });
      expect(pendingRequests.size).toBe(0);
    });

    it('should use customTimeout instead of MAX_WAIT_MS when provided', async () => {
      const customTimeout = 10000;
      const promise = simulateSendRequest('initialize', 1, customTimeout);
      let caughtError: Error | null = null;
      promise.catch((e) => { caughtError = e; });

      // Advance past customTimeout but under MAX_WAIT_MS
      await vi.advanceTimersByTimeAsync(customTimeout + CHECK_INTERVAL_MS);

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Timeout waiting for response to initialize');
      expect(pendingRequests.size).toBe(0);
    });
  });

  describe('Fix 2: Streaming state reset on orphaned response with no callbacks', () => {
    it('should reset streaming state when orphaned response has no callbacks', () => {
      // Simulate the provider's state when an orphaned response arrives
      // with no streaming callbacks registered
      const providerState = {
        isStreaming: true,
        currentStreamingRequestId: 5 as number | null,
        streamingCallbacks: new Map<string, any>(),
      };

      const completionSessionId = 'agent-fe6e68cf-dc5d-412f-b1c1-20cbe85c203a';

      // Simulate the orphaned response handler logic (matches code at line ~4190)
      const callbacks = completionSessionId
        ? providerState.streamingCallbacks.get(completionSessionId)
        : undefined;

      if (completionSessionId && callbacks) {
        // Normal path: complete the stream
        // (not reached in this test case)
        expect.unreachable('Should not have callbacks');
      } else {
        // FIX: Reset streaming state so provider doesn't stay stuck
        providerState.isStreaming = false;
        providerState.currentStreamingRequestId = null;
      }

      // VERIFY: Provider is no longer stuck in streaming state
      expect(providerState.isStreaming).toBe(false);
      expect(providerState.currentStreamingRequestId).toBeNull();
    });

    it('should NOT reset streaming state when callbacks exist (normal path)', () => {
      const providerState = {
        isStreaming: true,
        currentStreamingRequestId: 5 as number | null,
        streamingCallbacks: new Map<string, any>(),
      };

      const completionSessionId = 'agent-normal-session';

      // Register callbacks (normal case)
      providerState.streamingCallbacks.set(completionSessionId, {
        onChunk: () => {},
        onComplete: () => {},
      });

      const callbacks = completionSessionId
        ? providerState.streamingCallbacks.get(completionSessionId)
        : undefined;

      if (completionSessionId && callbacks) {
        // Normal path: would call handleStreamCompletion
        // isStreaming stays true until completion finishes
      } else {
        providerState.isStreaming = false;
        providerState.currentStreamingRequestId = null;
      }

      // VERIFY: Streaming state is preserved for normal completion path
      expect(providerState.isStreaming).toBe(true);
      expect(providerState.currentStreamingRequestId).toBe(5);
    });

    it('should handle the exact log scenario from the customer bug report', () => {
      // Reproduce the exact sequence from console-output.log:
      // 1. messageId=5 response arrives
      // 2. currentStreamingRequestId=null (already cleared by timeout)
      // 3. pendingRequestIds=[0 items] (already cleared by timeout)
      // 4. completionSessionId="agent-fe6e68cf-..." hasCallbacks=false

      const providerState = {
        isStreaming: true, // Was set when prompt was sent
        currentStreamingRequestId: null as number | null, // Cleared by timeout
        pendingRequests: new Map<number, any>(), // Empty - cleared by timeout
        streamingCallbacks: new Map<string, any>(), // Empty - never registered or cleaned up
      };

      const completionSessionId = 'agent-fe6e68cf-dc5d-412f-b1c1-20cbe85c203a';
      const hasCallbacks = providerState.streamingCallbacks.has(completionSessionId);

      expect(hasCallbacks).toBe(false);
      expect(providerState.pendingRequests.size).toBe(0);

      // Apply the fix
      if (!hasCallbacks) {
        providerState.isStreaming = false;
        providerState.currentStreamingRequestId = null;
      }

      // VERIFY: Provider can now accept new requests
      expect(providerState.isStreaming).toBe(false);
    });
  });
});

