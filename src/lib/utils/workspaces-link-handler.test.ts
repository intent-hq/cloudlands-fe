import { describe, it, expect } from 'vitest';
import { parseIntentLink, generateNoteLink } from './workspaces-link-handler';
import { conversationMessageUrl } from '$shared/constants/intent-links';

describe('parseIntentLink', () => {
  describe('valid note links', () => {
    it('should parse basic note link', () => {
      const result = parseIntentLink('intent://local/note/spec');

      expect(result).toEqual({
        type: 'note',
        orgId: 'local',
        resourceId: 'spec',
        valid: true,
      });
    });

    it('should parse note link with UUID', () => {
      const result = parseIntentLink('intent://local/note/550e8400-e29b-41d4-a716-446655440000');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('note');
      expect(result.resourceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should parse note link with hyphenated name', () => {
      const result = parseIntentLink('intent://local/note/meeting-notes-2024-01-15');

      expect(result.valid).toBe(true);
      expect(result.resourceId).toBe('meeting-notes-2024-01-15');
    });

    it('should handle future org-id', () => {
      const result = parseIntentLink('intent://augment/note/spec');

      expect(result.valid).toBe(true);
      expect(result.orgId).toBe('augment');
      expect(result.resourceId).toBe('spec');
    });
  });

  describe('valid task links', () => {
    it('should parse basic task link', () => {
      const result = parseIntentLink('intent://local/task/550e8400-e29b-41d4-a716-446655440000');

      expect(result).toEqual({
        type: 'task',
        orgId: 'local',
        resourceId: '550e8400-e29b-41d4-a716-446655440000',
        valid: true,
      });
    });

    it('should parse task link with UUID', () => {
      const result = parseIntentLink('intent://local/task/abc12345-e29b-41d4-a716-446655440000');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('task');
      expect(result.resourceId).toBe('abc12345-e29b-41d4-a716-446655440000');
    });

    it('should handle task link with workspace id', () => {
      const result = parseIntentLink(
        'intent://local/workspace-123/task/550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result.valid).toBe(true);
      expect(result.type).toBe('task');
      expect(result.workspaceId).toBe('workspace-123');
      expect(result.resourceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('edge cases', () => {
    // TODO: Workspace-level intent links are not implemented yet.
    // The parser only supports note and task resources, not workspace navigation.
    // These tests were removed because they test functionality that doesn't exist.

    it('should still parse cross-workspace note when workspace-id literal is "workspace"', () => {
      // Edge case: workspace whose id is the literal string "workspace".
      // 3-segment form must continue to parse as a cross-workspace note link.
      const result = parseIntentLink('intent://local/workspace/note/spec');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('note');
      expect(result.workspaceId).toBe('workspace');
      expect(result.resourceId).toBe('spec');
    });

    it('should parse Chief workspace note links', () => {
      const result = parseIntentLink('intent://local/__chief__/note/chief-note-123');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('note');
      expect(result.workspaceId).toBe('__chief__');
      expect(result.resourceId).toBe('chief-note-123');
    });
  });

  describe('conversation message links', () => {
    it('generates and parses the canonical exact-message link', () => {
      const link = conversationMessageUrl('__chief__', 'agent-chief-1', 'msg-source-1');

      expect(link).toBe('intent://local/__chief__/agent/agent-chief-1/message/msg-source-1');
      expect(parseIntentLink(link)).toEqual({
        type: 'message',
        orgId: 'local',
        workspaceId: '__chief__',
        agentId: 'agent-chief-1',
        resourceId: 'msg-source-1',
        valid: true,
      });
    });

    it.each([
      'intent://local/__chief__/agent/agent-chief-1',
      'intent://local/__chief__/agent/agent-chief-1/message',
      'intent://local/__chief__/agent/agent-chief-1/message/msg-source-1/extra',
    ])('rejects incomplete or malformed message link %s', (link) => {
      expect(parseIntentLink(link).valid).toBe(false);
    });

    it.each(['.', '..', '%2e', '%2e%2e', '%2F', '%5C', 'workspace/other', 'workspace\\other'])(
      'rejects unsafe raw workspace segment %s',
      (workspaceSegment) => {
        const link = `intent://local/${workspaceSegment}/agent/agent-1/message/msg-1`;

        expect(parseIntentLink(link).valid).toBe(false);
      },
    );

    it.each(['.', '..', '%2e', '%2e%2e', '%2F', '%5C', 'agent/other', 'agent\\other'])(
      'rejects unsafe raw agent segment %s',
      (agentSegment) => {
        const link = `intent://local/workspace-1/agent/${agentSegment}/message/msg-1`;

        expect(parseIntentLink(link).valid).toBe(false);
      },
    );

    it.each(['.', '..', '%2e', '%2e%2e', '%2F', '%5C', 'msg/other', 'msg\\other'])(
      'rejects unsafe raw message segment %s',
      (messageSegment) => {
        const link = `intent://local/workspace-1/agent/agent-1/message/${messageSegment}`;

        expect(parseIntentLink(link).valid).toBe(false);
      },
    );
  });

  describe('invalid links', () => {
    it('should reject malformed URL with missing parts', () => {
      const result = parseIntentLink('intent://local');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL format');
    });

    it('should reject missing resource type', () => {
      const result = parseIntentLink('intent://local/spec');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL format');
    });

    it('should reject empty resource id', () => {
      const result = parseIntentLink('intent://local/note/');

      expect(result.valid).toBe(false);
    });

    it('should reject unknown resource type', () => {
      // Use a 3-segment path to test unknown resource type (workspace-id/unknown/resource-id)
      const result = parseIntentLink('intent://local/workspace-123/unknown/resource-id');

      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
      // The parser now expects 'note' as the resource type, so unknown types get "Invalid URL format"
      expect(result.error).toBeDefined();
    });
  });
});

describe('generateNoteLink', () => {
  it('should generate link with placeholder org-id "local"', () => {
    const link = generateNoteLink('spec');

    expect(link).toBe('intent://local/note/spec');
  });

  it('should handle UUID note ids', () => {
    const link = generateNoteLink('550e8400-e29b-41d4-a716-446655440000');

    expect(link).toBe('intent://local/note/550e8400-e29b-41d4-a716-446655440000');
  });

  it('should handle hyphenated note ids', () => {
    const link = generateNoteLink('meeting-notes-2024-01-15');

    expect(link).toBe('intent://local/note/meeting-notes-2024-01-15');
  });

  it('should round-trip with parseIntentLink', () => {
    const noteId = 'my-note-123';
    const link = generateNoteLink(noteId);
    const parsed = parseIntentLink(link);

    expect(parsed.valid).toBe(true);
    expect(parsed.resourceId).toBe(noteId);
    expect(parsed.type).toBe('note');
  });

  it('should generate cross-workspace note links', () => {
    const link = generateNoteLink('chief-note-123', '__chief__');
    const parsed = parseIntentLink(link);

    expect(link).toBe('intent://local/__chief__/note/chief-note-123');
    expect(parsed.valid).toBe(true);
    expect(parsed.workspaceId).toBe('__chief__');
    expect(parsed.resourceId).toBe('chief-note-123');
  });
});
