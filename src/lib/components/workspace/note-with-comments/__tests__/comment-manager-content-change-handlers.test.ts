import { describe, it, expect, vi } from 'vitest';
import {
  createOnCommentManagerContentChangedAfterAnchorInsertion,
  createOnCommentManagerContentChangedUpdateLastKnownContent,
} from '../comment-manager-content-change-handlers';

describe('comment-manager-content-change-handlers', () => {
  describe('createOnCommentManagerContentChangedUpdateLastKnownContent', () => {
    it('updates lastKnownContent from editor HTML (preserving anchors)', async () => {
      const editor = {
        getHTML: vi.fn(() => '<p>Hello</p><span data-anchor-id="a"></span>'),
      } as any;
      const processHTMLToMarkdown = vi.fn((html: string) => `md:${html}`);
      const setLastKnownContent = vi.fn();

      const handler = createOnCommentManagerContentChangedUpdateLastKnownContent({
        getEditor: () => editor,
        processHTMLToMarkdown,
        setLastKnownContent,
      });

      await handler();

      expect(editor.getHTML).toHaveBeenCalledTimes(1);
      expect(processHTMLToMarkdown).toHaveBeenCalledWith(editor.getHTML.mock.results[0].value, {
        preserveAnchors: true,
      });
      expect(setLastKnownContent).toHaveBeenCalledWith(expect.stringMatching(/^md:/));
    });

    it('no-ops when editor is missing', async () => {
      const processHTMLToMarkdown = vi.fn();
      const setLastKnownContent = vi.fn();

      const handler = createOnCommentManagerContentChangedUpdateLastKnownContent({
        getEditor: () => null,
        processHTMLToMarkdown,
        setLastKnownContent,
      });

      await handler();

      expect(processHTMLToMarkdown).not.toHaveBeenCalled();
      expect(setLastKnownContent).not.toHaveBeenCalled();
    });
  });

  describe('createOnCommentManagerContentChangedAfterAnchorInsertion', () => {
    it('skips recovery when lastSaveTimestamp is newer than recoveryTimestamp', async () => {
      const editor = {
        getHTML: vi.fn(() => '<p>Hello</p><span data-anchor-id="a"></span>'),
      } as any;

      const processHTMLToMarkdown = vi.fn();
      const setLastKnownContent = vi.fn();
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const handler = createOnCommentManagerContentChangedAfterAnchorInsertion({
        getEditor: () => editor,
        processHTMLToMarkdown,
        getLastSaveTimestamp: () => '2025-01-02T00:00:00.000Z',
        getLastKnownContent: () => 'prev',
        setLastKnownContent,
        logger,
      });

      await handler('2025-01-01T00:00:00.000Z');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(editor.getHTML).not.toHaveBeenCalled();
      expect(processHTMLToMarkdown).not.toHaveBeenCalled();
      expect(setLastKnownContent).not.toHaveBeenCalled();
    });

    it('updates lastKnownContent and logs anchor metadata when not skipping', async () => {
      const editor = {
        getHTML: vi.fn(
          () => '<p>Hello</p><span data-anchor-id="a"></span><span data-anchor-id="b"></span>',
        ),
      } as any;

      const processHTMLToMarkdown = vi.fn(() => '# Hello');
      let lastKnown = 'prev';
      const setLastKnownContent = vi.fn((next: string) => {
        lastKnown = next;
      });
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const handler = createOnCommentManagerContentChangedAfterAnchorInsertion({
        getEditor: () => editor,
        processHTMLToMarkdown,
        getLastSaveTimestamp: () => null,
        getLastKnownContent: () => lastKnown,
        setLastKnownContent,
        logger,
      });

      await handler();

      expect(setLastKnownContent).toHaveBeenCalledWith('# Hello');
      expect(logger.info).toHaveBeenCalledWith(
        '[NoteWithComments] Updated lastKnownContent after anchor insertion',
        expect.objectContaining({
          hasAnchors: true,
          anchorCount: 2,
        }),
      );
    });
  });
});
