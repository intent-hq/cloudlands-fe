/**
 * Unit Tests for Mention System Type Validation
 *
 * Tests validation functions and type guards from types.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isValidMentionCandidate,
  validateMentionData,
  isMentionGroup,
  hasRange,
  isSpecialCommand,
  type MentionCandidate,
  type MentionGroup,
  type MentionType,
} from '../../src/lib/services/mentions/types';

describe('Mention Type Validation', () => {
  describe('isValidMentionCandidate', () => {
    it('should validate a complete valid mention candidate', () => {
      const validCandidate: MentionCandidate = {
        id: 'test-file',
        type: 'file',
        label: 'test.ts',
        uri: 'file://test.ts',
        subtitle: 'src/test.ts',
        description: 'Test file',
        icon: '📄',
        score: 0.9,
      };

      expect(isValidMentionCandidate(validCandidate)).toBe(true);
    });

    it('should validate a minimal valid mention candidate', () => {
      const minimalCandidate = {
        id: 'test',
        type: 'file',
        label: 'test',
        uri: 'file://test',
      };

      expect(isValidMentionCandidate(minimalCandidate)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(isValidMentionCandidate(null)).toBe(false);
      expect(isValidMentionCandidate(undefined)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(isValidMentionCandidate('string')).toBe(false);
      expect(isValidMentionCandidate(123)).toBe(false);
      expect(isValidMentionCandidate(true)).toBe(false);
    });

    it('should reject candidates missing required id field', () => {
      const noId = {
        type: 'file',
        label: 'test',
        uri: 'file://test',
      };

      expect(isValidMentionCandidate(noId)).toBe(false);
    });

    it('should reject candidates missing required type field', () => {
      const noType = {
        id: 'test',
        label: 'test',
        uri: 'file://test',
      };

      expect(isValidMentionCandidate(noType)).toBe(false);
    });

    it('should reject candidates missing required label field', () => {
      const noLabel = {
        id: 'test',
        type: 'file',
        uri: 'file://test',
      };

      expect(isValidMentionCandidate(noLabel)).toBe(false);
    });

    it('should reject candidates missing required uri field', () => {
      const noUri = {
        id: 'test',
        type: 'file',
        label: 'test',
      };

      expect(isValidMentionCandidate(noUri)).toBe(false);
    });

    it('should reject candidates with wrong type for required fields', () => {
      const wrongTypes = {
        id: 123, // should be string
        type: 'file',
        label: 'test',
        uri: 'file://test',
      };

      expect(isValidMentionCandidate(wrongTypes)).toBe(false);
    });

    it('should reject candidates with wrong type for optional fields', () => {
      const wrongOptionalType = {
        id: 'test',
        type: 'file',
        label: 'test',
        uri: 'file://test',
        score: 'high', // should be number
      };

      expect(isValidMentionCandidate(wrongOptionalType)).toBe(false);
    });

    it('should accept candidates with valid optional fields', () => {
      const withOptionals = {
        id: 'test',
        type: 'file',
        label: 'test',
        uri: 'file://test',
        subtitle: 'subtitle',
        description: 'description',
        icon: '📄',
        score: 0.8,
      };

      expect(isValidMentionCandidate(withOptionals)).toBe(true);
    });
  });

  describe('validateMentionData', () => {
    it('should return valid for complete mention data', () => {
      const data = {
        id: 'test',
        type: 'file',
        label: 'test.ts',
        uri: 'file://test.ts',
      };

      const result = validateMentionData(data);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for null or undefined', () => {
      const nullResult = validateMentionData(null);
      expect(nullResult.valid).toBe(false);
      expect(nullResult.error).toBe('Mention data must be an object');

      const undefinedResult = validateMentionData(undefined);
      expect(undefinedResult.valid).toBe(false);
      expect(undefinedResult.error).toBe('Mention data must be an object');
    });

    it('should return error for non-object values', () => {
      const result = validateMentionData('string');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Mention data must be an object');
    });

    it('should return error for missing id', () => {
      const data = {
        type: 'file',
        label: 'test',
        uri: 'file://test',
      };

      const result = validateMentionData(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing required field: id');
    });

    it('should return error for missing type', () => {
      const data = {
        id: 'test',
        label: 'test',
        uri: 'file://test',
      };

      const result = validateMentionData(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing required field: type');
    });

    it('should return error for missing label', () => {
      const data = {
        id: 'test',
        type: 'file',
        uri: 'file://test',
      };

      const result = validateMentionData(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing required field: label');
    });

    it('should return error for missing uri', () => {
      const data = {
        id: 'test',
        type: 'file',
        label: 'test',
      };

      const result = validateMentionData(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing required field: uri');
    });
  });

  describe('isMentionGroup', () => {
    it('should identify mention groups with items', () => {
      const group: MentionGroup = {
        id: 'files',
        label: 'Files',
        items: [],
      };

      expect(isMentionGroup(group)).toBe(true);
    });

    it('should identify mention groups with subgroups', () => {
      const group: MentionGroup = {
        id: 'root',
        label: 'Root',
        subgroups: [],
      };

      expect(isMentionGroup(group)).toBe(true);
    });

    it('should not identify regular mention candidates as groups', () => {
      const candidate: MentionCandidate = {
        id: 'test',
        type: 'file',
        label: 'test.ts',
        uri: 'file://test.ts',
      };

      expect(isMentionGroup(candidate)).toBe(false);
    });
  });

  describe('hasRange', () => {
    it('should return true for file-range type', () => {
      expect(hasRange('file-range')).toBe(true);
    });

    it('should return true for note-range type', () => {
      expect(hasRange('note-range')).toBe(true);
    });

    it('should return false for file type', () => {
      expect(hasRange('file')).toBe(false);
    });

    it('should return false for note type', () => {
      expect(hasRange('note')).toBe(false);
    });

    it('should return false for other types', () => {
      const types: MentionType[] = ['folder', 'task', 'personality', 'command'];
      types.forEach((type) => {
        expect(hasRange(type)).toBe(false);
      });
    });
  });

  describe('isSpecialCommand', () => {
    it('should return true for command type', () => {
      expect(isSpecialCommand('command')).toBe(true);
    });

    it('should return false for non-command types', () => {
      const types: MentionType[] = ['file', 'folder', 'note', 'task', 'personality'];
      types.forEach((type) => {
        expect(isSpecialCommand(type)).toBe(false);
      });
    });
  });
});
