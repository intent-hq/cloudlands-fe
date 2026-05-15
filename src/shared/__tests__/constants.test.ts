/**
 * Tests for Constants Module
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
  THRESHOLDS,
  PATHS,
  FILE_EXTENSIONS,
  PATTERNS,
  CACHE_TTL,
  RETRY,
  calculateRetryDelay,
  isValidModelId,
  isAtWarningThreshold,
  isSessionTooLarge,
  getSessionPath,
  getRecoveryPath,
} from '../constants';

describe('Constants Module', () => {
  describe('TIMEOUTS', () => {
    it('should have all required timeout values', () => {
      expect(TIMEOUTS.AGENT_RESPONSE).toBe(30000);
      expect(TIMEOUTS.STREAMING_CHUNK).toBe(100);
      expect(TIMEOUTS.SESSION_IDLE).toBe(600000);
      expect(TIMEOUTS.PERSISTENCE_RETRY).toBe(1000);
    });

    it('should have positive timeout values', () => {
      Object.values(TIMEOUTS).forEach((value) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      });
    });
  });

  describe('LIMITS', () => {
    it('should have all required limit values', () => {
      expect(LIMITS.MAX_MESSAGE_LENGTH).toBe(500000);
      expect(LIMITS.MAX_MESSAGES_PER_SESSION).toBe(1000);
      expect(LIMITS.MAX_AGENTS_PER_WORKSPACE).toBe(50);
      expect(LIMITS.MAX_MEMORY_USAGE).toBe(500 * 1024 * 1024);
    });

    it('should have positive limit values', () => {
      Object.values(LIMITS).forEach((value) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      });
    });
  });

  describe('DEFAULTS', () => {
    it('should have all required default values', () => {
      expect(DEFAULTS.AGENT_MODEL).toBe('opus4.5'); // Short model ID format
      expect(DEFAULTS.AGENT_NAME).toBe('Assistant');
      expect(DEFAULTS.WORKSPACE_NAME).toBe('Untitled');
      expect(DEFAULTS.TEMPERATURE).toBe(0.7);
      expect(DEFAULTS.MAX_TOKENS).toBe(4096);
    });

    it('should have string defaults for names', () => {
      expect(typeof DEFAULTS.AGENT_NAME).toBe('string');
      expect(typeof DEFAULTS.WORKSPACE_NAME).toBe('string');
      expect(DEFAULTS.AGENT_NAME.length).toBeGreaterThan(0);
    });
  });

  describe('PATTERNS', () => {
    it('should have valid regex patterns', () => {
      expect(PATTERNS.VALID_NAME).toBeInstanceOf(RegExp);
      expect(PATTERNS.VALID_ID).toBeInstanceOf(RegExp);
      expect(PATTERNS.UUID).toBeInstanceOf(RegExp);
      expect(PATTERNS.GITHUB_URL).toBeInstanceOf(RegExp);
    });

    it('should match valid UUIDs', () => {
      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      expect(PATTERNS.UUID.test(validUUID)).toBe(true);
    });

    it('should not match invalid UUIDs', () => {
      expect(PATTERNS.UUID.test('not-a-uuid')).toBe(false);
      expect(PATTERNS.UUID.test('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });

  describe('Helper Functions', () => {
    describe('calculateRetryDelay', () => {
      it('should calculate exponential backoff', () => {
        expect(calculateRetryDelay(1)).toBe(1000);
        expect(calculateRetryDelay(2)).toBe(2000);
        expect(calculateRetryDelay(3)).toBe(4000);
      });

      it('should cap at max delay', () => {
        const delay = calculateRetryDelay(10);
        expect(delay).toBeLessThanOrEqual(RETRY.MAX_DELAY);
      });
    });

    describe('isValidModelId', () => {
      it('should validate known models', () => {
        expect(isValidModelId('sonnet4.5')).toBe(true);
        expect(isValidModelId('gpt-4')).toBe(true);
        expect(isValidModelId('haiku4.5')).toBe(true);
      });

      it('should reject unknown models', () => {
        expect(isValidModelId('unknown-model')).toBe(false);
        expect(isValidModelId('')).toBe(false);
      });
    });

    describe('isAtWarningThreshold', () => {
      it('should detect warning threshold', () => {
        const threshold = LIMITS.MAX_ACTIVE_AGENTS * THRESHOLDS.AGENT_WARNING_THRESHOLD;
        expect(isAtWarningThreshold(threshold)).toBe(true);
        expect(isAtWarningThreshold(threshold - 1)).toBe(false);
      });
    });

    describe('isSessionTooLarge', () => {
      it('should detect oversized sessions', () => {
        expect(isSessionTooLarge(LIMITS.MAX_SESSION_SIZE + 1)).toBe(true);
        expect(isSessionTooLarge(LIMITS.MAX_SESSION_SIZE - 1)).toBe(false);
      });
    });

    describe('getSessionPath', () => {
      it('should generate valid session paths', () => {
        const path = getSessionPath('workspace-123', 'agent-456');
        expect(path).toContain('workspace-123');
        expect(path).toContain('agent-456');
        expect(path).toContain('.json');
      });
    });

    describe('getRecoveryPath', () => {
      it('should generate valid recovery paths', () => {
        const path = getRecoveryPath('workspace-123', 'agent-456');
        expect(path).toContain('workspace-123');
        expect(path).toContain('agent-456');
        expect(path).toContain('.recovery');
      });
    });
  });

  describe('Constants Type Safety', () => {
    it('should export all constant groups', () => {
      expect(TIMEOUTS).toBeDefined();
      expect(LIMITS).toBeDefined();
      expect(DEFAULTS).toBeDefined();
      expect(THRESHOLDS).toBeDefined();
      expect(PATHS).toBeDefined();
      expect(FILE_EXTENSIONS).toBeDefined();
      expect(PATTERNS).toBeDefined();
      expect(CACHE_TTL).toBeDefined();
      expect(RETRY).toBeDefined();
    });
  });
});
