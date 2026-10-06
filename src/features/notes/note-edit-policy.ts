/** Product policy for full-document editing, measured in UTF-8 bytes. */
const RICH_NOTE_EDIT_BYTES = 300_000;
export function shouldUseRawNoteEditor(source: string, preferRaw = false): boolean {
  return preferRaw || new TextEncoder().encode(source).byteLength > RICH_NOTE_EDIT_BYTES;
}
