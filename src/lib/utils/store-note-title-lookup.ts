/**
 * Live note titles for mention chips (see note-mention-label.ts), read through
 * the renderer store bridge so generic components (markdown viewer, editors)
 * do not statically import the app store. Before the store is initialised —
 * isolated renders, tests — the lookup returns undefined and chips keep their
 * saved label.
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
