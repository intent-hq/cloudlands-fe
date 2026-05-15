/**
 * Tests for Error Recovery Module
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  getRecoverySuggestions,
  getRecoveryHints,
  RECOVERY_SUGGESTIONS,
  type RecoverySuggestion,
} from '../recovery';

describe('Error Recovery Module', () => {
  describe('getRecoverySuggestions', () => {
    it('should return suggestions for known error code', () => {
      const suggestions = getRecoverySuggestions('AGENT_CREATION_FAILED');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should return default suggestion for unknown error code', () => {
      const suggestions = getRecoverySuggestions('UNKNOWN_ERROR');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].action).toBe('retry');
    });

    it('should have valid suggestion structure', () => {
      const suggestions = getRecoverySuggestions('STREAM_INTERRUPTED');
      suggestions.forEach((suggestion: RecoverySuggestion) => {
        expect(suggestion.action).toBeTruthy();
        expect(suggestion.description).toBeTruthy();
        expect(typeof suggestion.automatic).toBe('boolean');
        expect(['high', 'medium', 'low']).toContain(suggestion.priority);
      });
    });

    it('should prioritize high-priority suggestions', () => {
      const suggestions = getRecoverySuggestions('STREAM_INTERRUPTED');
      const highPriority = suggestions.filter((s) => s.priority === 'high');
      expect(highPriority.length).toBeGreaterThan(0);
    });

    it('should include automatic recovery suggestions where applicable', () => {
      const suggestions = getRecoverySuggestions('STREAM_INTERRUPTED');
      const automatic = suggestions.filter((s) => s.automatic);
      expect(automatic.length).toBeGreaterThan(0);
    });
  });

  describe('getRecoveryHints', () => {
    it('should return recovery hints with suggestions', () => {
      const hints = getRecoveryHints('AGENT_CREATION_FAILED');
      expect(hints.code).toBe('AGENT_CREATION_FAILED');
      expect(Array.isArray(hints.suggestions)).toBe(true);
      expect(hints.suggestions.length).toBeGreaterThan(0);
    });

    it('should include help link when provided', () => {
      const helpLink = 'https://example.com/help';
      const hints = getRecoveryHints('AGENT_CREATION_FAILED', helpLink);
      expect(hints.helpLink).toBe(helpLink);
    });

    it('should work without help link', () => {
      const hints = getRecoveryHints('AGENT_CREATION_FAILED');
      expect(hints.code).toBeTruthy();
      expect(hints.suggestions).toBeTruthy();
    });
  });

  describe('Recovery Suggestions Structure', () => {
    it('should have suggestions for all major error categories', () => {
      const categories = [
        'AGENT_CREATION_FAILED',
        'STREAM_INTERRUPTED',
        'STORAGE_CORRUPTED',
        'MEMORY_LIMIT_EXCEEDED',
      ];

      categories.forEach((code) => {
        expect(RECOVERY_SUGGESTIONS[code]).toBeTruthy();
        expect(Array.isArray(RECOVERY_SUGGESTIONS[code])).toBe(true);
      });
    });

    it('should have valid action names', () => {
      const validActions = [
        'retry',
        'check-config',
        'check-resources',
        'rename',
        'delete-existing',
        'review-config',
        'use-defaults',
        'start-new',
        'check-history',
        'reconnect',
        'check-connection',
        'wait',
        'cancel',
        'increase-timeout',
        'restart',
        'recreate',
        'restore',
        'reset',
        'cleanup',
        'increase-limit',
        'batch',
        'queue',
        'close-agents',
      ];

      Object.values(RECOVERY_SUGGESTIONS).forEach((suggestions) => {
        suggestions.forEach((suggestion) => {
          expect(validActions).toContain(suggestion.action);
        });
      });
    });

    it('should have descriptions for all suggestions', () => {
      Object.values(RECOVERY_SUGGESTIONS).forEach((suggestions) => {
        suggestions.forEach((suggestion) => {
          expect(suggestion.description).toBeTruthy();
          expect(suggestion.description.length).toBeGreaterThan(0);
        });
      });
    });

    it('should have consistent priority levels', () => {
      const validPriorities = ['high', 'medium', 'low'];
      Object.values(RECOVERY_SUGGESTIONS).forEach((suggestions) => {
        suggestions.forEach((suggestion) => {
          expect(validPriorities).toContain(suggestion.priority);
        });
      });
    });
  });

  describe('Automatic Recovery', () => {
    it('should mark reconnection as automatic', () => {
      const suggestions = getRecoverySuggestions('STREAM_INTERRUPTED');
      const reconnect = suggestions.find((s) => s.action === 'reconnect');
      expect(reconnect?.automatic).toBe(true);
    });

    it('should mark process restart as automatic', () => {
      const suggestions = getRecoverySuggestions('PROVIDER_PROCESS_DIED');
      const restart = suggestions.find((s) => s.action === 'restart');
      expect(restart?.automatic).toBe(true);
    });

    it('should mark manual actions as non-automatic', () => {
      const suggestions = getRecoverySuggestions('AGENT_CREATION_FAILED');
      const manual = suggestions.filter((s) => !s.automatic);
      expect(manual.length).toBeGreaterThan(0);
    });
  });
});
