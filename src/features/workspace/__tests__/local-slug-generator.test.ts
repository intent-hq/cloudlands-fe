/**
 * Tests for LocalSlugGenerator
 *
 * Ensures that generated slugs match the workspace ID validation schema.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  extractLocalSlug,
  generateLocalSlug,
} from '../main/local-slug-generator';

// The validation pattern from schemas.ts
const VALID_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;

describe('extractLocalSlug', () => {
  describe('valid slug generation', () => {
    it('should generate valid slug from action-noun pattern', () => {
      const slug = extractLocalSlug('fix the authentication bug');
      expect(slug).toBe('authentication-fix');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });

    it('should generate valid slug from noun-action pattern', () => {
      const slug = extractLocalSlug('auth refactor');
      expect(slug).toBe('auth-refactor');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });

    it('should generate valid slug from two words', () => {
      const slug = extractLocalSlug('dark mode implementation');
      expect(slug).toBe('dark-mode');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });

    it('should generate valid slug from single word with suffix', () => {
      const slug = extractLocalSlug('authentication');
      expect(slug).toBe('authentication-task');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });
  });

  describe('numeric input handling', () => {
    it('should return null for numeric-only input', () => {
      const slug = extractLocalSlug('123');
      expect(slug).toBeNull();
    });

    it('should return null for input with only numbers and spaces', () => {
      const slug = extractLocalSlug('123 456 789');
      expect(slug).toBeNull();
    });

    it('should filter out numeric words and use valid words', () => {
      const slug = extractLocalSlug('fix bug 123');
      expect(slug).toBe('bug-fix');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });

    it('should handle mixed alphanumeric words by filtering them out', () => {
      // Words like "bug123" contain numbers and should be filtered
      const slug = extractLocalSlug('fix bug123 issue');
      // "bug123" is filtered out, so we get "issue-fix"
      expect(slug).toBe('issue-fix');
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should return null for empty input', () => {
      expect(extractLocalSlug('')).toBeNull();
    });

    it('should return null for whitespace-only input', () => {
      expect(extractLocalSlug('   ')).toBeNull();
    });

    it('should return null for very short input', () => {
      expect(extractLocalSlug('ab')).toBeNull();
    });

    it('should handle input with only stop words', () => {
      const slug = extractLocalSlug('the and or but');
      expect(slug).toBeNull();
    });

    it('should treat "optimistic" as a stop word and exclude it from slugs', () => {
      const slug = extractLocalSlug('Optimistic update handler');
      expect(slug).not.toBeNull();
      expect(slug).not.toMatch(/optimistic/i);
      expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
      // Should produce "update-handler" since "optimistic" is filtered and "update" is an action word
      expect(slug).toBe('handler-update');
    });

    it('should strip context mentions', () => {
      const slug = extractLocalSlug('@context[some/file.ts] fix the bug');
      expect(slug).toBe('bug-fix');
    });

    it('should handle special characters', () => {
      const slug = extractLocalSlug('fix the bug! @#$%');
      expect(slug).toBe('bug-fix');
    });
  });

  describe('slug validation compliance', () => {
    // These tests ensure all generated slugs match the schema pattern
    const testCases = [
      'add dark mode',
      'fix authentication',
      'refactor api',
      'update readme',
      'create tests',
      'remove deprecated code',
      'implement feature',
      'build pipeline',
      'design system',
      'optimize performance',
    ];

    testCases.forEach((input) => {
      it(`should generate valid slug for "${input}"`, () => {
        const slug = extractLocalSlug(input);
        expect(slug).not.toBeNull();
        expect(VALID_SLUG_PATTERN.test(slug!)).toBe(true);
      });
    });
  });
});

describe('generateLocalSlug', () => {
  it('should return the same result as extractLocalSlug', () => {
    const input = 'fix the authentication bug';
    expect(generateLocalSlug(input)).toBe(extractLocalSlug(input));
  });

  it('should return null for invalid input', () => {
    expect(generateLocalSlug('123')).toBeNull();
  });
});
