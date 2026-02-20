import type { Editor } from '@tiptap/core';
import type { LoggerLike } from './logger.types';
import {
  getMarkdownFromEditorPreservingAnchors,
  type CommentManagerOnContentChanged,
  type ProcessHTMLToMarkdown,
} from './comment-manager-utils';

export function createOnCommentManagerContentChangedUpdateLastKnownContent({
  getEditor,
  processHTMLToMarkdown,
  setLastKnownContent,
}: {
  getEditor: () => Editor | null | undefined;
  processHTMLToMarkdown: ProcessHTMLToMarkdown;
  setLastKnownContent: (content: string) => void;
}): CommentManagerOnContentChanged {
  return async () => {
    const editor = getEditor();
    if (!editor) return;

    const { markdown } = getMarkdownFromEditorPreservingAnchors({ editor, processHTMLToMarkdown });
    setLastKnownContent(markdown);
  };
}

export function createOnCommentManagerContentChangedAfterAnchorInsertion({
  getEditor,
  processHTMLToMarkdown,
  getLastSaveTimestamp,
  getLastKnownContent,
  setLastKnownContent,
  logger,
}: {
  getEditor: () => Editor | null | undefined;
  processHTMLToMarkdown: ProcessHTMLToMarkdown;
  getLastSaveTimestamp: () => string | null;
  getLastKnownContent: () => string;
  setLastKnownContent: (content: string) => void;
  logger: LoggerLike;
}): CommentManagerOnContentChanged {
  return async (recoveryTimestamp?: string) => {
    const lastSaveTimestamp = getLastSaveTimestamp();
    if (recoveryTimestamp && lastSaveTimestamp && lastSaveTimestamp > recoveryTimestamp) {
      logger.warn('[NoteWithComments] Skipping recovery save - newer save exists', {
        recoveryTimestamp,
        lastSaveTimestamp,
      });
      return;
    }

    const editor = getEditor();
    if (!editor) return;

    const { markdown, html, anchorCount } = getMarkdownFromEditorPreservingAnchors({
      editor,
      processHTMLToMarkdown,
    });

    const previousLastKnownContent = getLastKnownContent();
    setLastKnownContent(markdown);

    logger.info('[NoteWithComments] Updated lastKnownContent after anchor insertion', {
      contentLength: markdown.length,
      previousLength: previousLastKnownContent.length,
      changed: markdown !== previousLastKnownContent,
      hasAnchors: html.includes('data-anchor-id'),
      anchorCount,
    });
  };
}
