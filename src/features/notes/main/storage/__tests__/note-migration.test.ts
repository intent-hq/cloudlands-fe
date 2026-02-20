/**
 * Tests for note migration from legacy JSON format to frontmatter format
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { migrateWorkspaceNotes, workspaceNeedsMigration } from '../note-migration';
import { getNoteStoragePaths, getLegacyNotePath } from '../note-storage-paths';
import { FolderBasedNotesRepository } from '../folder-notes.repository';
import { crdtDocumentManager } from '../crdt-document-manager';
import { setGitEnabled } from '../git-version.service';
import { parseFrontmatter } from '../frontmatter';
import { ContentType, NoteVisibility, AuthorType } from '../../../../../shared/types';
import type { Note, NoteId, WorkspaceId } from '../../../../../shared/types';
import { WorkspaceConfig } from '../../../../../shared/main/config';

// Test workspace ID
const TEST_WORKSPACE_ID = 'test-workspace-migration' as WorkspaceId;
const TEST_NOTE_ID = 'test-note-migrate' as NoteId;

// Helper to create a legacy note JSON
function createLegacyNoteJson(noteId: NoteId): Note {
  const now = new Date().toISOString();
  return {
    id: noteId,
    workspaceId: TEST_WORKSPACE_ID,
    title: 'Legacy Note',
    content: '# Legacy Content\n\nThis is a legacy note.',
    contentType: ContentType.Markdown,
    tags: ['legacy'],
    isPinned: false,
    isArchived: false,
    isDefault: false,
    visibility: NoteVisibility.Workspace,
    metadata: {
      author: {
        id: 'user',
        name: 'Test User',
        type: AuthorType.User,
      },
      wordCount: 5,
      characterCount: 40,
    },
    references: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('Note Migration', () => {
  let notesDir: string;

  // Disable git for tests
  beforeAll(() => {
    setGitEnabled(false);
  });

  afterAll(() => {
    setGitEnabled(true);
  });

  beforeEach(async () => {
    notesDir = WorkspaceConfig.paths.notes(TEST_WORKSPACE_ID);

    // Clean up any existing test data
    try {
      await fs.rm(notesDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }

    // Create notes directory
    await fs.mkdir(notesDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await fs.rm(notesDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }

    // Clear CRDT cache
    crdtDocumentManager.clearCache();
  });

  describe('workspaceNeedsMigration', () => {
    it('should return true when legacy JSON files exist', async () => {
      // Create a legacy note file
      const legacyPath = getLegacyNotePath(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      const legacyNote = createLegacyNoteJson(TEST_NOTE_ID);
      await fs.writeFile(legacyPath, JSON.stringify(legacyNote, null, 2));

      const needsMigration = await workspaceNeedsMigration(TEST_WORKSPACE_ID);
      expect(needsMigration).toBe(true);
    });

    it('should return false when no legacy files exist', async () => {
      const needsMigration = await workspaceNeedsMigration(TEST_WORKSPACE_ID);
      expect(needsMigration).toBe(false);
    });

    it('should return false when only folder-based notes exist', async () => {
      // Create a folder-based note
      const repository = new FolderBasedNotesRepository();
      const note = createLegacyNoteJson(TEST_NOTE_ID);
      await repository.save(note);

      const needsMigration = await workspaceNeedsMigration(TEST_WORKSPACE_ID);
      expect(needsMigration).toBe(false);
    });
  });

  describe('migrateWorkspaceNotes', () => {
    it('should migrate legacy notes to frontmatter format', async () => {
      // Create a legacy note file
      const legacyPath = getLegacyNotePath(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      const legacyNote = createLegacyNoteJson(TEST_NOTE_ID);
      await fs.writeFile(legacyPath, JSON.stringify(legacyNote, null, 2));

      // Run migration
      const result = await migrateWorkspaceNotes(TEST_WORKSPACE_ID);

      expect(result.migratedNotes).toBe(1);
      expect(result.failedNotes).toBe(0);

      // Verify folder-based note exists
      const paths = getNoteStoragePaths(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      const contentExists = await fs
        .access(paths.contentFile)
        .then(() => true)
        .catch(() => false);
      expect(contentExists).toBe(true);

      // Verify file has frontmatter + content
      const fileContent = await fs.readFile(paths.contentFile, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(fileContent);

      // Verify frontmatter contains metadata from legacy note
      expect(frontmatter).not.toBeNull();
      expect(frontmatter!.id).toBe(legacyNote.id);
      expect(frontmatter!.title).toBe(legacyNote.title);
      expect(frontmatter!.tags).toEqual(legacyNote.tags);

      // Verify content is preserved
      expect(content).toBe(legacyNote.content);

      // Verify legacy file is removed
      const legacyExists = await fs
        .access(legacyPath)
        .then(() => true)
        .catch(() => false);
      expect(legacyExists).toBe(false);
    });

    it('should handle empty workspace gracefully', async () => {
      const result = await migrateWorkspaceNotes(TEST_WORKSPACE_ID);

      expect(result.migratedNotes).toBe(0);
      expect(result.failedNotes).toBe(0);
    });

    it('should recover content when .md is empty but .json has content', async () => {
      // This tests the critical recovery scenario where:
      // 1. An empty spec.md was created (e.g., during a crash or race condition)
      // 2. The legacy spec.json still has the actual content
      // 3. Migration should recover the content from .json
      const specNoteId = 'spec' as NoteId;

      // Create a legacy note with content
      const legacyPath = getLegacyNotePath(TEST_WORKSPACE_ID, specNoteId);
      const legacyNote = createLegacyNoteJson(specNoteId);
      legacyNote.title = 'Spec';
      legacyNote.content = '# My Important Spec\n\nThis content must NOT be lost!';
      await fs.writeFile(legacyPath, JSON.stringify(legacyNote, null, 2));

      // Create an empty .md file with frontmatter (simulating the bug scenario)
      const paths = getNoteStoragePaths(TEST_WORKSPACE_ID, specNoteId);
      const emptyMdWithFrontmatter = `---
id: spec
title: Spec
tags:
  - spec
---

`;
      await fs.writeFile(paths.contentFile, emptyMdWithFrontmatter);

      // Run migration - it should detect the recovery scenario
      const result = await migrateWorkspaceNotes(TEST_WORKSPACE_ID);

      expect(result.migratedNotes).toBe(1);
      expect(result.failedNotes).toBe(0);

      // Verify the content was recovered
      const fileContent = await fs.readFile(paths.contentFile, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(fileContent);

      expect(frontmatter).not.toBeNull();
      expect(content).toBe(legacyNote.content);

      // Verify legacy file is removed after successful recovery
      const legacyExists = await fs
        .access(legacyPath)
        .then(() => true)
        .catch(() => false);
      expect(legacyExists).toBe(false);
    });
  });
});
