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
    });

    it('should accept any MIME type on a reference block', () => {
      const mimeTypes = [
        'text/plain',
        'application/json',
        'text/markdown',
        'application/pdf',
        'text/javascript',
      ];

      mimeTypes.forEach((mimeType, index) => {
        expect(
          isFileBlock({ type: 'file', attachmentId: `att-${index}`, mimeType, fileName: 'f' }),
        ).toBe(true);
      });
    });

    it('should accept optional size/id fields without requiring them', () => {
      expect(
        isFileBlock({
          type: 'file',
          attachmentId: 'att-123',
          mimeType: 'text/plain',
          fileName: 'test.txt',
          size: 1024,
          id: 'file-123',
        }),
      ).toBe(true);
      expect(isFileBlock({ type: 'file', attachmentId: 'att-123', fileName: 'test.txt' })).toBe(
        true,
      );
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

    it('should reject an empty fileName', () => {
      expect(isFileBlock({ type: 'file', attachmentId: 'att-1', fileName: '' })).toBe(false);
    });
  });
});
