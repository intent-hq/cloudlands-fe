/**
 * Tests for Trash Service
 *
 * Tests moveToTrash, restore, listTrash, purgeExpiredTrash
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { moveToTrash } from '../trash.service';
import type { NoteStoragePaths } from '../note-storage.types';

describe('TrashService', () => {
  let tempDir: string;

  // Helper to create test paths
  function createTestPaths(noteId: string): NoteStoragePaths {
    return {
      notesDir: path.join(tempDir, 'notes'),
      metaDir: path.join(tempDir, 'notes', '.meta'),
      trashDir: path.join(tempDir, 'notes', '.meta', '.trash'),
      contentFile: path.join(tempDir, 'notes', `${noteId}.md`),
      versionsFile: path.join(tempDir, 'notes', '.meta', `${noteId}.versions.jsonl`),
      crdtFile: path.join(tempDir, 'notes', '.meta', `${noteId}.crdt`),
      commentsFile: path.join(tempDir, 'notes', '.meta', `${noteId}.comments.json`),
      lineAttributionFile: path.join(tempDir, 'notes', '.meta', `${noteId}.line-attribution.json`),
      trashContentFile: path.join(tempDir, 'notes', '.meta', '.trash', `${noteId}.md`),
      trashMetaFile: path.join(tempDir, 'notes', '.meta', '.trash', `${noteId}.trash.json`),
    };
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trash-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('moveToTrash', () => {
    it('should move note content to trash', async () => {
      const paths = createTestPaths('test-note');
      const content = '# Test Note\n\nContent here.';

      // Create note
      await fs.mkdir(paths.notesDir, { recursive: true });
      await fs.writeFile(paths.contentFile, content);

      // Move to trash
      await moveToTrash(paths, 'Test Note', 'user-1');

      // Verify original is deleted
      await expect(fs.access(paths.contentFile)).rejects.toThrow();

      // Verify trash content exists
      const trashContent = await fs.readFile(paths.trashContentFile, 'utf-8');
      expect(trashContent).toBe(content);

      // Verify trash metadata exists
      const trashMeta = JSON.parse(await fs.readFile(paths.trashMetaFile, 'utf-8'));
      expect(trashMeta.noteTitle).toBe('Test Note');
      expect(trashMeta.deletedBy).toBe('user-1');
      expect(trashMeta.deletedAt).toBeDefined();
      expect(trashMeta.expiresAt).toBeDefined();
    });

    it('should handle note without content file', async () => {
      const paths = createTestPaths('empty-note');

      // Move to trash without creating content file
      await moveToTrash(paths, 'Empty Note', 'user-1');

      // Should not throw, trash meta should exist
      const trashMeta = JSON.parse(await fs.readFile(paths.trashMetaFile, 'utf-8'));
      expect(trashMeta.noteTitle).toBe('Empty Note');
    });

    it('should set correct expiration date', async () => {
      const paths = createTestPaths('expiry-note');

      await moveToTrash(paths, 'Expiry Note', 'user-1');

      const trashMeta = JSON.parse(await fs.readFile(paths.trashMetaFile, 'utf-8'));
      const deletedAt = new Date(trashMeta.deletedAt);
      const expiresAt = new Date(trashMeta.expiresAt);

      // Should expire 30 days after deletion
      const expectedExpiry = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });
  });
});
