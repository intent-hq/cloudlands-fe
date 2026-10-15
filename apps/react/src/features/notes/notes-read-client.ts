import { backend } from '@/features/backend/backend-transport';
import { createBackendNotesReadClient } from '$lib/client/live/backend-notes-read-client';
import { createNoteWorkspaceDiscovery } from '$lib/client/live/backend-note-workspace-discovery';
import { createWorkspaceIdRuntime } from '$lib/client/live/backend-workspace-id-runtime';

const workspaceIds = createWorkspaceIdRuntime(backend);
const discovery = createNoteWorkspaceDiscovery({
  backendRequest: backend.backendRequest,
  listWorkspaceIdsOrThrow: workspaceIds.listWorkspaceIdsOrThrow,
});

/** Read-only transport binding. Routed note reads always pass an explicit workspace ID. */
export const notesReadClient = createBackendNotesReadClient({
  backendRequest: backend.backendRequest,
  ...discovery,
});

/** Shared discovery owner used by canonical task reads as well as notes. */
export const rememberNoteWorkspace = discovery.rememberNoteWorkspace;
