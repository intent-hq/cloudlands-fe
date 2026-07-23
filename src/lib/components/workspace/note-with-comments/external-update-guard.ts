import type { LoggerLike } from './logger.types';

export type ExternalUpdateEditorSnapshotLike = {
  getHTML: () => string;
};

export type ProcessHTMLToMarkdownLike = (
  html: string,
  opts: {
    preserveAnchors: boolean;
  },
) => string;

export function shouldRejectExternalUpdateDueToUnsavedEdits({
  hasUserEditedSinceLastSave,
  isUpdatingFromExternal,
  editor,
  newContent,
  lastKnownContent,
  processHTMLToMarkdown,
  noteId,
  updateVersion,
  logger,
}: {
  hasUserEditedSinceLastSave: boolean;
  isUpdatingFromExternal: boolean;
  editor: ExternalUpdateEditorSnapshotLike;
  newContent: string;
  lastKnownContent: string;
  processHTMLToMarkdown: ProcessHTMLToMarkdownLike;
  noteId: string | null | undefined;
  updateVersion: number;
  logger: LoggerLike;
}): boolean {
  if (!hasUserEditedSinceLastSave) return false;
  if (isUpdatingFromExternal) return false;

  const currentHtml = editor.getHTML();
  let currentMarkdown: string;

  try {
    currentMarkdown = processHTMLToMarkdown(currentHtml, {
      preserveAnchors: true,
    });
  } catch (error) {
    logger.error('[NoteWithComments] Failed to normalize current editor content', error);
    // Cannot prove the editor holds no unsaved edits — reject conservatively.
    return true;
  }

  // Editor already matches the incoming content: applying it is a no-op, so
  // accept and let tracking state sync up.
  if (currentMarkdown === newContent) return false;

  // Editor matches the last saved snapshot: every local edit has been saved,
  // so the (newer) external content can be applied without losing user work.
  // hasUserEditedSinceLastSave latches on the first local edit and is only
  // cleared by a successful external apply, so it alone cannot distinguish
  // "unsaved edits" from "saved edits + stale editor" — this comparison can.
  if (currentMarkdown === lastKnownContent) return false;

  logger.info('[NoteWithComments] Rejecting external update - user has unsaved edits', {
    noteId,
    updateVersion,
    externalContentLength: newContent?.length,
    currentLength: currentMarkdown?.length,
    lastKnownLength: lastKnownContent?.length,
  });
  return true;
}
