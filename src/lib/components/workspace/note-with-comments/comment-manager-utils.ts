import { CommentManagerV2 } from '$features/comments/comment-manager-v2';
import type { Editor } from '@tiptap/core';
import type { LoggerLike } from './logger.types';

export type CommentManagerOnContentChanged = (recoveryTimestamp?: string) => Promise<void> | void;

export async function createAndInitializeCommentManagerV2({
  workspaceId,
  noteId,
  editor,
  onContentChanged,
}: {
  workspaceId: string;
  noteId: string;
  editor: Editor;
  onContentChanged: CommentManagerOnContentChanged;
}): Promise<CommentManagerV2> {
  const manager = new CommentManagerV2(workspaceId, noteId, {
    onContentChanged,
  });

  await manager.initialize(editor);
  return manager;
}

export function destroyCommentManagerV2(manager: CommentManagerV2 | null | undefined) {
  if (!manager) return;
  try {
    manager.destroy();
  } catch {
    // Ignore errors during cleanup
  }
}

export type ProcessHTMLToMarkdown = (
  html: string,
  options?: { preserveAnchors?: boolean },
) => string;

export function getMarkdownFromEditorPreservingAnchors({
  editor,
  processHTMLToMarkdown,
}: {
  editor: Editor;
  processHTMLToMarkdown: ProcessHTMLToMarkdown;
}): {
  markdown: string;
  html: string;
  anchorCount: number;
} {
  const html = editor.getHTML();
  const markdown = processHTMLToMarkdown(html, { preserveAnchors: true });
  const anchorCount = (html.match(/data-anchor-id/g) || []).length;
  return { markdown, html, anchorCount };
}

export async function reapplyCommentAnchorsAfterExternalUpdate({
  hasAnchors,
  commentManager,
  noteId,
  updateVersion,
  anchorCount,
  logger,
}: {
  hasAnchors: boolean;
  commentManager: CommentManagerV2 | null | undefined;
  noteId: string | undefined;
  updateVersion: number;
  anchorCount: number;
  logger: LoggerLike;
}): Promise<void> {
  if (!hasAnchors || !commentManager) return;

  logger.debug('[NoteWithComments] Reapplying comment anchors after external update', {
    noteId,
    updateVersion,
    anchorCount,
  });

  try {
    await commentManager.reapplyAnchorsForCurrentComments({
      reason: 'external-update',
      updateVersion,
    });
  } catch (anchorError) {
    logger.error('[NoteWithComments] Failed to reapply comment anchors after external update', {
      noteId,
      updateVersion,
      error: anchorError instanceof Error ? anchorError.message : String(anchorError),
    });
  }
}
