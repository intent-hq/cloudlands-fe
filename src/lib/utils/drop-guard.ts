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

/**
 * Returns true when a paste event carries OS-level files (e.g. a copied
 * image). Used by the chat input's TipTap editor to block ProseMirror's
 * default paste handling for file-bearing pastes — a clipboard that pairs
 * the file with text/html (browser "Copy image") would otherwise insert an
 * inline image node synchronously, before the container-level paste handler
 * can intercept and attach the file as a context item.
 */
export function isFilePasteEvent(event: ClipboardEvent): boolean {
  return event.clipboardData?.types?.includes('Files') ?? false;
}
