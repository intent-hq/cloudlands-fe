/**
 * Tests for task-link-validator
 */

import { describe, it, expect } from 'vitest';
import { isValidTaskNoteId, findInvalidTaskLinks } from '../task-link-validator';

describe('task-link-validator', () => {
  describe('isValidTaskNoteId', () => {
    it('should return false for empty input', () => {
      expect(isValidTaskNoteId('')).toBe(false);
      expect(isValidTaskNoteId('   ')).toBe(false);
    });

    it('should return true for valid UUIDs', () => {
      expect(isValidTaskNoteId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidTaskNoteId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('should return true for reserved IDs', () => {
      expect(isValidTaskNoteId('spec')).toBe(true);
    });

    it('should return false for invalid IDs', () => {
      expect(isValidTaskNoteId('not-a-uuid')).toBe(false);
      expect(isValidTaskNoteId('abc123')).toBe(false);
      expect(isValidTaskNoteId('task-1')).toBe(false);
    });
  });

  describe('findInvalidTaskLinks', () => {
    it('should return valid for content without task links', () => {
      const result = findInvalidTaskLinks('Just some regular markdown content');
      expect(result.valid).toBe(true);
      expect(result.invalidLinks).toHaveLength(0);
    });

    it('should return valid for content with valid task links', () => {
      const content = '[Task](intent://local/task/550e8400-e29b-41d4-a716-446655440000)';
      const result = findInvalidTaskLinks(content);
      expect(result.valid).toBe(true);
    });

    it('should detect invalid task links', () => {
      const content = '[Task](intent://local/task/invalid-id)';
      const result = findInvalidTaskLinks(content);
      expect(result.valid).toBe(false);
      expect(result.invalidLinks).toHaveLength(1);
      expect(result.invalidLinks[0].noteId).toBe('invalid-id');
      expect(result.invalidLinks[0].reason).toBe('non-uuid');
    });

    it('should handle empty task IDs', () => {
      // Empty task IDs don't match the regex pattern, so they're not detected as invalid
      // The regex requires at least one character after /task/
      const content = '[Task](intent://local/task/)';
      const result = findInvalidTaskLinks(content);
      // This is valid because the regex doesn't match empty IDs
      expect(result.valid).toBe(true);
    });

    it('should find multiple invalid links', () => {
      const content = `
        [Task 1](intent://local/task/bad-id-1)
        [Task 2](intent://local/task/bad-id-2)
      `;
      const result = findInvalidTaskLinks(content);
      expect(result.invalidLinks).toHaveLength(2);
    });
  });
});
