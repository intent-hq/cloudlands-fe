/** The existing daemon JSON transport limit, including the serialized envelope. */
export const NOTE_JSON_FRAME_BYTES = 41_943_040;
export function assertNoteUpdateFrame(method: string, frame: string): void {
  if (method !== 'note.update') return;
  if (new TextEncoder().encode(frame).byteLength > NOTE_JSON_FRAME_BYTES) {
    throw Object.assign(
      new Error(
        'The complete note request exceeds the transport limit; your draft has not been sent.',
      ),
      { code: 'NOTE_REQUEST_TOO_LARGE' },
    );
  }
}
