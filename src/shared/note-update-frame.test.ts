import { expect, it } from 'vitest';
import { assertNoteUpdateFrame, NOTE_JSON_FRAME_BYTES } from './note-update-frame';
it('bounds the complete serialized UTF8 frame, including escaping and envelope', () => {
  const frame = (content: string) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 12345,
      method: 'note.update',
      params: { workspaceId: 'w', noteId: 'n', content, expectedVersion: 7 },
    });
  const overhead = new TextEncoder().encode(frame('')).byteLength;
  expect(() =>
    assertNoteUpdateFrame('note.update', frame('a'.repeat(NOTE_JSON_FRAME_BYTES - overhead))),
  ).not.toThrow();
  expect(() =>
    assertNoteUpdateFrame('note.update', frame('a'.repeat(NOTE_JSON_FRAME_BYTES - overhead + 1))),
  ).toThrow();
  expect(() => assertNoteUpdateFrame('note.update', frame('漢'.repeat(14_000_000)))).toThrow();
  expect(() => assertNoteUpdateFrame('note.update', frame('\\'.repeat(21_000_000)))).toThrow();
});
