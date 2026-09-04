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

    describe('file links', () => {
      it('should parse short format file links', () => {
        const result = parseIntentLink('intent://local/file/README.md');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('file');
        expect(result.orgId).toBe('local');
        expect(result.workspaceId).toBeUndefined();
        expect(result.resourceId).toBe('README.md');
        expect(result).not.toHaveProperty('line');
      });

      it('should parse a short file link with a line fragment', () => {
        const result = parseIntentLink('intent://local/file/src/a.ts#L10');

        expect(result).toMatchObject({
          type: 'file',
          resourceId: 'src/a.ts',
          line: 10,
          valid: true,
        });
      });

      it('should join nested path segments', () => {
        const result = parseIntentLink('intent://local/file/src/lib/utils/foo.ts');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('file');
        expect(result.resourceId).toBe('src/lib/utils/foo.ts');
      });

      it('should percent-decode path segments', () => {
        const result = parseIntentLink('intent://local/file/docs/my%20file%20(1).png');
        expect(result.valid).toBe(true);
        expect(result.resourceId).toBe('docs/my file (1).png');
      });

      it('should parse long format file links with workspace ID', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/file/a/b.png');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('file');
        expect(result.workspaceId).toBe('workspace-abc-123');
        expect(result.resourceId).toBe('a/b.png');
      });

      it('should parse a long file link with a line-range fragment', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/file/src/a.ts#L10-20');

        expect(result).toMatchObject({
          type: 'file',
          workspaceId: 'workspace-abc-123',
          resourceId: 'src/a.ts',
          line: 10,
          valid: true,
        });
      });

      it('should reject empty file path', () => {
        const result = parseIntentLink('intent://local/file/');
        expect(result.valid).toBe(false);
      });

      it('should reject long format file link without a path', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/file');
        expect(result.valid).toBe(false);
      });

      it('should reject traversal path components', () => {
        const result = parseIntentLink('intent://local/file/../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject percent-encoded traversal components', () => {
        const result = parseIntentLink('intent://local/file/a/%2e%2e/b');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject encoded-slash absolute paths', () => {
        const result = parseIntentLink('intent://local/file/%2Fetc%2Fpasswd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject traversal in long format links', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/file/../secret.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject absolute-looking paths with a leading empty segment', () => {
        const result = parseIntentLink('intent://local/file//etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject doubled-slash path components', () => {
        const result = parseIntentLink('intent://local/file/a//b');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject doubled-slash components in long format links', () => {
        const result = parseIntentLink('intent://local/workspace-abc-123/file//etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject dot workspace-ID segments in long format links', () => {
        const result = parseIntentLink('intent://local/../file/a.ts');
        expect(result.valid).toBe(false);
      });

      it('should reject percent-encoded dot workspace-ID segments', () => {
        const result = parseIntentLink('intent://local/%2e%2e/file/a.ts');
        expect(result.valid).toBe(false);
      });

      it('should reject Windows drive-letter paths', () => {
        const result = parseIntentLink('intent://local/file/C%3A/Windows/System32/config');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });

      it('should reject single-dot path components', () => {
        const result = parseIntentLink('intent://local/file/./a.ts');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file path');
      });
    });

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
        // "agent" is not a recognized resource type, so the parser tries the long
        // format where "agent" would be workspace-id and the second segment must
        // be a known resource type
        const result = parseIntentLink('intent://local/agent/some-agent');
        expect(result.valid).toBe(false);
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
