import { describe, it, expect } from 'vitest';
import { isValidTaskNoteId, findInvalidTaskLinks } from './task-link-validator';

describe('task-link-validator', () => {
  describe('isValidTaskNoteId', () => {
    it('should accept valid UUIDs', () => {
      expect(isValidTaskNoteId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidTaskNoteId('72a6342c-bd9b-4d9b-939e-9ed2af6da3ca')).toBe(true);
    });

    it('should accept reserved IDs', () => {
      expect(isValidTaskNoteId('spec')).toBe(true);
    });

    it('should reject non-UUID strings', () => {
      expect(isValidTaskNoteId('note-mj0ggbr0')).toBe(false);
      expect(isValidTaskNoteId('note-abc123')).toBe(false);
      expect(isValidTaskNoteId('task-xyz')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidTaskNoteId('')).toBe(false);
      expect(isValidTaskNoteId('  ')).toBe(false);
    });
  });

  describe('findInvalidTaskLinks', () => {
    it('should find no invalid links in valid content', () => {
      const content = `
- [ ] [Phase 1](intent://local/task/550e8400-e29b-41d4-a716-446655440000)
- [ ] [Phase 2](intent://local/task/72a6342c-bd9b-4d9b-939e-9ed2af6da3ca)
      `;

      const result = findInvalidTaskLinks(content);
      expect(result.valid).toBe(true);
      expect(result.invalidLinks).toHaveLength(0);
    });

    it('should find invalid links with non-UUID IDs', () => {
      const content = `
- [ ] [Phase 1](intent://local/task/note-mj0ggbr0)
- [ ] [Phase 2](intent://local/task/note-abc123)
      `;

      const result = findInvalidTaskLinks(content);
      expect(result.valid).toBe(false);
      expect(result.invalidLinks).toHaveLength(2);
      expect(result.invalidLinks[0].noteId).toBe('note-mj0ggbr0');
      expect(result.invalidLinks[0].linkText).toBe('Phase 1');
      expect(result.invalidLinks[0].reason).toBe('non-uuid');
    });

    it('should find mixed valid and invalid links', () => {
      const content = `
- [ ] [Valid Task](intent://local/task/550e8400-e29b-41d4-a716-446655440000)
- [ ] [Invalid Task](intent://local/task/note-fake123)
      `;

      const result = findInvalidTaskLinks(content);
      expect(result.valid).toBe(false);
      expect(result.invalidLinks).toHaveLength(1);
      expect(result.invalidLinks[0].linkText).toBe('Invalid Task');
    });
  });
});
