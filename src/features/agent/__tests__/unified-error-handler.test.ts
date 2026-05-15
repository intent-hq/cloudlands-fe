import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  errorHandler,
  AgentError,
  ErrorCategory,
  ErrorCode,
  ErrorSeverity,
} from '../services/error-handler';

describe('UnifiedErrorHandler', () => {
  beforeEach(() => {
    // Clear all errors before each test
    errorHandler.reset();
  });

  describe('Error Classification', () => {
    it('should classify network errors correctly', () => {
      const error = new Error('Network request failed');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.NETWORK);
      expect(classification.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(classification.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify timeout errors correctly', () => {
      const error = new Error('Operation timed out');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.TIMEOUT);
      expect(classification.code).toBe(ErrorCode.STREAM_TIMEOUT);
      expect(classification.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify provider errors correctly', () => {
      const error = new Error('Provider not available');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.PROVIDER);
      expect(classification.code).toBe(ErrorCode.PROVIDER_ERROR);
      expect(classification.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify configuration errors correctly', () => {
      const error = new Error('Invalid configuration');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.CONFIGURATION);
      expect(classification.code).toBe(ErrorCode.INVALID_CONFIG);
      expect(classification.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify memory errors correctly', () => {
      const error = new Error('Out of memory');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.MEMORY);
      expect(classification.code).toBe(ErrorCode.OUT_OF_MEMORY);
      expect(classification.severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should classify permission errors correctly', () => {
      const error = new Error('Permission denied');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.PERMISSION);
      expect(classification.code).toBe(ErrorCode.PERMISSION_DENIED);
      expect(classification.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify unknown errors as UNKNOWN', () => {
      const error = new Error('Something went wrong');
      const classification = errorHandler.classify(error);

      expect(classification.category).toBe(ErrorCategory.UNKNOWN);
      expect(classification.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(classification.severity).toBe(ErrorSeverity.MEDIUM);
    });
  });

  describe('Error Tracking', () => {
    it('should track errors with agent ID', () => {
      const error = new AgentError('Test error', {
        code: ErrorCode.NETWORK_ERROR,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
      });

      const record = errorHandler.track(error, 'agent-123');

      expect(record).toBeDefined();
      expect(record.agentId).toBe('agent-123');
      expect(record.message).toBe('Test error');
      expect(record.code).toBe(ErrorCode.NETWORK_ERROR);
    });

    it('should track errors without agent ID', () => {
      const error = new Error('Global error');
      const record = errorHandler.track(error);

      expect(record).toBeDefined();
      expect(record.agentId).toBeUndefined();
      expect(record.message).toBe('Global error');
    });

    it('should update statistics when tracking errors', () => {
      const error1 = new AgentError('Network error', {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
      });
      const error2 = new AgentError('Timeout error', {
        category: ErrorCategory.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
      });

      errorHandler.track(error1);
      errorHandler.track(error2);

      const stats = errorHandler.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byCategory.get(ErrorCategory.NETWORK)).toBe(1);
      expect(stats.byCategory.get(ErrorCategory.TIMEOUT)).toBe(1);
    });

    it('should limit errors per agent', () => {
      const agentId = 'agent-test';

      // Track more than MAX_ERRORS_PER_AGENT (100)
      for (let i = 0; i < 150; i++) {
        errorHandler.track(new Error(`Error ${i}`), agentId);
      }

      const stats = errorHandler.getStats(agentId);
      // Should be limited to 100
      expect(stats.total).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Recovery', () => {
    it('should retry recoverable errors', async () => {
      const error = new AgentError('Network error', {
        category: ErrorCategory.NETWORK,
        recoverable: true,
      });

      const result = await errorHandler.recover(error, {
        type: 'retry',
        maxAttempts: 3,
        delay: 10,
      });

      // Since we don't have a retry function, it should fail
      expect(result.ok).toBe(false);
    });

    it('should use fallback value for fallback strategy', async () => {
      const error = new AgentError('Error', {
        recoverable: true,
      });

      const result = await errorHandler.recover(error, {
        type: 'fallback',
        fallbackValue: 'default',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('default');
      }
    });

    it('should ignore errors with ignore strategy', async () => {
      const error = new AgentError('Error', {
        recoverable: true,
      });

      const result = await errorHandler.recover(error, {
        type: 'ignore',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeNull();
      }
    });

    it('should fail non-recoverable errors', async () => {
      const error = new AgentError('Critical error', {
        recoverable: false,
      });

      const result = await errorHandler.recover(error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle errors with context', () => {
      const error = new Error('Test error');
      const context = {
        agentId: 'agent-123',
        operation: 'sendMessage',
        workspaceId: 'workspace-456',
      };

      errorHandler.handle(error, context);

      const stats = errorHandler.getStats('agent-123');
      expect(stats.total).toBe(1);
    });

    it('should wrap regular errors as AgentErrors', () => {
      const error = new Error('Regular error');

      errorHandler.handle(error);

      const stats = errorHandler.getStats();
      expect(stats.total).toBe(1);
    });
  });

  describe('Timeout Utility', () => {
    it('should complete within timeout', async () => {
      const result = await errorHandler.withTimeout(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'success';
        },
        100,
        'Operation timed out',
      );

      expect(result).toBe('success');
    });

    it('should throw timeout error when exceeding timeout', async () => {
      await expect(
        errorHandler.withTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'success';
          },
          50,
          'Custom timeout message',
        ),
      ).rejects.toThrow('Custom timeout message');
    });

    it('should propagate original errors', async () => {
      await expect(
        errorHandler.withTimeout(async () => {
          throw new Error('Original error');
        }, 100),
      ).rejects.toThrow('Original error');
    });
  });

  describe('Statistics', () => {
    it('should provide global statistics', () => {
      errorHandler.track(new Error('Error 1'));
      errorHandler.track(new Error('Error 2'));

      const stats = errorHandler.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byCategory).toBeDefined();
      expect(stats.bySeverity).toBeDefined();
      expect(stats.byCode).toBeDefined();
    });

    it('should provide agent-specific statistics', () => {
      const agentId = 'agent-stats';

      errorHandler.track(new Error('Agent error 1'), agentId);
      errorHandler.track(new Error('Agent error 2'), agentId);
      errorHandler.track(new Error('Global error'));

      const agentStats = errorHandler.getStats(agentId);
      const globalStats = errorHandler.getStats();

      expect(agentStats.total).toBe(2);
      expect(globalStats.total).toBe(3);
    });
  });

  describe('Clear Functionality', () => {
    it('should clear errors for specific agent', () => {
      const agentId = 'agent-clear';

      errorHandler.track(new Error('Error'), agentId);
      errorHandler.track(new Error('Global error'));

      errorHandler.clear(agentId);

      const agentStats = errorHandler.getStats(agentId);
      const globalStats = errorHandler.getStats();

      expect(agentStats.total).toBe(0);
      expect(globalStats.total).toBe(1);
    });

    it('should clear all errors', () => {
      errorHandler.track(new Error('Error 1'), 'agent-1');
      errorHandler.track(new Error('Error 2'), 'agent-2');
      errorHandler.track(new Error('Global error'));

      errorHandler.clear();

      const stats = errorHandler.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('AgentError Class', () => {
    it('should create AgentError with all properties', () => {
      const error = new AgentError('Test error', {
        code: ErrorCode.NETWORK_ERROR,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
        recoverable: true,
        context: { key: 'value' },
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.recoverable).toBe(true);
      expect(error.context).toEqual({ key: 'value' });
    });

    it('should use defaults when properties not provided', () => {
      const error = new AgentError('Test error');

      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(error.category).toBe(ErrorCategory.UNKNOWN);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should convert to ErrorRecord', () => {
      const error = new AgentError('Test error', {
        code: ErrorCode.NETWORK_ERROR,
        category: ErrorCategory.NETWORK,
      });

      const record = error.toRecord('agent-123');

      expect(record.agentId).toBe('agent-123');
      expect(record.message).toBe('Test error');
      expect(record.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(record.category).toBe(ErrorCategory.NETWORK);
    });
  });
});
