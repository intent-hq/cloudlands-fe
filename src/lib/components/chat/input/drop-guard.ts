/**
 * Returns true when a drag/drop event carries OS-level files (e.g. an image
 * dragged from Finder). Used by the chat input's TipTap editor to block
 * ProseMirror's default drop handling for file drops — dropped files become
 * attachments via the container-level drop handler in SimpleRichInput, never
 * inline editor content.
 */
export function isFileDragEvent(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
