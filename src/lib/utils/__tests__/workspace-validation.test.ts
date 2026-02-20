/**
 * Tests for workspace-validation utilities
 */

import { describe, it, expect } from 'vitest';
import { validateBranchPrefix, sanitizeBranchPrefix } from '../workspace-validation';

describe('workspace-validation', () => {
  describe('validateBranchPrefix', () => {
    describe('valid prefixes', () => {
      it('should accept empty string (no prefix)', () => {
        expect(validateBranchPrefix('')).toEqual({ valid: true });
      });

      it('should accept whitespace-only string (normalized to empty)', () => {
        expect(validateBranchPrefix('   ')).toEqual({ valid: true });
      });

      it('should accept simple path prefix', () => {
        expect(validateBranchPrefix('feature/')).toEqual({ valid: true });
      });

      it('should accept nested path prefix', () => {
        expect(validateBranchPrefix('user/john/')).toEqual({ valid: true });
      });

      it('should accept prefix with hyphen', () => {
        expect(validateBranchPrefix('my-feature/')).toEqual({ valid: true });
      });

      it('should accept prefix with underscore', () => {
        expect(validateBranchPrefix('my_prefix/')).toEqual({ valid: true });
      });

      it('should accept prefix without trailing separator', () => {
        expect(validateBranchPrefix('feature')).toEqual({ valid: true });
      });

      it('should accept prefix ending with hyphen', () => {
        expect(validateBranchPrefix('wip-')).toEqual({ valid: true });
      });

      it('should accept prefix with numbers', () => {
        expect(validateBranchPrefix('v2/feature/')).toEqual({ valid: true });
      });
    });

    describe('invalid prefixes', () => {
      it('should reject prefix with spaces', () => {
        const result = validateBranchPrefix('my feature/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with tilde', () => {
        const result = validateBranchPrefix('feature~/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with caret', () => {
        const result = validateBranchPrefix('feature^/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with colon', () => {
        const result = validateBranchPrefix('feature:/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with question mark', () => {
        const result = validateBranchPrefix('feature?/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with asterisk', () => {
        const result = validateBranchPrefix('feature*/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with square brackets', () => {
        const result = validateBranchPrefix('feature[1]/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix with backslash', () => {
        const result = validateBranchPrefix('feature\\/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should reject prefix starting with dot', () => {
        const result = validateBranchPrefix('.feature/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cannot start with a dot');
      });

      it('should reject prefix with consecutive dots', () => {
        const result = validateBranchPrefix('feature../');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('consecutive dots');
      });

      it('should reject prefix with consecutive slashes', () => {
        const result = validateBranchPrefix('feature//name/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('consecutive');
      });

      it('should reject prefix starting with slash', () => {
        const result = validateBranchPrefix('/feature/');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cannot start with a slash');
      });

      it('should reject prefix ending with .lock', () => {
        const result = validateBranchPrefix('feature.lock');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('.lock');
      });

      it('should reject overly long prefix', () => {
        const result = validateBranchPrefix('a'.repeat(51));
        expect(result.valid).toBe(false);
        expect(result.error).toContain('too long');
      });
    });
  });

  describe('sanitizeBranchPrefix', () => {
    it('should return empty string for empty input', () => {
      expect(sanitizeBranchPrefix('')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(sanitizeBranchPrefix('   ')).toBe('');
    });

    it('should add trailing slash if missing', () => {
      expect(sanitizeBranchPrefix('feature')).toBe('feature/');
    });

    it('should preserve trailing slash', () => {
      expect(sanitizeBranchPrefix('feature/')).toBe('feature/');
    });

    it('should preserve trailing hyphen', () => {
      expect(sanitizeBranchPrefix('wip-')).toBe('wip-');
    });

    it('should convert to lowercase', () => {
      expect(sanitizeBranchPrefix('Feature/')).toBe('feature/');
    });

    it('should replace invalid characters with hyphen', () => {
      expect(sanitizeBranchPrefix('my feature')).toBe('my-feature/');
    });

    it('should replace multiple consecutive hyphens with single', () => {
      expect(sanitizeBranchPrefix('my--feature')).toBe('my-feature/');
    });

    it('should replace consecutive slashes with single', () => {
      expect(sanitizeBranchPrefix('path//to/')).toBe('path/to/');
    });

    it('should remove leading dots and slashes', () => {
      expect(sanitizeBranchPrefix('./feature/')).toBe('feature/');
      expect(sanitizeBranchPrefix('/feature/')).toBe('feature/');
    });

    it('should remove .lock suffix', () => {
      expect(sanitizeBranchPrefix('feature.lock')).toBe('feature/');
    });

    it('should handle complex input', () => {
      // Multiple issues: leading dot, consecutive dots, space, uppercase
      const result = sanitizeBranchPrefix('..My Feature//Path/');
      expect(result).toBe('my-feature/path/');
    });

    it('should trim whitespace', () => {
      expect(sanitizeBranchPrefix('  feature/  ')).toBe('feature/');
    });
  });
});
