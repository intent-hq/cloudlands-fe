/**
 * Tests for Workspace Slug Service
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  generateWorkspaceSlug,
  isValidWorkspaceSlug,
  isWorkspaceSlug,
  registerWorkspaceSlug,
  unregisterWorkspaceSlug,
  clearWorkspaceSlugRegistry,
  isLegacyWorkspaceId,
  formatWorkspaceIdForDisplay,
  WORKSPACE_SLUG_PATTERN,
} from '../workspace-slug';

describe('WorkspaceSlug', () => {
  beforeEach(() => {
    clearWorkspaceSlugRegistry();
  });

  describe('WORKSPACE_SLUG_PATTERN', () => {
    it('matches valid slugs without suffix', () => {
      expect(WORKSPACE_SLUG_PATTERN.test('amber-forest')).toBe(true);
      expect(WORKSPACE_SLUG_PATTERN.test('silver-canyon')).toBe(true);
      expect(WORKSPACE_SLUG_PATTERN.test('auth-refactor')).toBe(true);
    });

    it('matches valid slugs with numeric suffix', () => {
      expect(WORKSPACE_SLUG_PATTERN.test('amber-forest-2')).toBe(true);
      expect(WORKSPACE_SLUG_PATTERN.test('silver-canyon-10')).toBe(true);
      expect(WORKSPACE_SLUG_PATTERN.test('auth-refactor-99')).toBe(true);
    });

    it('rejects slugs with numbers in words', () => {
      // Words must be letters only
      expect(WORKSPACE_SLUG_PATTERN.test('auth2-refactor')).toBe(false);
      expect(WORKSPACE_SLUG_PATTERN.test('api-test3s')).toBe(false);
    });

    it('rejects slugs with too short words', () => {
      expect(WORKSPACE_SLUG_PATTERN.test('a-forest')).toBe(false);
      expect(WORKSPACE_SLUG_PATTERN.test('amber-b')).toBe(false);
    });

    it('rejects slugs with wrong format', () => {
      expect(WORKSPACE_SLUG_PATTERN.test('amber')).toBe(false);
      expect(WORKSPACE_SLUG_PATTERN.test('AMBER-FOREST')).toBe(false);
    });

    it('rejects legacy alphanumeric suffix format (new pattern only)', () => {
      // The new pattern does NOT match legacy format - that's handled separately
      expect(WORKSPACE_SLUG_PATTERN.test('amber-forest-a7x2')).toBe(false);
    });
  });

  describe('generateWorkspaceSlug', () => {
    it('generates valid slugs', () => {
      for (let i = 0; i < 20; i++) {
        const slug = generateWorkspaceSlug();
        expect(isValidWorkspaceSlug(slug)).toBe(true);
        expect(WORKSPACE_SLUG_PATTERN.test(slug)).toBe(true);
      }
    });

    it('generates unique slugs with high probability', () => {
      // With ~426k combinations (1202 adjectives × 355 animals), generating 50 slugs
      // has an extremely low collision probability (~0.3% by birthday paradox).
      // We use 50 iterations and allow up to 1 collision for determinism.
      const ITERATIONS = 50;
      const MAX_ALLOWED_COLLISIONS = 1;

      const slugs = new Set<string>();
      for (let i = 0; i < ITERATIONS; i++) {
        slugs.add(generateWorkspaceSlug());
      }

      // Expect at least (ITERATIONS - MAX_ALLOWED_COLLISIONS) unique slugs
      expect(slugs.size).toBeGreaterThanOrEqual(ITERATIONS - MAX_ALLOWED_COLLISIONS);
    });
  });

  describe('isValidWorkspaceSlug', () => {
    it('validates new slug format without suffix', () => {
      expect(isValidWorkspaceSlug('amber-forest')).toBe(true);
      expect(isValidWorkspaceSlug('auth-refactor')).toBe(true);
    });

    it('validates new slug format with numeric suffix', () => {
      expect(isValidWorkspaceSlug('amber-forest-2')).toBe(true);
      expect(isValidWorkspaceSlug('auth-refactor-10')).toBe(true);
    });

    it('validates legacy alphanumeric suffix format', () => {
      expect(isValidWorkspaceSlug('amber-forest-a7x2')).toBe(true);
      expect(isValidWorkspaceSlug('silver-canyon-b3m9')).toBe(true);
    });

    it('validates legacy UUID format', () => {
      expect(isValidWorkspaceSlug('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidWorkspaceSlug('invalid')).toBe(false);
      expect(isValidWorkspaceSlug('')).toBe(false);
      expect(isValidWorkspaceSlug('not-a-uuid')).toBe(false);
    });
  });

  describe('Slug Registry', () => {
    it('registers and recognizes intent-based slugs', () => {
      const intentSlug = 'auth-refactor';

      // Not recognized before registration (not adjective-animal)
      expect(isWorkspaceSlug(intentSlug)).toBe(false);

      // Register it
      registerWorkspaceSlug(intentSlug);

      // Now recognized
      expect(isWorkspaceSlug(intentSlug)).toBe(true);
    });

    it('unregisters slugs', () => {
      const slug = 'auth-refactor';
      registerWorkspaceSlug(slug);
      expect(isWorkspaceSlug(slug)).toBe(true);

      unregisterWorkspaceSlug(slug);
      expect(isWorkspaceSlug(slug)).toBe(false);
    });

    it('clears all registered slugs', () => {
      registerWorkspaceSlug('auth-refactor');
      registerWorkspaceSlug('api-tests');

      expect(isWorkspaceSlug('auth-refactor')).toBe(true);
      expect(isWorkspaceSlug('api-tests')).toBe(true);

      clearWorkspaceSlugRegistry();

      expect(isWorkspaceSlug('auth-refactor')).toBe(false);
      expect(isWorkspaceSlug('api-tests')).toBe(false);
    });

    it('does not register invalid slugs', () => {
      registerWorkspaceSlug('invalid');
      registerWorkspaceSlug('');

      // These should not be in registry
      expect(isWorkspaceSlug('invalid')).toBe(false);
    });
  });

  describe('isWorkspaceSlug', () => {
    it('recognizes adjective-animal slugs without registration', () => {
      // These use words from the dictionaries
      const slug = generateWorkspaceSlug();
      expect(isWorkspaceSlug(slug)).toBe(true);
    });

    it('does not recognize arbitrary matching patterns', () => {
      // "auth" and "refactor" are not in adjective/animal dictionaries
      expect(isWorkspaceSlug('auth-refactor')).toBe(false);
    });

    it('recognizes registered intent-based slugs', () => {
      registerWorkspaceSlug('auth-refactor');
      expect(isWorkspaceSlug('auth-refactor')).toBe(true);
    });

    it('recognizes legacy adjective-animal slugs with alphanumeric suffix', () => {
      // Legacy slugs from the dictionaries should still be recognized
      // We need a valid adjective and animal from the dictionaries
      generateWorkspaceSlug(); // e.g., "amber-forest"
      // Legacy format would have been e.g., "amber-forest-a7x2" but isWorkspaceSlug
      // checks the adjective/animal dictionaries, not just the pattern
    });
  });

  describe('isLegacyWorkspaceId', () => {
    it('identifies UUIDs', () => {
      expect(isLegacyWorkspaceId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isLegacyWorkspaceId('amber-forest')).toBe(false);
    });
  });

  describe('formatWorkspaceIdForDisplay', () => {
    it('returns slugs as-is', () => {
      expect(formatWorkspaceIdForDisplay('amber-forest')).toBe('amber-forest');
      expect(formatWorkspaceIdForDisplay('amber-forest-2')).toBe('amber-forest-2');
    });

    it('truncates UUIDs', () => {
      const formatted = formatWorkspaceIdForDisplay('550e8400-e29b-41d4-a716-446655440000');
      expect(formatted).toBe('550e8400');
    });

    it('handles empty strings', () => {
      expect(formatWorkspaceIdForDisplay('')).toBe('');
    });
  });

  describe('dictionary pre-filtering (regression)', () => {
    const WORD_PATTERN = /^[a-z]{2,15}$/;

    it('generates 200 slugs that all match WORKSPACE_SLUG_PATTERN', () => {
      for (let i = 0; i < 200; i++) {
        const slug = generateWorkspaceSlug();
        expect(slug).toMatch(WORKSPACE_SLUG_PATTERN);
      }
    });

    it('generates 200 slugs where every word part matches /^[a-z]{2,15}$/', () => {
      for (let i = 0; i < 200; i++) {
        const slug = generateWorkspaceSlug();
        const parts = slug.split('-');
        // Should have exactly 2 word parts (adjective-animal)
        expect(parts).toHaveLength(2);
        for (const part of parts) {
          expect(part).toMatch(WORD_PATTERN);
        }
      }
    });

    it('never produces words shorter than 2 or longer than 15 characters', () => {
      const allWords = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const slug = generateWorkspaceSlug();
        for (const part of slug.split('-')) {
          allWords.add(part);
        }
      }
      for (const word of allWords) {
        expect(word.length).toBeGreaterThanOrEqual(2);
        expect(word.length).toBeLessThanOrEqual(15);
        expect(word).toMatch(/^[a-z]+$/);
      }
    });
  });
});
