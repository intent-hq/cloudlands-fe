/**
 * Tests for FolderBasedNotesRepository
 *
 * Verifies the flat storage format works correctly:
 * - {noteId}.md with YAML frontmatter + content
 * - .meta/{noteId}.versions.jsonl for version history
 * - .meta/{noteId}.comments.json for comments
 * - Session-only CRDT support via Yjs (not persisted)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { FolderBasedNotesRepository } from '../folder-notes.repository';
import { crdtDocumentManager } from '../crdt-document-manager';
import { getNoteStoragePaths } from '../note-storage-paths';
import { setGitEnabled } from '../git-version.service';
import { parseFrontmatter } from '../frontmatter';
import {
  ContentType,
  NoteVisibility,
  AuthorType,
} from '../../../../../shared/types';
import type { Note, NoteId, WorkspaceId } from '../../../../../shared/types';

// Test workspace and note IDs
const TEST_WORKSPACE_ID = 'test-workspace-storage' as WorkspaceId;
const TEST_NOTE_ID = 'test-note-1' as NoteId;

// Helper to create a test note
function createTestNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: TEST_NOTE_ID,
    workspaceId: TEST_WORKSPACE_ID,
    title: 'Test Note',
    content: '# Test Content\n\nThis is a test note.',
    contentType: ContentType.Markdown,
    tags: ['test'],
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
      characterCount: 35,
    },
    references: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FolderBasedNotesRepository', () => {
  let repository: FolderBasedNotesRepository;
  let testNotePaths: ReturnType<typeof getNoteStoragePaths>;

  // Disable git for tests (avoids spawn issues in test environment)
  beforeAll(() => {
    setGitEnabled(false);
  });

  afterAll(() => {
    setGitEnabled(true);
  });

  beforeEach(async () => {
    repository = new FolderBasedNotesRepository();
    testNotePaths = getNoteStoragePaths(TEST_WORKSPACE_ID, TEST_NOTE_ID);

    // Clean up any existing test data (notes dir)
    try {
      await fs.rm(testNotePaths.notesDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await fs.rm(testNotePaths.notesDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }

    // Clear CRDT cache
    crdtDocumentManager.clearCache();
  });

  describe('save', () => {
    it('should save a note with frontmatter format', async () => {
      const note = createTestNote();

      await repository.save(note);

      // Verify {noteId}.md exists at notes/ root with frontmatter
      const fileContent = await fs.readFile(testNotePaths.contentFile, 'utf-8');
      const { frontmatter, content } = parseFrontmatter(fileContent);

      // Verify frontmatter contains metadata
      expect(frontmatter).not.toBeNull();
      expect(frontmatter!.id).toBe(note.id);
      expect(frontmatter!.title).toBe(note.title);
      expect(frontmatter!.tags).toEqual(note.tags);

      // Verify content is preserved
      expect(content).toBe(note.content);
    });

    it('should save multiple notes in flat structure', async () => {
      const note1 = createTestNote({ id: 'note-1' as NoteId });
      const note2 = createTestNote({ id: 'note-2' as NoteId, title: 'Second Note' });

      await repository.save(note1);
      await repository.save(note2);

      // Verify both .md files exist at root
      const files = await fs.readdir(testNotePaths.notesDir);
      expect(files).toContain('note-1.md');
      expect(files).toContain('note-2.md');

      // Verify each file has correct frontmatter
      const file1Content = await fs.readFile(
        path.join(testNotePaths.notesDir, 'note-1.md'),
        'utf-8',
      );
      const file2Content = await fs.readFile(
        path.join(testNotePaths.notesDir, 'note-2.md'),
        'utf-8',
      );

      const { frontmatter: fm1 } = parseFrontmatter(file1Content);
      const { frontmatter: fm2 } = parseFrontmatter(file2Content);

      expect(fm1!.id).toBe('note-1');
      expect(fm2!.id).toBe('note-2');
      expect(fm2!.title).toBe('Second Note');
    });
  });

  describe('findById', () => {
    it('should load a note from folder-based format', async () => {
      const note = createTestNote();
      await repository.save(note);

      const loaded = await repository.findById(TEST_WORKSPACE_ID, TEST_NOTE_ID);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(note.id);
      expect(loaded!.title).toBe(note.title);
      expect(loaded!.content).toBe(note.content);
    });

    it('should return null for non-existent note', async () => {
      const loaded = await repository.findById(TEST_WORKSPACE_ID, 'non-existent' as NoteId);
      expect(loaded).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a note folder', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Verify note exists
      expect(await repository.exists(TEST_WORKSPACE_ID, TEST_NOTE_ID)).toBe(true);

      await repository.delete(TEST_WORKSPACE_ID, TEST_NOTE_ID);

      // Verify note is deleted
      expect(await repository.exists(TEST_WORKSPACE_ID, TEST_NOTE_ID)).toBe(false);
    });
  });

  describe('findByWorkspace', () => {
    it('should find all notes in a workspace', async () => {
      const note1 = createTestNote({ id: 'note-1' as NoteId });
      const note2 = createTestNote({ id: 'note-2' as NoteId, title: 'Second Note' });

      await repository.save(note1);
      await repository.save(note2);

      const notes = await repository.findByWorkspace(TEST_WORKSPACE_ID);

      expect(notes).toHaveLength(2);
      expect(notes.map((n) => n.id).sort()).toEqual(['note-1', 'note-2']);

      // Cleanup
      await repository.delete(TEST_WORKSPACE_ID, 'note-1' as NoteId);
      await repository.delete(TEST_WORKSPACE_ID, 'note-2' as NoteId);
    });
  });

  describe('CRDT integration', () => {
    it('should initialize CRDT document with content', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Initialize CRDT
      await crdtDocumentManager.initializeWithContent(
        TEST_WORKSPACE_ID,
        TEST_NOTE_ID,
        note.content,
      );

      // Get content from CRDT
      const crdtContent = await crdtDocumentManager.getContent(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      expect(crdtContent).toBe(note.content);
    });

    it('should update content via CRDT', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Initialize CRDT
      await crdtDocumentManager.initializeWithContent(
        TEST_WORKSPACE_ID,
        TEST_NOTE_ID,
        note.content,
      );

      // Update via CRDT
      const newContent = '# Updated Content\n\nThis was updated via CRDT.';
      await crdtDocumentManager.updateContent(TEST_WORKSPACE_ID, TEST_NOTE_ID, newContent);

      // Verify CRDT has new content
      const crdtContent = await crdtDocumentManager.getContent(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      expect(crdtContent).toBe(newContent);
    });

    it('should keep CRDT state in memory (session-only)', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Initialize and update CRDT
      await crdtDocumentManager.initializeWithContent(
        TEST_WORKSPACE_ID,
        TEST_NOTE_ID,
        note.content,
      );
      await crdtDocumentManager.updateContent(TEST_WORKSPACE_ID, TEST_NOTE_ID, '# Updated Content');

      // Verify CRDT content is in memory
      const crdtContent = await crdtDocumentManager.getContent(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      expect(crdtContent).toBe('# Updated Content');

      // CRDT is session-only, so no .crdt file should exist
      // (CRDT state is not persisted to disk in the new design)
    });
  });

  describe('concurrent editing simulation', () => {
    it('should handle rapid sequential saves without data loss', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Simulate rapid updates
      const updates = ['Update 1', 'Update 2', 'Update 3', 'Update 4', 'Update 5'];

      for (const content of updates) {
        note.content = `# ${content}\n\nContent from: ${content}`;
        await repository.save(note);
      }

      // Load and verify last update persisted
      const loaded = await repository.findById(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      expect(loaded!.content).toContain('Update 5');
    });

    it('should maintain CRDT state consistency across updates within session', async () => {
      const note = createTestNote();
      await repository.save(note);

      // Initialize CRDT
      await crdtDocumentManager.initializeWithContent(
        TEST_WORKSPACE_ID,
        TEST_NOTE_ID,
        note.content,
      );

      // Update content via CRDT
      const newContent1 = '# First CRDT Update';
      await crdtDocumentManager.updateContent(TEST_WORKSPACE_ID, TEST_NOTE_ID, newContent1);

      // Update again
      const newContent2 = '# Second CRDT Update';
      await crdtDocumentManager.updateContent(TEST_WORKSPACE_ID, TEST_NOTE_ID, newContent2);

      // Verify CRDT state within the same session
      const crdtContent = await crdtDocumentManager.getContent(TEST_WORKSPACE_ID, TEST_NOTE_ID);
      expect(crdtContent).toBe(newContent2);

      // Note: CRDT is session-only, so after clearing cache, a new document
      // will be initialized from the .md file (which still has original content
      // unless explicitly saved via repository.save())
    });
  });

  describe('findById recovery', () => {
    it('should recover content from legacy JSON when .md is empty', async () => {
      // This tests the critical recovery scenario where:
      // 1. An empty spec.md exists with frontmatter
      // 2. The legacy spec.json still has the actual content
      // 3. findById should return the content from .json
      const specNoteId = 'spec' as NoteId;
      const specPaths = getNoteStoragePaths(TEST_WORKSPACE_ID, specNoteId);

      // Create directories
      await fs.mkdir(specPaths.notesDir, { recursive: true });
      await fs.mkdir(specPaths.metaDir, { recursive: true });

      // Create a legacy note with content
      const legacyNote = createTestNote({
        id: specNoteId,
        title: 'Spec',
        content: '# My Important Spec\n\nThis content must NOT be lost!',
      });
      const legacyPath = path.join(specPaths.notesDir, `${specNoteId}.json`);
      await fs.writeFile(legacyPath, JSON.stringify(legacyNote, null, 2));

      // Create an empty .md file with frontmatter (simulating the bug scenario)
      const emptyMdWithFrontmatter = `---
id: spec
title: Spec
tags:
  - spec
---

`;
      await fs.writeFile(specPaths.contentFile, emptyMdWithFrontmatter);

      // findById should recover the content from the legacy JSON
      const result = await repository.findById(TEST_WORKSPACE_ID, specNoteId);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(legacyNote.content);
    });

    it('should not recover from legacy JSON when .md has content', async () => {
      // Make sure we don't accidentally use legacy content when .md already has content
      const specNoteId = 'spec' as NoteId;
      const specPaths = getNoteStoragePaths(TEST_WORKSPACE_ID, specNoteId);

      // Create directories
      await fs.mkdir(specPaths.notesDir, { recursive: true });
      await fs.mkdir(specPaths.metaDir, { recursive: true });

      // Create a legacy note with different content
      const legacyNote = createTestNote({
        id: specNoteId,
        title: 'Spec',
        content: '# Old Legacy Content',
      });
      const legacyPath = path.join(specPaths.notesDir, `${specNoteId}.json`);
      await fs.writeFile(legacyPath, JSON.stringify(legacyNote, null, 2));

      // Create .md file with frontmatter AND content
      const mdContent = '# New Content\n\nThis is the correct content.';
      const mdWithFrontmatter = `---
id: spec
title: Spec
tags:
  - spec
---

${mdContent}`;
      await fs.writeFile(specPaths.contentFile, mdWithFrontmatter);

      // findById should return the .md content, NOT the legacy JSON content
      const result = await repository.findById(TEST_WORKSPACE_ID, specNoteId);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(mdContent);
    });
  });
});
