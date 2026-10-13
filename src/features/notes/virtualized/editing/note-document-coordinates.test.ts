import { expect, it } from 'vitest';
import { createNoteDocumentSession } from './note-document-edit-session';
import { noteDocumentCoordinates } from './note-document-coordinates';
import { SourceProjection } from '../projection/source-projection';

it('maps far current seeks through inserted, replaced and deleted source without joining it', () => {
  const state = createNoteDocumentSession(
    { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    'r',
    10000,
  );
  state.dirty = [
    { start: 100, end: 100, text: '🦀x' },
    { start: 700, end: 705, text: 'XY' },
    { start: 900, end: 904, text: '' },
  ];
  state.length = 9996;
  const c = noteDocumentCoordinates(state, new SourceProjection('def', 800));
  expect([c.start, c.end, c.length]).toEqual([800, 803, 9996]);
  expect(c.toBase(50)).toBe(50);
  expect(c.toBase(102)).toBe(100);
  expect(c.toBase(103)).toBe(100);
  expect(c.toBase(500)).toBe(497);
  expect(c.toBase(703)).toBe(700);
  expect(c.toBase(704, -1)).toBe(700);
  expect(c.toBase(704, 1)).toBe(705);
  expect(c.toBase(705)).toBe(705);
  expect(c.toBase(900, -1)).toBe(900);
  expect(c.toBase(900, 1)).toBe(904);
  expect(c.toBase(9996)).toBe(10000);
  expect(() => c.toBase(-1)).toThrow();
  expect(() => c.toBase(1.5)).toThrow();
  expect(() => c.toBase(9997)).toThrow();
});

it('keeps each coordinate snapshot tied to its admitted immutable dirty batch', () => {
  const state = createNoteDocumentSession(
    { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    'r',
    1000,
  );
  const clean = noteDocumentCoordinates(state, new SourceProjection('abc', 100));
  const dirty = noteDocumentCoordinates(
    { ...state, dirty: [{ start: 1, end: 1, text: 'X' }], length: 1001 },
    new SourceProjection('abc', 101),
  );
  expect(clean.toBase(800)).toBe(800);
  expect(dirty.toBase(800)).toBe(799);
  expect(Object.isFrozen(dirty)).toBe(true);
  expect(() => noteDocumentCoordinates(state, new SourceProjection('abc', 999))).toThrow();
});
