/**
 * Tests for Error Messages Module
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  formatErrorMessage,
  getUserFriendlyMessage,
  getHelpLink,
  getLocalizedMessage,
  cleanErrorMessage,
  ERROR_MESSAGE_TEMPLATES,
  USER_FRIENDLY_MESSAGES,
  HELP_LINKS,
} from '../messages';

describe('Error Messages Module', () => {
  describe('formatErrorMessage', () => {
    it('should format message with single placeholder', () => {
      const template = "Agent '{agentName}' not found";
      const result = formatErrorMessage(template, { agentName: 'TestAgent' });
      expect(result).toBe("Agent 'TestAgent' not found");
    });

    it('should format message with multiple placeholders', () => {
      const template = 'Message exceeds {maxLength} characters. Current: {currentLength}';
      const result = formatErrorMessage(template, {
        maxLength: 1000,
        currentLength: 1500,
      });
      expect(result).toBe('Message exceeds 1000 characters. Current: 1500');
    });

    it('should handle missing placeholders gracefully', () => {
      const template = 'Error: {code} - {message}';
      const result = formatErrorMessage(template, { code: 'ERR001' });
      expect(result).toContain('ERR001');
      expect(result).toContain('{message}');
    });

    it('should handle empty context', () => {
      const template = 'Simple error message';
      const result = formatErrorMessage(template, {});
      expect(result).toBe('Simple error message');
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return user-friendly message for known error code', () => {
      const message = getUserFriendlyMessage('SESSION_NOT_FOUND');
      expect(message).toBe(USER_FRIENDLY_MESSAGES.SESSION_NOT_FOUND);
    });

    it('should format message with context when provided', () => {
      const message = getUserFriendlyMessage('SESSION_NOT_FOUND', {
        sessionId: 'sess-123',
      });
      expect(message).toContain('sess-123');
    });

    it('should return fallback message for unknown error code', () => {
      const message = getUserFriendlyMessage('UNKNOWN_ERROR');
      expect(message).toBe('An unexpected error occurred.');
    });

    it('should handle all error codes in USER_FRIENDLY_MESSAGES', () => {
      Object.keys(USER_FRIENDLY_MESSAGES).forEach((code) => {
        const message = getUserFriendlyMessage(code);
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getHelpLink', () => {
    it('should return help link for known error code', () => {
      const link = getHelpLink('AGENT_CREATION_FAILED');
      expect(link).toBe(HELP_LINKS.AGENT_CREATION);
    });

    it('should return general help link for unknown error code', () => {
      const link = getHelpLink('UNKNOWN_ERROR');
      expect(link).toBe(HELP_LINKS.GENERAL);
    });

    it('should return streaming help link for streaming errors', () => {
      const link = getHelpLink('STREAM_TIMEOUT');
      expect(link).toBe(HELP_LINKS.STREAMING);
    });

    it('should return storage help link for storage errors', () => {
      const link = getHelpLink('STORAGE_CORRUPTED');
      expect(link).toBe(HELP_LINKS.STORAGE);
    });

    it('should return memory help link for memory errors', () => {
      const link = getHelpLink('MEMORY_LIMIT_EXCEEDED');
      expect(link).toBe(HELP_LINKS.MEMORY);
    });
  });

  describe('getLocalizedMessage', () => {
    it('should return English message by default', () => {
      const message = getLocalizedMessage('SESSION_NOT_FOUND');
      expect(message).toBeTruthy();
    });

    it('should return English message for en locale', () => {
      const message = getLocalizedMessage('SESSION_NOT_FOUND', 'en');
      expect(message).toBe(USER_FRIENDLY_MESSAGES.SESSION_NOT_FOUND);
    });

    it('should return fallback for unsupported locales', () => {
      const message = getLocalizedMessage('SESSION_NOT_FOUND', 'es');
      // Should return English fallback if Spanish not implemented
      expect(message).toBeTruthy();
    });

    it('should return fallback for unknown error code', () => {
      const message = getLocalizedMessage('UNKNOWN_ERROR', 'en');
      expect(message).toBe('An error occurred.');
    });
  });

  describe('Message Templates', () => {
    it('should have templates for all error codes', () => {
      const errorCodes = Object.keys(USER_FRIENDLY_MESSAGES);
      errorCodes.forEach((code) => {
        // Either have a template or a user-friendly message
        expect(ERROR_MESSAGE_TEMPLATES[code] || USER_FRIENDLY_MESSAGES[code]).toBeTruthy();
      });
    });

    it('should have valid template syntax', () => {
      Object.values(ERROR_MESSAGE_TEMPLATES).forEach((template) => {
        // Templates should be strings
        expect(typeof template).toBe('string');
        // Templates should not have unmatched braces
        const openBraces = (template.match(/{/g) || []).length;
        const closeBraces = (template.match(/}/g) || []).length;
        expect(openBraces).toBe(closeBraces);
      });
    });
  });

  describe('cleanErrorMessage', () => {
    it('should strip Electron IPC wrapper', () => {
      const msg =
        "Error invoking remote method 'agent:backend:stream-message': Error: The agent didn't respond.";
      expect(cleanErrorMessage(msg)).toBe("The agent didn't respond.");
    });

    it('should strip error-boundary retry wrapper', () => {
      const msg = "send message failed after 3 attempts: The agent didn't respond.";
      expect(cleanErrorMessage(msg)).toBe("The agent didn't respond.");
    });

    it('should strip agent.service "Failed to X after N attempts" wrapper', () => {
      const msg = "Failed to send message after 3 attempts: The agent didn't respond.";
      expect(cleanErrorMessage(msg)).toBe("The agent didn't respond.");
    });

    it('should strip chained "Error:" prefixes', () => {
      const msg = 'Error: Error: Something went wrong.';
      expect(cleanErrorMessage(msg)).toBe('Something went wrong.');
    });

    it('should strip the full real-world nested error', () => {
      const msg =
        "send message failed after 3 attempts: Error invoking remote method 'agent:backend:stream-message': Error: Agent stream timed out with no response. The agent may have encountered an error.";
      expect(cleanErrorMessage(msg)).toBe(
        'Agent stream timed out with no response. The agent may have encountered an error.',
      );
    });

    it('should return the message as-is when no wrapping is present', () => {
      const msg = "The agent didn't respond. Please try again.";
      expect(cleanErrorMessage(msg)).toBe("The agent didn't respond. Please try again.");
    });

    it('should return generic fallback when message is stripped to empty', () => {
      expect(cleanErrorMessage('Error: ')).toBe('Something went wrong. Please try again.');
      expect(cleanErrorMessage('')).toBe('Something went wrong. Please try again.');
    });

    it('should handle IPC wrapper without trailing "Error:"', () => {
      const msg = "Error invoking remote method 'agent:backend:stream-message': Connection lost.";
      expect(cleanErrorMessage(msg)).toBe('Connection lost.');
    });

    it('should strip single "Error:" prefix', () => {
      const msg = 'Error: Network timeout';
      expect(cleanErrorMessage(msg)).toBe('Network timeout');
    });

    it('should handle case-insensitive matching for "failed after" wrapper', () => {
      const msg = 'Send Message failed after 2 attempts: timeout';
      expect(cleanErrorMessage(msg)).toBe('timeout');
    });

    it('should trim whitespace from result', () => {
      const msg = 'Error:   some message with extra spaces  ';
      expect(cleanErrorMessage(msg)).toBe('some message with extra spaces');
    });
  });

  describe('Help Links', () => {
    it('should have valid URLs', () => {
      Object.values(HELP_LINKS).forEach((link) => {
        expect(link).toMatch(/^https?:\/\//);
      });
    });

    it('should have all required categories', () => {
      expect(HELP_LINKS.AGENT_CREATION).toBeTruthy();
      expect(HELP_LINKS.STREAMING).toBeTruthy();
      expect(HELP_LINKS.STORAGE).toBeTruthy();
      expect(HELP_LINKS.MEMORY).toBeTruthy();
      expect(HELP_LINKS.PROVIDER).toBeTruthy();
      expect(HELP_LINKS.GENERAL).toBeTruthy();
    });
  });
});
