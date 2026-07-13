/**
 * Tests for Assertion Helpers
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  assertAgentSession,
  assertAgentMessage,
  assertContentBlock,
  assertToolCall,
  assertDefined,
  assertNotNull,
  assertNonEmptyString,
  assertNonEmptyArray,
  assertTrue,
  assertFalse,
} from '../assertions';

describe('Assertion Helpers', () => {
  describe('assertAgentSession', () => {
    it('should pass for valid sessions', () => {
      const session = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [],
        status: 'active',
      };
      expect(() => assertAgentSession(session)).not.toThrow();
    });

    it('should throw for invalid sessions', () => {
      expect(() => assertAgentSession(null)).toThrow();
      expect(() => assertAgentSession({})).toThrow();
    });

    it('should support custom error messages', () => {
      expect(() => assertAgentSession(null, 'Custom error')).toThrow('Custom error');
    });
  });

  describe('assertAgentMessage', () => {
    it('should pass for valid messages', () => {
      const message = {
        id: 'msg-123',
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      };
      expect(() => assertAgentMessage(message)).not.toThrow();
    });

    it('should throw for invalid messages', () => {
      expect(() => assertAgentMessage(null)).toThrow();
      expect(() => assertAgentMessage({ id: 'msg-123' })).toThrow();
    });
  });

  describe('assertContentBlock', () => {
    it('should pass for valid blocks', () => {
      const block = { type: 'text', text: 'hello' };
      expect(() => assertContentBlock(block)).not.toThrow();
    });

    it('should throw for invalid blocks', () => {
      expect(() => assertContentBlock(null)).toThrow();
      expect(() => assertContentBlock({ type: 'invalid' })).toThrow();
    });
  });

  describe('assertToolCall', () => {
    it('should pass for valid tool calls', () => {
      const call = {
        id: 'tool-123',
        name: 'test',
        timestamp: '2024-01-01T00:00:00Z',
      };
      expect(() => assertToolCall(call)).not.toThrow();
    });

    it('should throw for invalid tool calls', () => {
      expect(() => assertToolCall(null)).toThrow();
      expect(() => assertToolCall({ id: 'tool-123' })).toThrow();
    });
  });

  describe('assertDefined', () => {
    it('should pass for defined values', () => {
      expect(() => assertDefined('hello')).not.toThrow();
      expect(() => assertDefined(0)).not.toThrow();
      expect(() => assertDefined(false)).not.toThrow();
      expect(() => assertDefined('')).not.toThrow();
    });

    it('should throw for null or undefined', () => {
      expect(() => assertDefined(null)).toThrow();
      expect(() => assertDefined(undefined)).toThrow();
    });
  });

  describe('assertNotNull', () => {
    it('should pass for non-null values', () => {
      expect(() => assertNotNull('hello')).not.toThrow();
      expect(() => assertNotNull(undefined)).not.toThrow();
    });

    it('should throw for null', () => {
      expect(() => assertNotNull(null)).toThrow();
    });
  });

  describe('assertNonEmptyString', () => {
    it('should pass for non-empty strings', () => {
      expect(() => assertNonEmptyString('hello')).not.toThrow();
      expect(() => assertNonEmptyString('  hello  ')).not.toThrow();
    });

    it('should throw for empty or whitespace strings', () => {
      expect(() => assertNonEmptyString('')).toThrow();
      expect(() => assertNonEmptyString('   ')).toThrow();
    });

    it('should throw for non-strings', () => {
      expect(() => assertNonEmptyString(null as any)).toThrow();
      expect(() => assertNonEmptyString(123 as any)).toThrow();
    });
  });

  describe('assertNonEmptyArray', () => {
    it('should pass for non-empty arrays', () => {
      expect(() => assertNonEmptyArray([1, 2, 3])).not.toThrow();
      expect(() => assertNonEmptyArray(['a'])).not.toThrow();
    });

    it('should throw for empty arrays', () => {
      expect(() => assertNonEmptyArray([])).toThrow();
    });

    it('should throw for non-arrays', () => {
      expect(() => assertNonEmptyArray(null as any)).toThrow();
      expect(() => assertNonEmptyArray('string' as any)).toThrow();
    });
  });

  describe('assertTrue', () => {
    it('should pass for true conditions', () => {
      expect(() => assertTrue(true)).not.toThrow();
      expect(() => assertTrue(1 === 1)).not.toThrow();
    });

    it('should throw for false conditions', () => {
      expect(() => assertTrue(false)).toThrow();
      // @ts-expect-error - intentionally testing false condition
      expect(() => assertTrue(1 === 2)).toThrow();
    });
  });

  describe('assertFalse', () => {
    it('should pass for false conditions', () => {
      expect(() => assertFalse(false)).not.toThrow();
      // @ts-expect-error - intentionally testing false condition
      expect(() => assertFalse(1 === 2)).not.toThrow();
    });

    it('should throw for true conditions', () => {
      expect(() => assertFalse(true)).toThrow();
      expect(() => assertFalse(1 === 1)).toThrow();
    });
  });
});
