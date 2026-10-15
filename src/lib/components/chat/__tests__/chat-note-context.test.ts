import { describe, expect, it } from 'vitest';
import { formatNoteContext, prepareNoteContext } from '../chat-note-context';
import { deserializeDraftAttachments, serializeDraftAttachments } from '../chat-draft-attachments';
import type { ContextItem } from '../input/context-item';

const note: ContextItem = {
  id: 'pill-1',
  type: 'note',
  label: 'Research',
  noteId: '4f552380-8cc4-4352-a427-7383d974fb88',
  workspaceId: 'workspace-1',
};

describe('note context preparation', () => {
  it('keeps quoted IDs and multiline titles as data in the supported note read instruction', () => {
    const id = 'note-"quoted"\\id';
    const context = formatNoteContext(id, 'Title\nwith "quotes"');
    const argument = context.match(/ws\.note\.read\(("(?:\\.|[^"\\])*")\)/)?.[1];
    expect(argument).toBeDefined();
    if (!argument) throw new Error('Expected a JSON note read argument');
    expect(JSON.parse(argument)).toBe(id);
    expect(context.split('\n')).toHaveLength(1);
  });
  it('prepares restored exact identities once in selection order, without copying note bodies', () => {
    const items = deserializeDraftAttachments(
      JSON.parse(
        JSON.stringify(
          serializeDraftAttachments([
            { ...note, content: 'stale body', metadata: { note: { content: 'private cache' } } },
            { ...note, id: 'second-pill-for-the-same-note', label: 'Older title' },
            { ...note, id: 'pill-2', noteId: 'note-2', label: 'Decisions' },
            { id: 'attachment', type: 'file', label: 'report.pdf', attachmentId: 'placed-1' },
          ]),
        ),
      ),
    );
    const prepared = prepareNoteContext('workspace-1', items);
    expect(prepared).toMatchObject({
      ok: true,
      noteIds: ['4f552380-8cc4-4352-a427-7383d974fb88', 'note-2'],
      contextReferences: [
        {
          type: 'note',
          noteId: '4f552380-8cc4-4352-a427-7383d974fb88',
          metadata: { workspaceId: 'workspace-1' },
        },
        { type: 'note', noteId: 'note-2', metadata: { workspaceId: 'workspace-1' } },
      ],
    });
    if (!prepared.ok) throw new Error('Expected valid note references');
    const noteReads = [
      ...prepared.workspaceContextStr.matchAll(/ws\.note\.read\(("(?:\\.|[^"\\])*")\)/g),
    ].map((match) => JSON.parse(match[1]));
    expect(noteReads).toEqual(['4f552380-8cc4-4352-a427-7383d974fb88', 'note-2']);
    expect(prepared.workspaceContextStr).not.toContain('stale body');
  });

  it.each([
    { noteId: undefined },
    { noteId: '' },
    { noteId: ' note-2' },
    { workspaceId: undefined },
    { workspaceId: '' },
    { workspaceId: 'workspace-1 ' },
  ])('blocks malformed identity instead of inferring it from other fields: %j', (invalid) => {
    const items = deserializeDraftAttachments(
      serializeDraftAttachments([
        note,
        { ...note, ...invalid, id: 'invalid', path: 'note-2', metadata: { noteId: 'note-2' } },
      ]),
    );
    expect(items).toHaveLength(2);
    expect(prepareNoteContext('workspace-1', items)).toEqual({
      ok: false,
      itemId: 'invalid',
      reason: 'invalid-reference',
    });
  });

  it('rejects a foreign reference even when its note id duplicates an earlier local reference', () => {
    expect(
      prepareNoteContext('workspace-1', [
        note,
        { ...note, id: 'foreign', workspaceId: 'workspace-2' },
      ]),
    ).toEqual({
      ok: false,
      itemId: 'foreign',
      reason: 'cross-workspace',
    });
  });

  it('leaves non-note context untouched and keeps opaque note identifiers exact', () => {
    expect(
      prepareNoteContext('workspace-1', [{ id: 'file', type: 'file', label: 'file.txt' }]),
    ).toEqual({
      ok: true,
      noteIds: [],
      contextReferences: [],
      workspaceContextStr: '',
    });
    const prepared = prepareNoteContext('workspace-1', [
      { ...note, noteId: 'custom/note', label: 'A "quoted" title' },
    ]);
    expect(prepared.ok && prepared.noteIds).toEqual(['custom/note']);
    expect(prepared.ok && prepared.workspaceContextStr).toContain('ws.note.read("custom/note")');
  });
});
