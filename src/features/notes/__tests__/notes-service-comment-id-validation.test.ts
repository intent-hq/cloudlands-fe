/**
 * Tests for comment ID validation in NotesService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotesService } from '../notes.service';
import type { NotesRepository } from '../notes.repository';
import type { CommentsRepository } from '../../comments/comments.repository';

describe('NotesService - Comment ID Validation', () => {
  let service: NotesService;
  let mockNotesRepo: NotesRepository;
  let mockCommentsRepo: CommentsRepository;

  beforeEach(() => {
    // Create mock repositories
    mockNotesRepo = {
      findById: vi.fn(),
      findAll: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    } as any;

    mockCommentsRepo = {
      findByNote: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      findById: vi.fn(),
    } as any;

    service = new NotesService(mockNotesRepo, mockCommentsRepo);

    // Mock note exists
    vi.mocked(mockNotesRepo.findById).mockResolvedValue({
      id: 'test-note',
      workspaceId: 'test-workspace',
      title: 'Test Note',
      content: 'Test content',
      contentType: 'markdown',
      visibility: 'private',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [],
    } as any);
  });

  describe('Frontend-provided IDs', () => {
    it('should accept valid UUID from frontend', async () => {
      const validUUID = '550e8400-e29b-41d4-a716-446655440000';

      const result = await service.addComment('test-workspace', 'test-note', {
        id: validUUID,
        content: 'Test comment',
        type: 'comment',
        author: 'User',
        authorType: 'user',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(validUUID);
      }
    });

    it('should reject invalid UUID format', async () => {
      const invalidId = 'cmt-1234567890-abc123'; // Old format

      const result = await service.addComment('test-workspace', 'test-note', {
        id: invalidId,
        content: 'Test comment',
        type: 'comment',
        author: 'User',
        authorType: 'user',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Invalid comment ID format');
      }
    });

    it('should reject duplicate comment ID', async () => {
      const duplicateId = '550e8400-e29b-41d4-a716-446655440000';

      // Mock existing comment with same ID
      vi.mocked(mockCommentsRepo.findByNote).mockResolvedValue([
        {
          id: duplicateId,
          noteId: 'test-note',
          content: 'Existing comment',
          type: 'comment',
          author: 'User',
          authorType: 'user',
          status: 'open',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ] as any);

      const result = await service.addComment('test-workspace', 'test-note', {
        id: duplicateId,
        content: 'Test comment',
        type: 'comment',
        author: 'User',
        authorType: 'user',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Comment ID already exists');
      }
    });
  });

  describe('Backend-generated IDs', () => {
    it('should generate valid UUID when no ID provided', async () => {
      const result = await service.addComment('test-workspace', 'test-note', {
        content: 'Test comment',
        type: 'comment',
        author: 'Agent',
        authorType: 'agent',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should be a valid UUID
        expect(result.data.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    });

    it('should generate unique IDs for multiple comments', async () => {
      const result1 = await service.addComment('test-workspace', 'test-note', {
        content: 'Comment 1',
        type: 'comment',
        author: 'Agent',
        authorType: 'agent',
      });

      const result2 = await service.addComment('test-workspace', 'test-note', {
        content: 'Comment 2',
        type: 'comment',
        author: 'Agent',
        authorType: 'agent',
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.data.id).not.toBe(result2.data.id);
      }
    });
  });
});
