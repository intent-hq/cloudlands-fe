import { backend } from '@/features/backend/backend-transport';
import { createNoteCreate } from '$lib/client/live/backend-note-create';
import { createNoteSetContent } from '$lib/client/live/backend-note-set-content';

/** Explicit note writes never resolve a workspace from a globally ambiguous note ID. */
export const notesWriteClient = {
  create: createNoteCreate({ backendRequest: backend.backendRequest }),
  setContent: createNoteSetContent({ backendRequest: backend.backendRequest }),
};
