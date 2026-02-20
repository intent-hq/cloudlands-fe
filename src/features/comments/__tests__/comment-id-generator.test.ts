/**
 * Tests for comment ID generator
 */

import { describe, it, expect } from 'vitest';
import { generateCommentId, isValidCommentId } from '../comment-id-generator';

describe('Comment ID Generator', () => {
  describe('generateCommentId', () => {
    it('should generate a valid UUID v4', () => {
      const id = generateCommentId();

      // UUID v4 format: 8-4-4-4-12 hex digits
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it('should generate unique IDs', () => {
      const id1 = generateCommentId();
      const id2 = generateCommentId();
      const id3 = generateCommentId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should generate IDs that pass validation', () => {
      const id = generateCommentId();
      expect(isValidCommentId(id)).toBe(true);
    });
  });

  describe('isValidCommentId', () => {
    it('should validate correct UUID v4 format', () => {
      const validIds = [
        '550e8400-e29b-41d4-a716-446655440000',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      ];

      for (const id of validIds) {
        expect(isValidCommentId(id)).toBe(true);
      }
    });

    it('should reject invalid formats', () => {
      const invalidIds = [
        'cmt-1234567890-abc123', // Old format (no longer supported)
        'not-a-uuid',
        '550e8400-e29b-41d4-a716', // Too short
        '550e8400-e29b-41d4-a716-446655440000-extra', // Too long
        '550e8400-e29b-41d4-a716-44665544000g', // Invalid character
        '',
        '123',
      ];

      for (const id of invalidIds) {
        expect(isValidCommentId(id)).toBe(false);
      }
    });
  });
});
