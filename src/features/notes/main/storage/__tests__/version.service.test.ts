/**
 * Tests for Version Service
 *
 * Tests snapshot/diff logic, reconstruction, pruning, and error recovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendVersion,
  readVersions,
  getContentAtVersion,
  hasSignificantChanges,
} from '../version.service';
import type { VersionAuthor } from '../note-storage.types';

describe('VersionService', () => {
  let tempDir: string;
  let versionsFile: string;
  const testAuthor: VersionAuthor = { id: 'user-1', name: 'Test User', type: 'user' };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-test-'));
    versionsFile = path.join(tempDir, 'test.versions.jsonl');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('appendVersion', () => {
    it('should create first version as snapshot', async () => {
      const content = '# First Version\n\nSome content here.';
      const entry = await appendVersion(versionsFile, content, testAuthor, 'Test Note');

      expect(entry.type).toBe('snapshot');
      expect(entry.v).toBe(1);
      expect(entry.content).toBe(content);
      expect(entry.author).toEqual(testAuthor);
    });

    it('should create second version as diff', async () => {
      const content1 = '# First Version';
      const content2 = '# Second Version';

      await appendVersion(versionsFile, content1, testAuthor);
      const entry2 = await appendVersion(versionsFile, content2, testAuthor);

      expect(entry2.type).toBe('diff');
      expect(entry2.v).toBe(2);
      expect(entry2.diff).toBeDefined();
    });

    it('should create snapshot at interval', async () => {
      // Create 10 versions (snapshot at 1 and 11)
      for (let i = 1; i <= 11; i++) {
        const content = `# Version ${i}`;
        await appendVersion(versionsFile, content, testAuthor);
      }

      const versions = await readVersions(versionsFile);
      // First should be snapshot, 11th should also be snapshot (interval of 10)
      expect(versions[0].type).toBe('snapshot');
      expect(versions[10].type).toBe('snapshot');
    });
  });

  describe('readVersions', () => {
    it('should return empty array for non-existent file', async () => {
      const versions = await readVersions('/non/existent/file.jsonl');
      expect(versions).toEqual([]);
    });

    it('should read all versions from file', async () => {
      await appendVersion(versionsFile, 'Content 1', testAuthor);
      await appendVersion(versionsFile, 'Content 2', testAuthor);
      await appendVersion(versionsFile, 'Content 3', testAuthor);

      const versions = await readVersions(versionsFile);
      expect(versions).toHaveLength(3);
      expect(versions[0].v).toBe(1);
      expect(versions[1].v).toBe(2);
      expect(versions[2].v).toBe(3);
    });

    it('should skip corrupted lines', async () => {
      // Write valid entries
      await appendVersion(versionsFile, 'Content 1', testAuthor);
      await appendVersion(versionsFile, 'Content 2', testAuthor);

      // Append corrupted line
      await fs.appendFile(versionsFile, 'not valid json\n');

      // Append another valid entry manually
      await fs.appendFile(
        versionsFile,
        `${JSON.stringify({
          type: 'snapshot',
          v: 3,
          date: new Date().toISOString(),
          author: testAuthor,
          content: 'Content 3',
        })}\n`,
      );

      const versions = await readVersions(versionsFile);
      // Should have 3 valid entries, corrupted line skipped
      expect(versions).toHaveLength(3);
      expect(versions[2].v).toBe(3);
    });

    it('should skip entries with missing required fields', async () => {
      await fs.writeFile(
        versionsFile,
        `${[
          JSON.stringify({
            type: 'snapshot',
            v: 1,
            date: new Date().toISOString(),
            author: testAuthor,
            content: 'Valid',
          }),
          JSON.stringify({ type: 'snapshot', date: new Date().toISOString() }), // missing v
          JSON.stringify({ v: 3, date: new Date().toISOString() }), // missing type
          JSON.stringify({
            type: 'snapshot',
            v: 4,
            date: new Date().toISOString(),
            author: testAuthor,
            content: 'Also valid',
          }),
        ].join('\n')}\n`,
      );

      const versions = await readVersions(versionsFile);
      expect(versions).toHaveLength(2);
      expect(versions[0].v).toBe(1);
      expect(versions[1].v).toBe(4);
    });
  });

  describe('getContentAtVersion', () => {
    it('should reconstruct content from snapshot', async () => {
      const content = '# My Note\n\nContent here.';
      await appendVersion(versionsFile, content, testAuthor);

      const result = await getContentAtVersion(versionsFile, 1);
      expect(result).toBe(content);
    });

    it('should reconstruct content by applying diffs', async () => {
      await appendVersion(versionsFile, '# Version 1\n\nLine 1', testAuthor);
      await appendVersion(versionsFile, '# Version 2\n\nLine 1\nLine 2', testAuthor);
      await appendVersion(versionsFile, '# Version 3\n\nLine 1\nLine 2\nLine 3', testAuthor);

      const v1 = await getContentAtVersion(versionsFile, 1);
      const v2 = await getContentAtVersion(versionsFile, 2);
      const v3 = await getContentAtVersion(versionsFile, 3);

      expect(v1).toBe('# Version 1\n\nLine 1');
      expect(v2).toBe('# Version 2\n\nLine 1\nLine 2');
      expect(v3).toBe('# Version 3\n\nLine 1\nLine 2\nLine 3');
    });
  });

  describe('hasSignificantChanges', () => {
    it('should detect significant changes', () => {
      const oldContent = '# Title\n\nParagraph one.';
      const newContent = '# Title\n\nParagraph one.\n\nParagraph two.';
      expect(hasSignificantChanges(oldContent, newContent)).toBe(true);
    });

    it('should detect trailing whitespace changes', () => {
      // Trailing whitespace changes are considered significant
      const oldContent = '# Title\n\nContent';
      const newContent = '# Title\n\nContent  ';
      expect(hasSignificantChanges(oldContent, newContent)).toBe(true);
    });

    it('should return false for identical content', () => {
      const content = '# Title\n\nContent';
      expect(hasSignificantChanges(content, content)).toBe(false);
    });

    it('should detect empty to content change', () => {
      expect(hasSignificantChanges('', '# New content')).toBe(true);
    });

    it('should detect content to empty change', () => {
      expect(hasSignificantChanges('# Content', '')).toBe(true);
    });
  });
});
