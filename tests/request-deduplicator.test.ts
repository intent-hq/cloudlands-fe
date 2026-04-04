import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestDeduplicator } from '../src/features/agent/browser/services/request-deduplicator.service';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new (RequestDeduplicator as any)();
  });

  afterEach(() => {
    deduplicator.dispose();
  });

  describe('Basic Deduplication', () => {
    it('should deduplicate concurrent identical requests', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return `result-${callCount}`;
      };

      // Make three concurrent requests with the same key
      const promises = [
        deduplicator.deduplicate('test-key', operation),
        deduplicator.deduplicate('test-key', operation),
        deduplicator.deduplicate('test-key', operation),
      ];

      const results = await Promise.all(promises);

      // Should only call operation once
      expect(callCount).toBe(1);
      // All should get the same result
      expect(results).toEqual(['result-1', 'result-1', 'result-1']);
    });

    it('should not deduplicate requests with different keys', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      // Make requests with different keys
      const results = await Promise.all([
        deduplicator.deduplicate('key-1', operation),
        deduplicator.deduplicate('key-2', operation),
        deduplicator.deduplicate('key-3', operation),
      ]);

      // Should call operation three times
      expect(callCount).toBe(3);
      expect(results).toEqual(['result-1', 'result-2', 'result-3']);
    });

    it('should cache results within TTL', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      // First request
      const result1 = await deduplicator.deduplicate('cache-key', operation, { ttl: 1000 });
      expect(result1).toBe('result-1');
      expect(callCount).toBe(1);

      // Second request within TTL
      const result2 = await deduplicator.deduplicate('cache-key', operation, { ttl: 1000 });
      expect(result2).toBe('result-1');
      expect(callCount).toBe(1); // Should not increment
    });

    it('should not cache results after TTL expires', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      // First request with short TTL
      const result1 = await deduplicator.deduplicate('ttl-key', operation, { ttl: 50 });
      expect(result1).toBe('result-1');
      expect(callCount).toBe(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second request after TTL
      const result2 = await deduplicator.deduplicate('ttl-key', operation, { ttl: 50 });
      expect(result2).toBe('result-2');
      expect(callCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should not cache errors', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call failed');
        }
        return `success-${callCount}`;
      };

      // First request fails
      await expect(deduplicator.deduplicate('error-key', operation)).rejects.toThrow(
        'First call failed',
      );
      expect(callCount).toBe(1);

      // Second request should retry
      const result = await deduplicator.deduplicate('error-key', operation);
      expect(result).toBe('success-2');
      expect(callCount).toBe(2);
    });

    it('should propagate errors to all waiting requests', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('Operation failed');
      };

      // Make concurrent requests
      const promises = [
        deduplicator.deduplicate('error-broadcast', operation),
        deduplicator.deduplicate('error-broadcast', operation),
        deduplicator.deduplicate('error-broadcast', operation),
      ];

      // All should receive the same error
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

  describe('Cache Management', () => {
    it('should clear specific keys', async () => {
      let callCount = 0;
      const operation = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      // Cache a result
      await deduplicator.deduplicate('clear-key', operation);
      expect(callCount).toBe(1);

      // Clear the key
      deduplicator.clearKey('clear-key');

      // Next request should call operation again
      await deduplicator.deduplicate('clear-key', operation);
      expect(callCount).toBe(2);
    });

    it('should clear all cached requests', async () => {
      const operation = async (id: string) => `result-${id}`;

      // Cache multiple results
      await deduplicator.deduplicate('key-1', () => operation('1'));
      await deduplicator.deduplicate('key-2', () => operation('2'));

      const stats1 = deduplicator.getStats();
      expect(stats1.completedCount).toBe(2);

      // Clear all
      deduplicator.clearAll();

      const stats2 = deduplicator.getStats();
      expect(stats2.completedCount).toBe(0);
      expect(stats2.pendingCount).toBe(0);
    });

    it('should enforce cache size limit', async () => {
      // Set a small cache limit for testing
      const maxSize = 5;
      (deduplicator as any).MAX_CACHE_SIZE = maxSize;

      // Add more than the limit
      for (let i = 0; i < 10; i++) {
        await deduplicator.deduplicate(`key-${i}`, async () => i);
      }

      const stats = deduplicator.getStats();
      expect(stats.completedCount).toBeLessThanOrEqual(maxSize);
    });
  });

  describe('Statistics', () => {
    it('should track pending and completed requests', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      };

      // Start a request
      const promise = deduplicator.deduplicate('stats-key', operation);

      // Check pending
      const stats1 = deduplicator.getStats();
      expect(stats1.pendingCount).toBe(1);
      expect(stats1.completedCount).toBe(0);

      // Wait for completion
      await promise;

      // Check completed
      const stats2 = deduplicator.getStats();
      expect(stats2.pendingCount).toBe(0);
      expect(stats2.completedCount).toBe(1);
    });
  });
});
