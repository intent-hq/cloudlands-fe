import { backend } from '@/features/backend/backend-transport';
import { rememberNoteWorkspace } from '@/features/notes/notes-read-client';
import { createBackendTasksClient } from '$lib/client/live/backend-tasks-client';

export const tasksReadClient = createBackendTasksClient({
  backendRequest: backend.backendRequest,
  rememberNoteWorkspace,
});
