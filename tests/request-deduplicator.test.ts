import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestDeduplicator } from '../src/features/agent/browser/services/request-deduplicator.service';
import {
  mockInvoke,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '../src/shared/ipc-mock-router';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new (RequestDeduplicator as any)();
  });

  afterEach(() => {
    deduplicator.dispose();
  });

  describe('In-flight Deduplication', () => {
    it('should deduplicate concurrent identical requests', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `result-${callCount}`;
      };

      // Make three concurrent requests with the same key
      const promises = [
        deduplicator.deduplicate('test-key', operation),
        deduplicator.deduplicate('test-key', operation),
        deduplicator.deduplicate('test-key', operation),
      ];

      const results = await Promise.all(promises);

      // Should only call operation once — all three share the pending promise
      expect(callCount).toBe(1);
      expect(results).toEqual(['result-1', 'result-1', 'result-1']);
    });

    it('should not deduplicate requests with different keys', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      const results = await Promise.all([
        deduplicator.deduplicate('key-1', operation),
        deduplicator.deduplicate('key-2', operation),
        deduplicator.deduplicate('key-3', operation),
      ]);

      expect(callCount).toBe(3);
      expect(results).toEqual(['result-1', 'result-2', 'result-3']);
    });

    it('should issue a fresh request after the prior one resolved', async () => {
      // Audit-P0-1 invariant: no completed-result caching. A call made AFTER
      // the prior one resolved must re-execute the operation, not replay a
      // stale cached value.
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      const result1 = await deduplicator.deduplicate('sequential-key', operation);
      expect(result1).toBe('result-1');
      expect(callCount).toBe(1);

      const result2 = await deduplicator.deduplicate('sequential-key', operation);
      expect(result2).toBe('result-2');
      expect(callCount).toBe(2);

      const result3 = await deduplicator.deduplicate('sequential-key', operation);
      expect(result3).toBe('result-3');
      expect(callCount).toBe(3);
    });

    it('should not deduplicate after the in-flight promise rejected', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount === 1) throw new Error('first-failed');
        return `success-${callCount}`;
      };

      await expect(deduplicator.deduplicate('post-error', operation)).rejects.toThrow(
        'first-failed',
      );

      const result = await deduplicator.deduplicate('post-error', operation);
      expect(result).toBe('success-2');
      expect(callCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors to all waiting requests', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('Operation failed');
      };

      // Concurrent requests share the same in-flight promise
      const promises = [
        deduplicator.deduplicate('error-broadcast', operation),
        deduplicator.deduplicate('error-broadcast', operation),
        deduplicator.deduplicate('error-broadcast', operation),
      ];

      await expect(Promise.all(promises)).rejects.toThrow('Operation failed');
    });
  });

  describe('Key Generation', () => {
    it('should generate unique keys for agent creation', () => {
      const key1 = RequestDeduplicator.generateAgentCreationKey('workspace-1', {
        name: 'Agent 1',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
      });

      const key2 = RequestDeduplicator.generateAgentCreationKey('workspace-1', {
        name: 'Agent 2',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
      });

      expect(key1).not.toBe(key2);
      expect(key1).toContain('workspace-1');
      expect(key1).toContain('Agent 1');
    });

    it('should generate unique keys for messages', () => {
      const key1 = RequestDeduplicator.generateMessageKey('agent-1', 'Hello world', [
        { type: 'file', path: '/test.js' },
      ]);

      const key2 = RequestDeduplicator.generateMessageKey('agent-1', 'Hello world', [
        { type: 'file', path: '/other.js' },
      ]);

      expect(key1).not.toBe(key2);
      expect(key1).toContain('agent-1');
      expect(key1).toContain('Hello world');
    });

    it('should generate unique keys for session operations', () => {
      const key1 = RequestDeduplicator.generateSessionKey('create', 'agent-1', 'workspace-1');
      const key2 = RequestDeduplicator.generateSessionKey('resume', 'agent-1', 'workspace-1');

      expect(key1).not.toBe(key2);
      expect(key1).toContain('create');
      expect(key2).toContain('resume');
    });
  });

  describe('In-flight Clearing', () => {
    it('should drop an in-flight request when clearKey is called', async () => {
      let resolveOp: ((value: string) => void) | undefined;
      const operation = () =>
        new Promise<string>((resolve) => {
          resolveOp = resolve;
        });

      const promise = deduplicator.deduplicate('clear-key', operation);
      expect(deduplicator.getStats().pendingCount).toBe(1);

      deduplicator.clearKey('clear-key');
      expect(deduplicator.getStats().pendingCount).toBe(0);

      // Original promise is still alive (the operation was never cancelled),
      // it just no longer participates in dedup. Settle it to avoid leaks.
      resolveOp?.('settled');
      await expect(promise).resolves.toBe('settled');
    });

    it('should drop in-flight requests for an agent on clearKeysForAgent', async () => {
      const make = () => new Promise<string>(() => {}); // never resolves

      deduplicator.deduplicate('message:agent-1:hello:', make);
      deduplicator.deduplicate('session:create::agent-1', make);
      deduplicator.deduplicate('message:agent-2:hi:', make);
      expect(deduplicator.getStats().pendingCount).toBe(3);

      deduplicator.clearKeysForAgent('agent-1');
      expect(deduplicator.getStats().pendingCount).toBe(1);
    });

    it('should drop all in-flight requests on clearAll', () => {
      const make = () => new Promise<string>(() => {});
      deduplicator.deduplicate('a', make);
      deduplicator.deduplicate('b', make);
      expect(deduplicator.getStats().pendingCount).toBe(2);

      deduplicator.clearAll();
      expect(deduplicator.getStats().pendingCount).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should report pendingCount for in-flight requests only', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      };

      const promise = deduplicator.deduplicate('stats-key', operation);

      const stats1 = deduplicator.getStats();
      expect(stats1.pendingCount).toBe(1);
      expect((stats1 as { completedCount?: number }).completedCount).toBeUndefined();

      await promise;

      const stats2 = deduplicator.getStats();
      expect(stats2.pendingCount).toBe(0);
    });
  });

  // Wire contract per docs/00_initial_porting/PROTOCOL.md (§5 agent.sendMessage):
  // the deduplicator wraps the IPC invoke, so concurrent identical calls must
  // share ONE BE invocation and sequential resolved calls must each issue a
  // FRESH BE invocation. Uses the shared in-memory ipc-mock-router as the BE
  // boundary so the test exercises the same channel-call semantics production
  // code would.
  describe('Wire contract (mock BE)', () => {
    const CHANNEL = 'agent:sendMessage';
    const PARAMS = {
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      content: 'Fix the build',
      messageId: 'm1',
    };
    const KEY = RequestDeduplicator.generateMessageKey(
      PARAMS.agentId,
      PARAMS.content,
    );

    beforeEach(() => {
      resetMockIpcRouter();
    });

    afterEach(() => {
      resetMockIpcRouter();
    });

    it('two concurrent resolved calls => one BE invocation', async () => {
      const handler = vi.fn(async (params: unknown) => {
        expect(params).toEqual(PARAMS);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { success: true, queued: false, messageId: PARAMS.messageId };
      });
      registerMockIpcHandler(CHANNEL, handler);

      const operation = () => mockInvoke<unknown>(CHANNEL, PARAMS);

      const [r1, r2] = await Promise.all([
        deduplicator.deduplicate(KEY, operation),
        deduplicator.deduplicate(KEY, operation),
      ]);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(r1).toEqual({ success: true, queued: false, messageId: PARAMS.messageId });
      expect(r2).toBe(r1);
    });

    it('two sequential resolved calls => two BE invocations (no completed-result cache)', async () => {
      const handler = vi.fn(async (params: unknown) => {
        expect(params).toEqual(PARAMS);
        return { success: true, queued: false, messageId: PARAMS.messageId };
      });
      registerMockIpcHandler(CHANNEL, handler);

      const operation = () => mockInvoke<unknown>(CHANNEL, PARAMS);

      await deduplicator.deduplicate(KEY, operation);
      await deduplicator.deduplicate(KEY, operation);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
