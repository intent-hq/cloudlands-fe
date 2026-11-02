/**
 * On-demand workspace summary computation.
 *
 * Source-of-truth helper behind the WORKSPACE_CHANNELS.GET_TASKS endpoint.
 * Results are computed fresh from the notes service on each call and are
 * never persisted back onto the workspace object. (The diff/git summaries are
 * served by the renderer's workspace-summaries-bridge-seeder.)
 */

import { m } from '$shared/paraglide/messages.js';
import type { Note, WorkspaceId, WorkspaceTask } from '../../../shared/types';
import { NOTE_LIST_PAGE_LIMIT, SPEC_NOTE_ID } from '../../../shared/constants/notes';
import { isProjectionRejected } from '../../../shared/utils/note-content';
import { requestAllPages } from '../../../shared/utils/paged-list';
import { getSpecTaskNotes } from '../../../shared/utils/task-stats';
import { getBackendClient } from '../../backend/main/backend.ipc';

/**
 * List the canonical task facts for a workspace from the notes service.
 * Includes all spec task notes (including cancelled); renderer selectors
 * derive counts and groupings.
 */
export async function getWorkspaceTasks(workspaceId: WorkspaceId): Promise<WorkspaceTask[]> {
  // Route through the daemon (PROTOCOL.md §5.4 `note.list`); the FE presenter
  // still runs `getSpecTaskNotes` locally to derive the spec-linked task facts.
  // Slim projection (§5.2): only task metadata is needed from the list —
  // except the spec's content, which drives the task-link filter, so the spec
  // is fetched full alongside (fail-soft: a workspace without a spec keeps its
  // slim row). Falls back to a plain full list on daemons that reject the
  // unknown param (-32602).
  let result: { notes?: Note[] } | undefined;
  // §5.2 bounded reads: page with `limit` + `nextToken`.
  const page = (params: Record<string, unknown>) => getBackendClient().request('note.list', params);
  try {
    const [listRows, specResult] = await Promise.all([
      requestAllPages(
        page,
        { workspaceId, projection: 'slim', limit: NOTE_LIST_PAGE_LIMIT },
        'notes',
      ) as Promise<Note[]>,
      (
        getBackendClient().request('note.get', { workspaceId, noteId: SPEC_NOTE_ID }) as Promise<
          { note?: Note } | Note | undefined
        >
      ).catch(() => undefined),
    ]);
    const spec =
      specResult && typeof specResult === 'object' && 'note' in specResult
        ? specResult.note
        : (specResult as Note | undefined);
    result = {
      notes: listRows.map((n) => (spec && String(n.id) === SPEC_NOTE_ID ? spec : n)),
    };
  } catch (error) {
    if (!isProjectionRejected(error)) throw error;
    result = {
      notes: (await requestAllPages(
        page,
        { workspaceId, limit: NOTE_LIST_PAGE_LIMIT },
        'notes',
      )) as Note[],
    };
  }
  const notes = Array.isArray(result?.notes) ? result.notes : [];

  const taskNotes = getSpecTaskNotes(notes);
  return taskNotes.map((note) => ({
    id: note.id as string,
    title: note.title || m.workspaceSummaries_untitledTask_label(),
    status: note.metadata?.task?.status ?? 'not_started',
    updatedAt: note.updatedAt,
  }));
}
