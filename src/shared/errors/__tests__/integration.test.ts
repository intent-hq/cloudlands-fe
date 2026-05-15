/**
 * Integration Tests for Error Messages with AgentError
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  AgentError,
  AgentErrorCode,
} from '../../../features/agent/errors/agent-errors';

describe('Error Messages Integration', () => {
  describe('AgentError with Messages Module', () => {
    it('should create error with user-friendly message', () => {
      const error = new AgentError('Technical error details', AgentErrorCode.SESSION_NOT_FOUND, {
        sessionId: 'sess-123',
      });

      expect(error.userMessage).toBeTruthy();
      expect(error.userMessage).not.toBe('Technical error details');
    });

    it('should include help link in JSON serialization', () => {
      const error = new AgentError('Technical error', AgentErrorCode.STREAM_TIMEOUT, {
        timeout: 30000,
      });

      const json = error.toJSON();
      expect(json.helpLink).toBeTruthy();
      expect(json.helpLink).toContain('http');
    });

    it('should include recovery suggestions', () => {
      const error = new AgentError('Technical error', AgentErrorCode.STREAM_INTERRUPTED, {});

      expect(error.recoverySuggestions.length).toBeGreaterThan(0);
      expect(error.recoverySuggestions[0]).toHaveProperty('action');
      expect(error.recoverySuggestions[0]).toHaveProperty('description');
    });

    it('should format message with context', () => {
      const error = new AgentError('Technical error', AgentErrorCode.MESSAGE_TOO_LONG, {
        maxLength: 1000,
        currentLength: 1500,
      });

      const formatted = error.formatMessage(
        'Message exceeds {maxLength} characters. Current: {currentLength}',
      );
      expect(formatted).toContain('1000');
      expect(formatted).toContain('1500');
    });

    it('should get help link from error', () => {
      const error = new AgentError('Technical error', AgentErrorCode.STORAGE_CORRUPTED, {});

      const helpLink = error.getHelpLink();
      expect(helpLink).toBeTruthy();
      expect(helpLink).toContain('storage');
    });
  });

  describe('Error Message Consistency', () => {
    it('should have consistent messages for all error codes', () => {
      const errorCodes = Object.values(AgentErrorCode);

      errorCodes.forEach((code) => {
        const error = new AgentError('Technical error', code, {});
        expect(error.userMessage).toBeTruthy();
        expect(error.userMessage.length).toBeGreaterThan(0);
      });
    });

    it('should have recovery suggestions for all error codes', () => {
      const errorCodes = Object.values(AgentErrorCode);

      errorCodes.forEach((code) => {
        const error = new AgentError('Technical error', code, {});
        expect(error.recoverySuggestions).toBeTruthy();
        expect(Array.isArray(error.recoverySuggestions)).toBe(true);
      });
    });

    it('should have help links for all error codes', () => {
      const errorCodes = Object.values(AgentErrorCode);

      errorCodes.forEach((code) => {
        const error = new AgentError('Technical error', code, {});
        const helpLink = error.getHelpLink();
        expect(helpLink).toBeTruthy();
      });
    });
  });

  describe('Error Serialization', () => {
    it('should serialize error with all message information', () => {
      const error = new AgentError('Technical error', AgentErrorCode.AGENT_CREATION_FAILED, {
        agentName: 'TestAgent',
      });

      const json = error.toJSON();
      expect(json).toHaveProperty('code');
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('userMessage');
      expect(json).toHaveProperty('context');
      expect(json).toHaveProperty('recoverySuggestions');
      expect(json).toHaveProperty('helpLink');
      expect(json).toHaveProperty('isRecoverable');
    });

    it('should preserve context in serialization', () => {
      const context = { agentName: 'TestAgent', workspaceId: 'ws-123' };
      const error = new AgentError(
        'Technical error',
        AgentErrorCode.AGENT_CREATION_FAILED,
        context,
      );

      const json = error.toJSON();
      expect(json.context).toEqual(expect.objectContaining(context));
    });
  });

  describe('Error Recovery Integration', () => {
    it('should mark recoverable errors correctly', () => {
      const recoverableErrors = [
        AgentErrorCode.STREAM_INTERRUPTED,
        AgentErrorCode.STREAM_TIMEOUT,
        AgentErrorCode.MESSAGE_SEND_FAILED,
      ];

      recoverableErrors.forEach((code) => {
        const error = new AgentError('Technical error', code, {});
        expect(error.isRecoverable).toBe(true);
      });
    });

    it('should include automatic recovery suggestions where applicable', () => {
      const error = new AgentError('Technical error', AgentErrorCode.STREAM_INTERRUPTED, {});

      const automatic = error.recoverySuggestions.filter((s) => s.automatic);
      expect(automatic.length).toBeGreaterThan(0);
    });
  });
});
