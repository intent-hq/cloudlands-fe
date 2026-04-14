/**
 * Shared utility for dispatching note-content-update CustomEvents.
 *
 * Both `watchNoteUpdatedSaga` (IPC listener) and `handleExternalNoteUpdateSaga`
 * (Redux action handler) need to fire this event so the TipTap editor picks up
 * content changes.
 */

/**
 * Dispatch a window CustomEvent for editor content synchronization.
 *
 * @param noteId   - ID of the note whose content changed
 * @param content  - New content string
 * @param source   - "agent" for agent-driven updates, "external" otherwise
 * @param workspaceId - Workspace the note belongs to
 */
export function dispatchContentUpdateEvent(
  noteId: string,
  content: string,
  source: "agent" | "external",
  workspaceId: string,
): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("note-content-update", {
        detail: { noteId, content, source, workspaceId },
      }),
    );
  }
}
