/**
 * Notes, tasks & comments mock seeder.
 *
 * Pulls notes (including the workspace spec), canonical task facts, and comment
 * threads from the `AppClient` seam and dispatches existing slice actions so the
 * notes panel, tasks list, and comment threads render with mock data — replacing
 * the work the note/task/comment-loading sagas used to do against the backend.
 */
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { CommentV2 } from "$features/comments/comment-types-v2";
import { registerMockSeeder } from "../mock-bootstrap";
import {
  loadWorkspaceNotesSucceeded,
  selectNote,
} from "../slices/workspace-notes/workspace-notes-slice";
import { loadWorkspaceTasksSucceeded } from "../slices/workspace-tasks/workspace-tasks-slice";
import { loadCommentsAction } from "../slices/comments/comments-slice";

registerMockSeeder("notes", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();
  const allComments: CommentV2[] = [];

  for (const workspace of workspaces) {
    const wsId = String(workspace.id);

    const notes = await client.notes.list(wsId);
    store.dispatch(loadWorkspaceNotesSucceeded([wsId], { [wsId]: notes }));

    const tasks = await client.tasks.list(wsId);
    store.dispatch(loadWorkspaceTasksSucceeded(wsId, tasks));

    // Select the spec note so the notes panel renders content on first paint.
    const spec = notes.find((note) => String(note.id) === SPEC_NOTE_ID);
    if (spec) {
      store.dispatch(selectNote(wsId, String(spec.id)));
    }

    for (const note of notes) {
      allComments.push(...(await client.comments.list(String(note.id))));
    }
  }

  // Comments live in a single global slice; load them all in one pass.
  if (allComments.length > 0) {
    store.dispatch(loadCommentsAction(allComments));
  }
});
