import { describe, it, expect } from 'vitest';
import type { NoteVersion } from '../../../shared/types.js';
import { AuthorType } from '../../../shared/types.js';
import { attributeLines } from '../line-attribution.js';
import { Logger } from '../../../shared/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = new Logger('line-attribution-test');

/**
 * Line Attribution Algorithm Tests
 *
 * Goal: Given a note's current content and version history,
 * determine which version last modified each line.
 */

// Mock version helper
function createVersion(
  versionNumber: number,
  content: string,
  timestamp: string,
  authorType: AuthorType = AuthorType.User,
  authorId?: string,
  authorName?: string,
  turnNumber?: number,
): NoteVersion {
  const defaultAuthors = {
    [AuthorType.User]: { id: 'user-1', name: 'Test User' },
    [AuthorType.Agent]: { id: 'agent-1', name: 'Test Agent' },
    [AuthorType.System]: { id: 'system', name: 'System' },
  };

  const author = defaultAuthors[authorType];

  return {
    versionId: `version-${versionNumber}`,
    versionNumber,
    content,
    title: 'Test Note',
    author: {
      id: authorId || author.id,
      name: authorName || author.name,
      type: authorType,
      turnNumber,
    },
    createdAt: timestamp,
  };
}

describe('Line Attribution Algorithm', () => {
  describe('Basic Attribution', () => {
    it('should attribute all lines to the only version', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3';
      const versions = [createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z')];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions).toHaveLength(3);
      expect(attributions[0].version!.versionNumber).toBe(1);
      expect(attributions[1].version!.versionNumber).toBe(1);
      expect(attributions[2].version!.versionNumber).toBe(1);
    });

    it('should attribute new lines to the latest version', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.versionNumber).toBe(1); // Line 1 from v1
      expect(attributions[1].version!.versionNumber).toBe(2); // Line 2 added in v2
      expect(attributions[2].version!.versionNumber).toBe(2); // Line 3 added in v2
    });

    it('should attribute modified lines to the version that changed them', () => {
      const currentContent = 'Line 1\nLine 2 modified\nLine 3';
      const versions = [
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\nLine 2 modified\nLine 3', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.versionNumber).toBe(1); // Line 1 unchanged
      expect(attributions[1].version!.versionNumber).toBe(2); // Line 2 modified in v2
      expect(attributions[2].version!.versionNumber).toBe(1); // Line 3 unchanged
    });
  });

  describe('Duplicate Lines', () => {
    it('should handle duplicate lines with position-aware tracking', () => {
      const currentContent = 'logger.info("hello");\nlogger.info("hello");\nlogger.info("world");';
      const versions = [
        createVersion(1, 'logger.info("hello");\nlogger.info("world");', '2024-01-01T10:00:00Z'),
        createVersion(
          2,
          'logger.info("hello");\nlogger.info("hello");\nlogger.info("world");',
          '2024-01-01T10:05:00Z',
        ),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.versionNumber).toBe(1); // First hello from v1
      expect(attributions[1].version!.versionNumber).toBe(2); // Second hello added in v2
      expect(attributions[2].version!.versionNumber).toBe(1); // World from v1
    });

    it('should handle multiple identical lines modified at different times', () => {
      const currentContent = 'Line A\nLine A\nLine A';
      const versions = [
        createVersion(1, 'Line A', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line A\nLine A', '2024-01-01T10:05:00Z'),
        createVersion(3, 'Line A\nLine A\nLine A', '2024-01-01T10:10:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.versionNumber).toBe(1); // First A from v1
      expect(attributions[1].version!.versionNumber).toBe(2); // Second A from v2
      expect(attributions[2].version!.versionNumber).toBe(3); // Third A from v3
    });
  });

  describe('Whitespace Changes', () => {
    it('should ignore pure whitespace changes', () => {
      const currentContent = 'Line 1\n  Line 2\nLine 3';
      const versions = [
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\n  Line 2\nLine 3', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      // Line 2 should still be attributed to v1 (whitespace-only change ignored)
      expect(attributions[1].version!.versionNumber).toBe(1);
      expect(attributions[1].isWhitespaceOnly).toBe(true);
    });

    it('should track content changes even with whitespace differences', () => {
      const currentContent = 'Line 1\n  Line 2 modified\nLine 3';
      const versions = [
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\n  Line 2 modified\nLine 3', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      // Line 2 should be attributed to v2 (content changed, not just whitespace)
      expect(attributions[1].version!.versionNumber).toBe(2);
      expect(attributions[1].isWhitespaceOnly).toBe(false);
    });
  });

  describe('Deletions', () => {
    it('should handle deleted lines', () => {
      const currentContent = 'Line 1\nLine 3';
      const versions = [
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\nLine 3', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions).toHaveLength(2);
      expect(attributions[0].version!.versionNumber).toBe(1); // Line 1 from v1
      expect(attributions[1].version!.versionNumber).toBe(1); // Line 3 from v1
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle insertions in the middle', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3\nLine 4';
      const versions = [
        createVersion(1, 'Line 1\nLine 3\nLine 4', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\nLine 2\nLine 3\nLine 4', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.versionNumber).toBe(1); // Line 1 from v1
      expect(attributions[1].version!.versionNumber).toBe(2); // Line 2 inserted in v2
      expect(attributions[2].version!.versionNumber).toBe(1); // Line 3 from v1
      expect(attributions[3].version!.versionNumber).toBe(1); // Line 4 from v1
    });

    it('should handle multiple edits to the same line', () => {
      const currentContent = 'Line 1\nLine 2 v3\nLine 3';
      const versions = [
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
        createVersion(2, 'Line 1\nLine 2 v2\nLine 3', '2024-01-01T10:05:00Z'),
        createVersion(3, 'Line 1\nLine 2 v3\nLine 3', '2024-01-01T10:10:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      // Line 2 should be attributed to v3 (most recent change)
      expect(attributions[1].version!.versionNumber).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const currentContent = '';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z'),
        createVersion(2, '', '2024-01-01T10:05:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions).toHaveLength(0);
    });

    it('should handle no versions', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions: NoteVersion[] = [];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions).toHaveLength(2);
      expect(attributions[0].version).toBeNull();
      expect(attributions[1].version).toBeNull();
    });

    it('should handle lines older than version history', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3';
      const versions = [
        // Version 1 already had all lines (they're older than our history)
        createVersion(1, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:00:00Z'),
      ];

      const attributions = attributeLines(currentContent, versions);

      // All lines attributed to v1 (oldest version we have)
      expect(attributions[0].version!.versionNumber).toBe(1);
      expect(attributions[1].version!.versionNumber).toBe(1);
      expect(attributions[2].version!.versionNumber).toBe(1);
    });
  });

  describe('Author Types', () => {
    it('should correctly attribute lines to user-authored versions', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.User),
        createVersion(2, 'Line 1\nLine 2', '2024-01-01T10:05:00Z', AuthorType.User),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.author!.type).toBe(AuthorType.User);
      expect(attributions[1].version!.author!.type).toBe(AuthorType.User);
    });

    it('should correctly attribute lines to agent-authored versions', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.User),
        createVersion(
          2,
          'Line 1\nLine 2',
          '2024-01-01T10:05:00Z',
          AuthorType.Agent,
          'agent-123',
          'Code Assistant',
        ),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.author!.type).toBe(AuthorType.User);
      expect(attributions[1].version!.author!.type).toBe(AuthorType.Agent);
      expect(attributions[1].version!.author!.id).toBe('agent-123');
      expect(attributions[1].version!.author!.name).toBe('Code Assistant');
    });

    it('should correctly attribute lines to system-authored versions', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.System),
        createVersion(2, 'Line 1\nLine 2', '2024-01-01T10:05:00Z', AuthorType.User),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.author!.type).toBe(AuthorType.System);
      expect(attributions[1].version!.author!.type).toBe(AuthorType.User);
    });

    it('should handle mixed author types in version history', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3\nLine 4';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.System),
        createVersion(2, 'Line 1\nLine 2', '2024-01-01T10:05:00Z', AuthorType.User),
        createVersion(
          3,
          'Line 1\nLine 2\nLine 3',
          '2024-01-01T10:10:00Z',
          AuthorType.Agent,
          'agent-1',
          'Assistant',
        ),
        createVersion(4, 'Line 1\nLine 2\nLine 3\nLine 4', '2024-01-01T10:15:00Z', AuthorType.User),
      ];

      const attributions = attributeLines(currentContent, versions);

      expect(attributions[0].version!.author!.type).toBe(AuthorType.System);
      expect(attributions[1].version!.author!.type).toBe(AuthorType.User);
      expect(attributions[2].version!.author!.type).toBe(AuthorType.Agent);
      expect(attributions[3].version!.author!.type).toBe(AuthorType.User);
    });

    it('should preserve author information when lines are not modified', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3';
      const versions = [
        createVersion(
          1,
          'Line 1\nLine 2',
          '2024-01-01T10:00:00Z',
          AuthorType.Agent,
          'agent-1',
          'Assistant',
        ),
        createVersion(2, 'Line 1\nLine 2\nLine 3', '2024-01-01T10:05:00Z', AuthorType.User),
      ];

      const attributions = attributeLines(currentContent, versions);

      // Lines 1 and 2 should still be attributed to the agent version
      expect(attributions[0].version!.author!.type).toBe(AuthorType.Agent);
      expect(attributions[1].version!.author!.type).toBe(AuthorType.Agent);
      // Line 3 should be attributed to the user version
      expect(attributions[2].version!.author!.type).toBe(AuthorType.User);
    });
  });

  describe('Turn Number Attribution', () => {
    it('should preserve turn number from agent versions', () => {
      const currentContent = 'Line 1\nLine 2\nLine 3';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.Agent, 'agent-1', 'Agent', 1),
        createVersion(
          2,
          'Line 1\nLine 2',
          '2024-01-01T10:01:00Z',
          AuthorType.Agent,
          'agent-1',
          'Agent',
          2,
        ),
        createVersion(
          3,
          'Line 1\nLine 2\nLine 3',
          '2024-01-01T10:02:00Z',
          AuthorType.Agent,
          'agent-1',
          'Agent',
          3,
        ),
      ];

      const attributions = attributeLines(currentContent, versions);

      // Each line should have the turn number from the version that created it
      expect(attributions[0].version!.author!.turnNumber).toBe(1);
      expect(attributions[1].version!.author!.turnNumber).toBe(2);
      expect(attributions[2].version!.author!.turnNumber).toBe(3);
    });

    it('should handle missing turn numbers gracefully', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.Agent, 'agent-1', 'Agent', 1),
        createVersion(
          2,
          'Line 1\nLine 2',
          '2024-01-01T10:01:00Z',
          AuthorType.Agent,
          'agent-1',
          'Agent',
        ), // No turn number
      ];

      const attributions = attributeLines(currentContent, versions);

      // First line should have turn number
      expect(attributions[0].version!.author!.turnNumber).toBe(1);
      // Second line should have undefined turn number
      expect(attributions[1].version!.author!.turnNumber).toBeUndefined();
    });

    it('should not have turn numbers for user edits', () => {
      const currentContent = 'Line 1\nLine 2';
      const versions = [
        createVersion(1, 'Line 1', '2024-01-01T10:00:00Z', AuthorType.User),
        createVersion(2, 'Line 1\nLine 2', '2024-01-01T10:01:00Z', AuthorType.User),
      ];

      const attributions = attributeLines(currentContent, versions);

      // User edits should not have turn numbers
      expect(attributions[0].version!.author!.turnNumber).toBeUndefined();
      expect(attributions[1].version!.author!.turnNumber).toBeUndefined();
    });
  });
});
