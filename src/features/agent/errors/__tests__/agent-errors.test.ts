/**
 * Tests for Agent Error Classes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentError,
  AgentErrorCode,
  AgentErrorHandler,
  AgentCreationError,
  AgentSessionError,
  AgentStreamingError,
  AgentProviderError,
  AgentStorageError,
  AgentResourceError,
} from '../agent-errors';

describe('AgentError', () => {
  describe('Base Error Class', () => {
    it('should create error with required fields', () => {
      const error = new AgentError('Test error', AgentErrorCode.AGENT_CREATION_FAILED, {
        agentId: 'test-123',
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(AgentErrorCode.AGENT_CREATION_FAILED);
      expect(error.context.agentId).toBe('test-123');
      expect(error.context.timestamp).toBeInstanceOf(Date);
      // When context is provided but doesn't match template placeholders, falls back to user-friendly message
      expect(error.userMessage).toBe(
        "We couldn't create your agent. Please check your settings and try again.",
      );
      expect(error.isRecoverable).toBe(false);
    });

    it('should include recovery suggestions', () => {
      const error = new AgentError('Stream interrupted', AgentErrorCode.STREAM_INTERRUPTED, {});

      expect(error.recoverySuggestions).toHaveLength(3);
      expect(error.recoverySuggestions[0].action).toBe('reconnect');
      expect(error.recoverySuggestions[0].automatic).toBe(true);
      expect(error.isRecoverable).toBe(true);
    });

    it('should allow custom user message', () => {
      const error = new AgentError(
        'Technical error',
        AgentErrorCode.AGENT_CREATION_FAILED,
        {},
        { userMessage: 'Something went wrong. Please try again.' },
      );

      expect(error.userMessage).toBe('Something went wrong. Please try again.');
    });

    it('should include cause when provided', () => {
      const cause = new Error('Original error');
      const error = new AgentError(
        'Wrapper error',
        AgentErrorCode.AGENT_CREATION_FAILED,
        {},
        { cause },
      );

      expect(error.cause).toBe(cause);
    });

    it('should serialize to JSON correctly', () => {
      const error = new AgentError('Test error', AgentErrorCode.SESSION_NOT_FOUND, {
        sessionId: 'session-123',
      });

      const json = error.toJSON();
      expect(json.name).toBe('AgentError');
      expect(json.code).toBe(AgentErrorCode.SESSION_NOT_FOUND);
      expect(json.message).toBe('Test error');
      expect(json.context.sessionId).toBe('session-123');
      expect(json.isRecoverable).toBe(false);
    });
  });

  describe('Specific Error Classes', () => {
    it('should create AgentCreationError', () => {
      const error = new AgentCreationError('Failed to create agent', { agentId: 'test-123' });

      expect(error.name).toBe('AgentCreationError');
      expect(error.code).toBe(AgentErrorCode.AGENT_CREATION_FAILED);
    });

    it('should create AgentSessionError', () => {
      const error = new AgentSessionError('Session not found', AgentErrorCode.SESSION_NOT_FOUND, {
        sessionId: 'session-123',
      });

      expect(error.name).toBe('AgentSessionError');
      expect(error.code).toBe(AgentErrorCode.SESSION_NOT_FOUND);
    });

    it('should create AgentStreamingError', () => {
      const error = new AgentStreamingError('Stream timeout', AgentErrorCode.STREAM_TIMEOUT, {
        agentId: 'agent-123',
      });

      expect(error.name).toBe('AgentStreamingError');
      expect(error.code).toBe(AgentErrorCode.STREAM_TIMEOUT);
    });

    it('should create AgentProviderError', () => {
      const error = new AgentProviderError(
        'Provider not found',
        AgentErrorCode.PROVIDER_NOT_FOUND,
        { provider: 'test-provider' },
      );

      expect(error.name).toBe('AgentProviderError');
      expect(error.code).toBe(AgentErrorCode.PROVIDER_NOT_FOUND);
    });

    it('should create AgentStorageError', () => {
      const error = new AgentStorageError(
        'Storage write failed',
        AgentErrorCode.STORAGE_WRITE_FAILED,
        { path: '/test/path' },
      );

      expect(error.name).toBe('AgentStorageError');
      expect(error.code).toBe(AgentErrorCode.STORAGE_WRITE_FAILED);
    });

    it('should create AgentResourceError', () => {
      const error = new AgentResourceError(
        'Memory limit exceeded',
        AgentErrorCode.MEMORY_LIMIT_EXCEEDED,
        { currentUsage: 1000, limit: 500 },
      );

      expect(error.name).toBe('AgentResourceError');
      expect(error.code).toBe(AgentErrorCode.MEMORY_LIMIT_EXCEEDED);
    });
  });

  describe('Error Recovery', () => {
    it('should identify recoverable errors', () => {
      const recoverableError = new AgentError(
        'Stream interrupted',
        AgentErrorCode.STREAM_INTERRUPTED,
        {},
      );

      const nonRecoverableError = new AgentError(
        'Invalid config',
        AgentErrorCode.INVALID_AGENT_CONFIG,
        {},
      );

      expect(recoverableError.isRecoverable).toBe(true);
      expect(nonRecoverableError.isRecoverable).toBe(false);
    });

    it('should provide automatic recovery suggestions', () => {
      const error = new AgentError('Provider died', AgentErrorCode.PROVIDER_PROCESS_DIED, {});

      const autoRecovery = error.recoverySuggestions.find((s) => s.automatic);
      expect(autoRecovery).toBeDefined();
      expect(autoRecovery?.action).toBe('restart');
    });
  });
});

describe('AgentErrorHandler', () => {
  beforeEach(() => {
    AgentErrorHandler.clearErrorHistory();
  });

  it('should handle AgentError', () => {
    const error = new AgentError('Test error', AgentErrorCode.AGENT_CREATION_FAILED, {
      agentId: 'test-123',
    });

    AgentErrorHandler.handle(error);
    const history = AgentErrorHandler.getErrorHistory();

    expect(history).toHaveLength(1);
    expect(history[0]).toBe(error);
  });

  it('should convert regular errors to AgentError', () => {
    const regularError = new Error('Regular error');

    AgentErrorHandler.handle(regularError);
    const history = AgentErrorHandler.getErrorHistory();

    expect(history).toHaveLength(1);
    expect(history[0]).toBeInstanceOf(AgentError);
    expect(history[0].cause).toBe(regularError);
  });

  it('should maintain error history with max limit', () => {
    // Add more than MAX_ERROR_HISTORY (100) errors
    for (let i = 0; i < 105; i++) {
      const error = new AgentError(`Error ${i}`, AgentErrorCode.AGENT_CREATION_FAILED, {});
      AgentErrorHandler.handle(error);
    }

    const history = AgentErrorHandler.getErrorHistory();
    expect(history).toHaveLength(100);
    expect(history[0].message).toBe('Error 5'); // First 5 should be removed
    expect(history[99].message).toBe('Error 104'); // Last should be the most recent
  });

  it('should clear error history', () => {
    const error = new AgentError('Test error', AgentErrorCode.AGENT_CREATION_FAILED, {});

    AgentErrorHandler.handle(error);
    expect(AgentErrorHandler.getErrorHistory()).toHaveLength(1);

    AgentErrorHandler.clearErrorHistory();
    expect(AgentErrorHandler.getErrorHistory()).toHaveLength(0);
  });

  it('should provide error statistics', () => {
    AgentErrorHandler.handle(new AgentError('Error 1', AgentErrorCode.AGENT_CREATION_FAILED, {}));
    AgentErrorHandler.handle(new AgentError('Error 2', AgentErrorCode.AGENT_CREATION_FAILED, {}));
    AgentErrorHandler.handle(new AgentError('Error 3', AgentErrorCode.SESSION_NOT_FOUND, {}));

    const stats = AgentErrorHandler.getErrorStats();
    expect(stats[AgentErrorCode.AGENT_CREATION_FAILED]).toBe(2);
    expect(stats[AgentErrorCode.SESSION_NOT_FOUND]).toBe(1);
  });
});

describe('Error User Messages', () => {
  it('should provide user-friendly messages for all error codes', () => {
    const errorCodes = Object.values(AgentErrorCode);

    errorCodes.forEach((code) => {
      const error = new AgentError('Technical error', code, {});
      expect(error.userMessage).toBeTruthy();
      expect(error.userMessage).not.toBe('');
      expect(error.userMessage).not.toContain('undefined');
    });
  });

  it('should provide recovery suggestions for specific errors', () => {
    const errorsWithSuggestions = [
      AgentErrorCode.AGENT_CREATION_FAILED,
      AgentErrorCode.STREAM_INTERRUPTED,
      AgentErrorCode.STREAM_TIMEOUT,
      AgentErrorCode.PROVIDER_PROCESS_DIED,
      AgentErrorCode.STORAGE_CORRUPTED,
      AgentErrorCode.MEMORY_LIMIT_EXCEEDED,
    ];

    errorsWithSuggestions.forEach((code) => {
      const error = new AgentError('Test', code, {});
      expect(error.recoverySuggestions.length).toBeGreaterThan(0);
      error.recoverySuggestions.forEach((suggestion) => {
        expect(suggestion.action).toBeTruthy();
        expect(suggestion.description).toBeTruthy();
      });
    });
  });
});
