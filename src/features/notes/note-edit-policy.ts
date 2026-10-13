/** Product policy for full-document editing, measured in UTF-8 bytes. */
export const RICH_NOTE_EDIT_BYTES = 300_000;
export function shouldUseRawNoteEditor(source: string, preferRaw = false): boolean {
  return preferRaw || new TextEncoder().encode(source).byteLength > RICH_NOTE_EDIT_BYTES;
}

/** Slim lengths count Unicode scalars, so only the outer bounds are decisive. */
export function classifyNoteEditSize(
  note: { content?: string; contentLength?: number } | undefined,
): 'small' | 'large' | 'unknown' {
  if (!note) return 'unknown';
  if (note.content) return shouldUseRawNoteEditor(note.content) ? 'large' : 'small';
  // Full rows omit contentLength; their explicit empty body is complete.
  if (note.content === '' && note.contentLength === undefined) return 'small';
  const length = note.contentLength;
  if (length === undefined || !Number.isSafeInteger(length) || length < 0) return 'unknown';
  if (length <= RICH_NOTE_EDIT_BYTES / 4) return 'small';
  if (length > RICH_NOTE_EDIT_BYTES) return 'large';
  return 'unknown';
}
