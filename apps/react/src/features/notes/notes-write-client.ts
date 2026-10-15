import { backend } from '@/features/backend/backend-transport';
import { createNoteSetContent } from '$lib/client/live/backend-note-set-content';

/** Explicit note writes never resolve a workspace from a globally ambiguous note ID. */
export const notesWriteClient = {
  setContent: createNoteSetContent({ backendRequest: backend.backendRequest }),
};
