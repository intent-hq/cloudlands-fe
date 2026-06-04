/**
 * Tests for workspaces-link-handler.ts
 * Verifies parsing and generation of intent:// protocol links
 * including both short format (current workspace) and long format (cross-workspace)
 */

import { describe, it, expect } from 'vitest';
import { parseIntentLink, generateNoteLink } from '../workspaces-link-handler';

describe('workspaces-link-handler', () => {
  describe('parseIntentLink', () => {
    describe('short format (current workspace)', () => {
      it('should parse short format note links', () => {
        const result = parseIntentLink('intent://local/note/my-note-id');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('note');
        expect(result.orgId).toBe('local');
        expect(result.workspaceId).toBeUndefined();
        expect(result.resourceId).toBe('my-note-id');
      });

      it('should parse short format with UUID note ID', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const result = parseIntentLink(`intent://local/note/${uuid}`);
        expect(result.valid).toBe(true);
        expect(result.resourceId).toBe(uuid);
        expect(result.workspaceId).toBeUndefined();
      });

      it('should parse spec note', () => {
        const result = parseIntentLink('intent://local/note/spec');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('note');
        expect(result.resourceId).toBe('spec');
      });
    });

    describe('long format (cross-workspace)', () => {
      it('should parse long format with workspace ID', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/note/my-note-id');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('note');
        expect(result.orgId).toBe('local');
        expect(result.workspaceId).toBe('workspace-abc-123');
        expect(result.resourceId).toBe('my-note-id');
      });

      it('should parse long format with UUID workspace and note IDs', () => {
        const workspaceId = '123e4567-e89b-12d3-a456-426614174000';
        const noteId = '550e8400-e29b-41d4-a716-446655440000';
        const result = parseIntentLink(`intent://local/${workspaceId}/note/${noteId}`);
        expect(result.valid).toBe(true);
        expect(result.workspaceId).toBe(workspaceId);
        expect(result.resourceId).toBe(noteId);
      });

      it('should parse long format spec note from another workspace', () => {
        const result = parseIntentLink('intent://local/other-workspace/note/spec');
        expect(result.valid).toBe(true);
        expect(result.workspaceId).toBe('other-workspace');
        expect(result.resourceId).toBe('spec');
      });
    });

    // TODO: Workspace-level intent links are not implemented yet.
    // The parser only supports note and task resources, not workspace navigation.
    // These tests were removed because they test functionality that doesn't exist.

    describe('error cases', () => {
      it('should reject empty URL', () => {
        const result = parseIntentLink('');
        expect(result.valid).toBe(false);
      });

      it('should reject missing note ID', () => {
        const result = parseIntentLink('intent://local/note/');
        expect(result.valid).toBe(false);
        // URL parsing filters out empty segments, so this becomes invalid format
        expect(result.error).toContain('Invalid URL format');
      });

      it('should reject invalid format', () => {
        const result = parseIntentLink('intent://local/invalid');
        expect(result.valid).toBe(false);
      });

      it('should reject unknown resource type', () => {
        // "file" is not recognized as "note", so the parser tries the long format
        // where "file" would be workspace-id and needs 3+ segments
        const result = parseIntentLink('intent://local/file/some-file');
        expect(result.valid).toBe(false);
        // Parser sees "file" as potential workspace ID but "some-file" != "note"
        expect(result.error).toContain('Invalid URL format');
      });
    });
  });

  describe('generateNoteLink', () => {
    it('should generate short format when no workspaceId provided', () => {
      const link = generateNoteLink('my-note');
      expect(link).toBe('intent://local/note/my-note');
    });

    it('should generate long format when workspaceId provided', () => {
      const link = generateNoteLink('my-note', 'workspace-123');
      expect(link).toBe('intent://local/workspace-123/note/my-note');
    });

    it('should handle UUID note IDs', () => {
      const noteId = '550e8400-e29b-41d4-a716-446655440000';
      const link = generateNoteLink(noteId);
      expect(link).toBe(`intent://local/note/${noteId}`);
    });

    it('should generate spec link for cross-workspace', () => {
      const link = generateNoteLink('spec', 'other-workspace');
      expect(link).toBe('intent://local/other-workspace/note/spec');
    });
  });

  describe('round-trip parsing', () => {
    it('should round-trip short format links', () => {
      const noteId = 'my-note-123';
      const generated = generateNoteLink(noteId);
      const parsed = parseIntentLink(generated);

      expect(parsed.valid).toBe(true);
      expect(parsed.resourceId).toBe(noteId);
      expect(parsed.workspaceId).toBeUndefined();
    });

    it('should round-trip long format links', () => {
      const noteId = 'my-note-123';
      const workspaceId = 'workspace-abc';
      const generated = generateNoteLink(noteId, workspaceId);
      const parsed = parseIntentLink(generated);

      expect(parsed.valid).toBe(true);
      expect(parsed.resourceId).toBe(noteId);
      expect(parsed.workspaceId).toBe(workspaceId);
    });
  });
});
