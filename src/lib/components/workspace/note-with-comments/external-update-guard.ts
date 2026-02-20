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
    currentMarkdown = lastKnownContent;
  }

  if (currentMarkdown !== newContent) {
    logger.info('[NoteWithComments] Rejecting external update - user has unsaved edits', {
      noteId,
      updateVersion,
      externalContentLength: newContent?.length,
      currentLength: currentMarkdown?.length,
      lastKnownLength: lastKnownContent?.length,
    });
    return true;
  }

  return false;
}
