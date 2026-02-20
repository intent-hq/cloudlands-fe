import type { Editor } from '@tiptap/core';
import type { CommentManagerV2 } from '$features/comments/comment-manager-v2';
import {
  createAndInitializeCommentManagerV2,
  destroyCommentManagerV2,
  type CommentManagerOnContentChanged,
} from './comment-manager-utils';

export function destroyAndClearCommentManagerV2(
  manager: CommentManagerV2 | null | undefined,
): CommentManagerV2 | null {
  if (manager) destroyCommentManagerV2(manager);
  return null;
}

export async function maybeCreateCommentManagerV2({
  showComments,
  workspaceId,
  noteId,
  editor,
  onContentChanged,
}: {
  showComments: boolean;
  workspaceId: string | null | undefined;
  noteId: string | null | undefined;
  editor: Editor;
  onContentChanged: CommentManagerOnContentChanged;
}): Promise<CommentManagerV2 | null> {
  if (!showComments || !workspaceId || !noteId) return null;

  return await createAndInitializeCommentManagerV2({
    workspaceId,
    noteId,
    editor,
    onContentChanged,
  });
}
