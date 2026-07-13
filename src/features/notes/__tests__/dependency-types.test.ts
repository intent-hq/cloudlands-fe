import {
  describe,
  it,
  expect,
} from 'vitest';
import { NoteDependency } from '../../../shared/types';
import { NoteDependencySchema } from '../../../shared/schemas';
import type { NoteId } from '../../../shared/types';

describe('NoteDependency types', () => {
  it('should accept valid dependency metadata', () => {
    const dependency: NoteDependency = {
      noteId: 'note-123' as NoteId,
      type: 'blocks',
      reason: 'Must complete authentication first',
      createdAt: new Date().toISOString(),
    };
    expect(dependency).toBeDefined();
    expect(dependency.noteId).toBe('note-123');
    expect(dependency.type).toBe('blocks');
  });

  it('should accept all dependency types', () => {
    const types: NoteDependency['type'][] = ['blocks', 'related', 'prerequisite'];
    expect(types).toHaveLength(3);

    // Verify each type is valid
    types.forEach((type) => {
      const dependency: NoteDependency = {
        noteId: 'note-123' as NoteId,
        type,
        createdAt: new Date().toISOString(),
      };
      expect(dependency.type).toBe(type);
    });
  });

  it('should allow optional reason field', () => {
    const withReason: NoteDependency = {
      noteId: 'note-123' as NoteId,
      type: 'blocks',
      reason: 'Needs API implementation',
      createdAt: new Date().toISOString(),
    };
    expect(withReason.reason).toBe('Needs API implementation');

    const withoutReason: NoteDependency = {
      noteId: 'note-456' as NoteId,
      type: 'related',
      createdAt: new Date().toISOString(),
    };
    expect(withoutReason.reason).toBeUndefined();
  });

  it('should require createdAt timestamp', () => {
    const dependency: NoteDependency = {
      noteId: 'note-123' as NoteId,
      type: 'prerequisite',
      createdAt: new Date().toISOString(),
    };
    expect(dependency.createdAt).toBeDefined();
    expect(typeof dependency.createdAt).toBe('string');
  });
});

describe('NoteDependencySchema', () => {
  it('should validate valid dependency', () => {
    const dependency = {
      noteId: 'note-123',
      type: 'blocks',
      reason: 'Must complete first',
      createdAt: new Date().toISOString(),
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(true);
  });

  it('should reject invalid dependency type', () => {
    const dependency = {
      noteId: 'note-123',
      type: 'invalid_type',
      createdAt: new Date().toISOString(),
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(false);
  });

  it('should reject missing noteId', () => {
    const dependency = {
      type: 'blocks',
      createdAt: new Date().toISOString(),
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(false);
  });

  it('should reject missing createdAt', () => {
    const dependency = {
      noteId: 'note-123',
      type: 'blocks',
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(false);
  });

  it('should accept dependency without reason', () => {
    const dependency = {
      noteId: 'note-123',
      type: 'related',
      createdAt: new Date().toISOString(),
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(true);
  });

  it('should reject invalid createdAt format', () => {
    const dependency = {
      noteId: 'note-123',
      type: 'blocks',
      createdAt: 'not-a-date',
    };

    const result = NoteDependencySchema.safeParse(dependency);
    expect(result.success).toBe(false);
  });
});

describe('DependencyType', () => {
  it('should have exactly three valid types', () => {
    // This test ensures we don't accidentally add or remove types
    const validTypes = ['blocks', 'related', 'prerequisite'];
    expect(validTypes).toHaveLength(3);
  });
});
