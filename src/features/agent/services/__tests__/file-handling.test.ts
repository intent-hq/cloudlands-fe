/**
 * Tests for attachment-reference file blocks in chat messages (PROTOCOL §5.5,
 * 10.0: `{ type: 'file', attachmentId, fileName, mimeType?, size? }` — never
 * inline bytes). Drives the production `isFileBlock` guard the chat renders
 * and edits from.
 */

import { describe, it, expect } from 'vitest';
import type { ContentBlock } from '$shared/types/content-block.ts';
import { isFileBlock } from '$shared/types/content-block.guards';

describe('File Handling in Chat Messages', () => {
  describe('ContentBlock file type support', () => {
    it('should accept an attachment-reference file block', () => {
      const fileBlock: ContentBlock = {
        type: 'file',
        attachmentId: 'att-1',
        mimeType: 'text/plain',
        fileName: 'test.txt',
      };

      expect(isFileBlock(fileBlock)).toBe(true);
      expect(fileBlock.data).toBeUndefined();
    });

    it('should support multiple file types', () => {
      const fileTypes = [
        { mimeType: 'text/plain', fileName: 'test.txt' },
        { mimeType: 'application/json', fileName: 'data.json' },
        { mimeType: 'text/markdown', fileName: 'readme.md' },
        { mimeType: 'application/pdf', fileName: 'document.pdf' },
        { mimeType: 'text/javascript', fileName: 'script.js' },
      ];

      fileTypes.forEach(({ mimeType, fileName }, index) => {
        const block: ContentBlock = {
          type: 'file',
          attachmentId: `att-${index}`,
          mimeType,
          fileName,
        };
        expect(isFileBlock(block)).toBe(true);
        expect(block.mimeType).toBe(mimeType);
        expect(block.fileName).toBe(fileName);
      });
    });

    it('should handle file blocks with optional fields', () => {
      const block: ContentBlock = {
        type: 'file',
        attachmentId: 'att-123',
        mimeType: 'text/plain',
        fileName: 'test.txt',
        size: 1024,
        id: 'file-123',
      };

      expect(isFileBlock(block)).toBe(true);
      expect(block.id).toBe('file-123');
      expect(block.size).toBe(1024);
    });
  });

  describe('File block filtering', () => {
    it('should filter attachment-reference file blocks from contentBlocks array', () => {
      const contentBlocks: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'file', attachmentId: 'att-a', mimeType: 'text/plain', fileName: 'file1.txt' },
        { type: 'image', data: 'imgdata', mimeType: 'image/png' },
        {
          type: 'file',
          attachmentId: 'att-b',
          mimeType: 'application/json',
          fileName: 'file2.json',
        },
      ];

      const fileBlocks = contentBlocks.filter(isFileBlock);

      expect(fileBlocks).toHaveLength(2);
      expect(fileBlocks[0].fileName).toBe('file1.txt');
      expect(fileBlocks[1].fileName).toBe('file2.json');
    });

    it('should handle empty contentBlocks', () => {
      const contentBlocks: ContentBlock[] = [];
      expect(contentBlocks.filter(isFileBlock)).toHaveLength(0);
    });

    it('should handle contentBlocks with no files', () => {
      const contentBlocks: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'imgdata', mimeType: 'image/png' },
      ];

      expect(contentBlocks.filter(isFileBlock)).toHaveLength(0);
    });
  });

  describe('File block validation', () => {
    it('should require fileName for file blocks', () => {
      expect(isFileBlock({ type: 'file', attachmentId: 'att-1', mimeType: 'text/plain' })).toBe(
        false,
      );
    });

    it('should reject a legacy inline-data file block without attachmentId', () => {
      const legacyBlock: ContentBlock = {
        type: 'file',
        data: 'base64data',
        mimeType: 'text/plain',
        fileName: 'test.txt',
      };

      expect(isFileBlock(legacyBlock)).toBe(false);
    });

    it('should reject an empty attachmentId', () => {
      expect(isFileBlock({ type: 'file', attachmentId: '', fileName: 'test.txt' })).toBe(false);
    });
  });
});
