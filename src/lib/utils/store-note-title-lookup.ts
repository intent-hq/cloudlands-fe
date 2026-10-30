/**
 * Live note titles for mention chips (see note-mention-label.ts), read through
 * the renderer store bridge rather than the workspace-notes selectors module.
 * The markdown viewer and editors render in many isolated tests with a stub
 * store or a partial selectors mock; importing the selectors there broke them.
 * Before the bridge is initialised the lookup returns undefined and chips keep
 * their saved label. Mirrors `selectNoteById` (workspace-notes-selectors.ts).
 */

import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { Note } from '$shared/types';
import { getRendererStore } from '$store/renderer/renderer-store-bridge';
import type { NoteTitleLookup } from '$lib/utils/note-mention-label';

export const storeNoteTitleLookup: NoteTitleLookup = (workspaceId, noteId) => {
  let state;
  try {
    state = getRendererStore().state;
  } catch {
    return undefined;
  }
  const notes = state?.workspaceNotes?.byWorkspaceId?.[workspaceId]?.notes;
  return notes ? getItem(notes, noteId as Note['id'])?.title : undefined;
};
