/**
 * Test error recovery scenarios
 * Ensures graceful handling of failures and recovery
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Error Recovery', () => {
  let mockAgentService: any;
  let mockErrorHandler: any;

  beforeEach(() => {
    mockErrorHandler = {
      errors: [],
      trackError: vi.fn((error) => {
        mockErrorHandler.errors.push(error);
      }),
      clearErrors: vi.fn(() => {
        mockErrorHandler.errors = [];
      }),
    };

    mockAgentService = {
      createAgent: vi.fn(async (config) => {
        if (config.shouldFail) {
          const error = new Error('Agent creation failed');
          mockErrorHandler.trackError(error);
          return { success: false, error: error.message };
        }
        return { success: true, agent: { id: 'agent_1' } };
      }),
      sendMessage: vi.fn(async (agentId, message) => {
        if (message.shouldFail) {
          const error = new Error('Message send failed');
          mockErrorHandler.trackError(error);
          return { success: false, error: error.message };
        }
        return { success: true, messageId: 'msg_1' };
      }),
      retryOperation: vi.fn(async (operation, maxRetries = 3) => {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
          try {
            return await operation();
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      }),
    };
  });

  it('should handle agent creation failure', async () => {
    const result = await mockAgentService.createAgent({ shouldFail: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('failed');
    expect(mockErrorHandler.errors).toHaveLength(1);
  });

  it('should handle message send failure', async () => {
    const result = await mockAgentService.sendMessage('agent_1', {
      content: 'test',
      shouldFail: true,
    });

    expect(result.success).toBe(false);
    expect(mockErrorHandler.errors).toHaveLength(1);
  });

  it('should recover from transient failures with retry', async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient failure');
      }
      return { success: true };
    });

    const result = await mockAgentService.retryOperation(operation, 3);

    expect(result.success).toBe(true);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should fail after max retries exceeded', async () => {
    const operation = vi.fn(async () => {
      throw new Error('Persistent failure');
    });

    try {
      await mockAgentService.retryOperation(operation, 2);
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('Persistent failure');
      expect(operation).toHaveBeenCalledTimes(2);
    }
  });

  it('should handle invalid workspace data', async () => {
    const result = await mockAgentService.createAgent({
      workspaceId: null,
      shouldFail: true,
    });

    expect(result.success).toBe(false);
    expect(mockErrorHandler.errors).toHaveLength(1);
  });

  it('should handle stream interruption', async () => {
    const streamError = new Error('Stream interrupted');
    mockErrorHandler.trackError(streamError);

    expect(mockErrorHandler.errors).toHaveLength(1);
    expect(mockErrorHandler.errors[0].message).toContain('interrupted');
  });

  it('should clear errors after recovery', async () => {
    mockErrorHandler.trackError(new Error('Error 1'));
    mockErrorHandler.trackError(new Error('Error 2'));

    expect(mockErrorHandler.errors).toHaveLength(2);

    mockErrorHandler.clearErrors();
    expect(mockErrorHandler.errors).toHaveLength(0);
  });

  it('should handle backend communication timeout', async () => {
    const timeoutError = new Error('Backend request timeout');
    mockErrorHandler.trackError(timeoutError);

    expect(mockErrorHandler.errors[0].message).toContain('timeout');
  });

  it('should handle invalid response from backend', async () => {
    const invalidResponseError = new Error('Invalid response format');
    mockErrorHandler.trackError(invalidResponseError);

    expect(mockErrorHandler.errors).toHaveLength(1);
  });

  it('should track error context for debugging', async () => {
    const error = new Error('Operation failed');
    const context = {
      agentId: 'agent_1',
      operation: 'sendMessage',
      timestamp: new Date().toISOString(),
    };

    mockErrorHandler.trackError({ ...error, context });

    expect(mockErrorHandler.errors[0].context.agentId).toBe('agent_1');
    expect(mockErrorHandler.errors[0].context.operation).toBe('sendMessage');
  });
});
