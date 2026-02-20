/**
 * Validation Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  sanitizeMessage,
  sanitizeHTML,
  sanitizePath,
  sanitizeBranchName,
  validateAgentName,
  validateWorkspaceName,
  validateWorkspacePath,
  validateFilePath,
  validateMessage,
  validateSystemPrompt,
  validateTemperature,
  validateMaxTokens,
  isValidUUID,
  isValidEmail,
  isValidURL,
  isValidOptimisticId,
  containsSuspiciousPatterns,
} from '../index';

describe('Sanitization Functions', () => {
  describe('sanitizeInput', () => {
    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('should remove XSS vectors', () => {
      expect(sanitizeInput('hello<script>alert("xss")</script>')).not.toContain('<');
    });

    it('should enforce max length', () => {
      const long = 'a'.repeat(600000);
      const result = sanitizeInput(long);
      expect(result.length).toBeLessThanOrEqual(500000);
    });

    it('should handle non-string input', () => {
      expect(sanitizeInput(null as any)).toBe('');
      expect(sanitizeInput(undefined as any)).toBe('');
    });
  });

  describe('sanitizeMessage', () => {
    it('should remove control characters', () => {
      const input = 'hello\x00world\x01test';
      const result = sanitizeMessage(input);
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x01');
    });

    it('should normalize line endings', () => {
      expect(sanitizeMessage('hello\r\nworld')).toBe('hello\nworld');
      expect(sanitizeMessage('hello\rworld')).toBe('hello\nworld');
    });

    it('should trim excessive blank lines', () => {
      const input = 'hello\n\n\n\n\nworld';
      const result = sanitizeMessage(input);
      expect(result).toBe('hello\n\n\nworld');
    });
  });

  describe('sanitizeHTML', () => {
    it('should remove script tags', () => {
      const html = '<p>Hello</p><script>alert("xss")</script>';
      expect(sanitizeHTML(html)).not.toContain('<script');
    });

    it('should remove event handlers', () => {
      const html = '<div onclick="alert(\'xss\')">Click</div>';
      expect(sanitizeHTML(html)).not.toContain('onclick');
    });

    it('should remove javascript: protocol', () => {
      const html = '<a href="javascript:alert(\'xss\')">Link</a>';
      expect(sanitizeHTML(html)).not.toContain('javascript:');
    });
  });

  describe('sanitizePath', () => {
    it('should remove directory traversal', () => {
      expect(sanitizePath('/path/../to/file')).not.toContain('..');
    });

    it('should remove invalid path characters', () => {
      expect(sanitizePath('path<to>file')).not.toContain('<');
      expect(sanitizePath('path<to>file')).not.toContain('>');
    });

    it('should normalize slashes', () => {
      expect(sanitizePath('path\\to\\file')).toContain('/');
    });
  });

  describe('sanitizeBranchName', () => {
    it('should replace invalid characters', () => {
      const branch = sanitizeBranchName('feature/my branch');
      expect(branch).not.toContain(' ');
    });

    it('should remove .lock suffix', () => {
      expect(sanitizeBranchName('branch.lock')).not.toContain('.lock');
    });

    it('should convert to lowercase', () => {
      const result = sanitizeBranchName('FEATURE/MyBranch');
      expect(result).toBe(result.toLowerCase());
    });
  });
});

describe('Name Validation', () => {
  describe('validateAgentName', () => {
    it('should accept valid names', () => {
      expect(validateAgentName('My Agent')).toBe(true);
      expect(validateAgentName('Agent-123')).toBe(true);
      expect(validateAgentName('Agent_Name')).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateAgentName('')).toBe(false);
      expect(validateAgentName('   ')).toBe(false);
    });

    it('should accept names with special characters', () => {
      // Agent names can be any non-empty string
      expect(validateAgentName('Agent@Name')).toBe(true);
      expect(validateAgentName('Agent#Name')).toBe(true);
      expect(validateAgentName('Add theme toggle logic that applies/removes the dark class')).toBe(
        true,
      );
    });

    it('should enforce max length', () => {
      const longName = 'a'.repeat(101);
      expect(validateAgentName(longName)).toBe(false);
    });
  });

  describe('validateWorkspaceName', () => {
    it('should accept valid names', () => {
      expect(validateWorkspaceName('My Workspace')).toBe(true);
      expect(validateWorkspaceName('Workspace-123')).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateWorkspaceName('')).toBe(false);
    });
  });
});

describe('Path Validation', () => {
  describe('validateWorkspacePath', () => {
    it('should reject directory traversal', () => {
      expect(validateWorkspacePath('/path/../../../etc/passwd')).toBe(false);
      expect(validateWorkspacePath('~/home')).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(validateWorkspacePath('/path\x00/file')).toBe(false);
    });

    it('should accept valid paths', () => {
      expect(validateWorkspacePath('/home/user/workspace')).toBe(true);
      expect(validateWorkspacePath('workspace')).toBe(true);
    });
  });

  describe('validateFilePath', () => {
    it('should reject directory traversal', () => {
      expect(validateFilePath('../../../etc/passwd')).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(validateFilePath('file\x00.txt')).toBe(false);
    });

    it('should accept valid paths', () => {
      expect(validateFilePath('/home/user/file.txt')).toBe(true);
      expect(validateFilePath('file.txt')).toBe(true);
    });
  });
});

describe('Message Validation', () => {
  it('should accept valid messages', () => {
    expect(validateMessage('Hello world')).toBe(true);
  });

  it('should reject empty messages', () => {
    expect(validateMessage('')).toBe(false);
    expect(validateMessage('   ')).toBe(false);
  });

  it('should reject non-string input', () => {
    expect(validateMessage(null as any)).toBe(false);
  });
});

describe('ID Validation', () => {
  describe('isValidUUID', () => {
    it('should accept valid UUIDs', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('should accept valid emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('john.doe@company.co.uk')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
    });

    it('should reject emails with consecutive dots', () => {
      expect(isValidEmail('user..name@example.com')).toBe(false);
      expect(isValidEmail('user@example..com')).toBe(false);
    });

    it('should reject emails with leading/trailing dots', () => {
      expect(isValidEmail('.user@example.com')).toBe(false);
      expect(isValidEmail('user.@example.com')).toBe(false);
      expect(isValidEmail('user@.example.com')).toBe(false);
      expect(isValidEmail('user@example.com.')).toBe(false);
    });
  });

  describe('isValidURL', () => {
    it('should accept valid URLs', () => {
      expect(isValidURL('https://example.com')).toBe(true);
      expect(isValidURL('http://localhost:3000')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidURL('not a url')).toBe(false);
      expect(isValidURL('ht!tp://example.com')).toBe(false);
    });
  });

  describe('isValidOptimisticId', () => {
    it('should accept valid optimistic IDs', () => {
      expect(isValidOptimisticId('optimistic-1234567890-abc123')).toBe(true);
    });

    it('should reject invalid optimistic IDs', () => {
      expect(isValidOptimisticId('not-optimistic')).toBe(false);
      expect(isValidOptimisticId('optimistic-abc')).toBe(false);
    });
  });
});

describe('Additional Validation Functions', () => {
  describe('validateSystemPrompt', () => {
    it('should accept valid prompts', () => {
      expect(validateSystemPrompt('You are a helpful assistant')).toBe(true);
    });

    it('should accept empty prompts', () => {
      expect(validateSystemPrompt('')).toBe(true);
    });

    it('should reject overly long prompts', () => {
      // LIMITS.MAX_PROMPT_LENGTH is 200000 (200k chars for large system prompts)
      const longPrompt = 'a'.repeat(200001);
      expect(validateSystemPrompt(longPrompt)).toBe(false);
    });
  });

  describe('validateTemperature', () => {
    it('should accept valid temperatures', () => {
      expect(validateTemperature(0)).toBe(true);
      expect(validateTemperature(0.7)).toBe(true);
      expect(validateTemperature(2)).toBe(true);
    });

    it('should reject out of range values', () => {
      expect(validateTemperature(-1)).toBe(false);
      expect(validateTemperature(3)).toBe(false);
    });
  });

  describe('validateMaxTokens', () => {
    it('should accept valid token counts', () => {
      expect(validateMaxTokens(1)).toBe(true);
      expect(validateMaxTokens(4096)).toBe(true);
      expect(validateMaxTokens(200000)).toBe(true);
    });

    it('should reject invalid values', () => {
      expect(validateMaxTokens(0)).toBe(false);
      expect(validateMaxTokens(200001)).toBe(false);
    });
  });

  describe('containsSuspiciousPatterns', () => {
    it('should detect script tags', () => {
      expect(containsSuspiciousPatterns('<script>alert("xss")</script>')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(containsSuspiciousPatterns('onclick="alert(\'xss\')"')).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      expect(containsSuspiciousPatterns('javascript:alert("xss")')).toBe(true);
    });

    it('should not flag safe content', () => {
      expect(containsSuspiciousPatterns('Hello world')).toBe(false);
    });
  });
});
