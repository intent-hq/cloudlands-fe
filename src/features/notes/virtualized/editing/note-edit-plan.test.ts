import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import wire from '$lib/client/mock/fixtures/note-pages-contract.json';
import type { NoteSplice } from '$lib/client/note-pages';
import { composeNoteEdits, prepareNoteSave, type NoteSaveInput } from './note-edit-plan';

const scope = { backendId: 'db-a', workspaceId: 'ws-a', noteId: 'spec', noteInstanceId: 'inc-a' };
const now = Date.parse('2026-10-03T23:59:59.000Z');
function input(splices: NoteSplice[] = [{ start: 0, end: 1, text: 'updated' }]): NoteSaveInput {
  vi.stubGlobal('crypto', webcrypto);
  return {
    scope: { ...scope },
    sourceLength: 12,
    baseRevision: 'r:7',
    operationId: '11111111-1111-4111-8111-111111111111',
    expiresAt: '2026-10-04T00:00:00.000Z',
    splices,
  };
}
afterEach(() => vi.unstubAllGlobals());
const apply = (text: string, splices: readonly NoteSplice[]) => {
  for (const s of [...splices].reverse())
    text = text.slice(0, s.start) + s.text + text.slice(s.end);
  return text;
};

it('conserves unloaded source and addresses repeated text by position', () => {
  const sourceLength = 200_000_000;
  const result = composeNoteEdits(sourceLength, [
    { splices: [{ start: 150_000_000, end: 150_000_003, text: '🦀\r\n' }] },
    { splices: [{ start: 150_000_002, end: 150_000_004, text: 'x' }] },
  ]);
  expect(result).toEqual([{ start: 150_000_000, end: 150_000_003, text: '🦀x' }]);
  const repeated = 'same same same';
  const edits = composeNoteEdits(repeated.length, [
    { splices: [{ start: 10, end: 14, text: 'last' }] },
  ]);
  expect(apply(repeated, edits)).toBe('same same last');
});

it('normalizes touching changes and edits inside inserted text to one base batch', () => {
  const source = 'abcdef';
  const result = composeNoteEdits(source.length, [
    {
      splices: [
        { start: 1, end: 3, text: 'XY' },
        { start: 3, end: 4, text: 'Z' },
      ],
    },
    {
      splices: [
        { start: 2, end: 3, text: '🦀' },
        { start: 5, end: 6, text: '!' },
      ],
    },
  ]);
  expect(result).toEqual([
    { start: 1, end: 4, text: 'X🦀Z' },
    { start: 5, end: 6, text: '!' },
  ]);
  expect(apply(source, result)).toBe('aX🦀Ze!');
});

it('recognizes an insertion and its inverse without reading unchanged source', () => {
  expect(
    composeNoteEdits(900_000, [
      { splices: [{ start: 800_000, end: 800_000, text: '🦀' }] },
      { splices: [{ start: 800_000, end: 800_002, text: '' }] },
    ]),
  ).toEqual([]);
  expect(composeNoteEdits(0, [{ splices: [{ start: 0, end: 0, text: 'first' }] }])).toEqual([
    { start: 0, end: 0, text: 'first' },
  ]);
});

it('matches sequential Unicode edits across many page-independent source positions', () => {
  let seed = 71;
  const random = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  for (let example = 0; example < 100; example++) {
    const source = 'α🦀\r\n repeated *Markdown* '.repeat(8);
    let expected = source;
    const batches = [];
    for (let edit = 0; edit < 12; edit++) {
      const boundaries = [0];
      for (const scalar of expected) boundaries.push(boundaries.at(-1)! + scalar.length);
      const a = random(boundaries.length),
        b = random(boundaries.length);
      const splice = {
        start: boundaries[Math.min(a, b)],
        end: boundaries[Math.max(a, b)],
        text: ['🦀', '\r\n', 'e\u0301', '*', '', 'same'][random(6)],
      };
      batches.push({ splices: [splice] });
      expected = apply(expected, [splice]);
    }
    const combined = composeNoteEdits(source.length, batches);
    expect(apply(source, combined)).toBe(expected);
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i].start).toBeGreaterThan(combined[i - 1].start);
      expect(combined[i].start).toBeGreaterThanOrEqual(combined[i - 1].end);
    }
  }
});

it('rejects ambiguous overlap, malformed scalars and inserted-scalar cuts', () => {
  for (const splices of [
    [
      { start: 1, end: 3, text: '' },
      { start: 2, end: 4, text: '' },
    ],
    [
      { start: 1, end: 1, text: 'a' },
      { start: 1, end: 1, text: 'b' },
    ],
    [{ start: 4, end: 2, text: '' }],
    [{ start: 0, end: 1, text: '\ud800' }],
    [{ start: 0, end: 1, text: '\0' }],
  ])
    expect(() => composeNoteEdits(8, [{ splices }])).toThrow();
  expect(() =>
    composeNoteEdits(8, [
      { splices: [{ start: 1, end: 1, text: '🦀' }] },
      { splices: [{ start: 2, end: 3, text: 'x' }] },
    ]),
  ).toThrow('Unicode scalar');
});

it('hashes the exact accepted protocol golden without source normalization', async () => {
  const golden = wire.requests.find((r) => r.method === 'note.applySplices')!.params;
  const value = input(golden.splices!);
  const operation = await prepareNoteSave(value, now);
  expect(operation.payloadDigest).toBe(golden.payloadDigest);
  expect(operation.splices).toEqual(golden.splices);
});

it('captures immutable retry bytes before asynchronous hashing and later typing', async () => {
  const value = input();
  const expected = structuredClone(value);
  const pending = prepareNoteSave(value, now);
  value.scope.noteId = 'other';
  (value.splices as NoteSplice[])[0].text = 'later typing';
  const operation = await pending;
  expect(operation.scope).toEqual(expected.scope);
  expect(operation.splices).toEqual(expected.splices);
  expect(operation.payloadDigest).toBe((await prepareNoteSave(expected, now)).payloadDigest);
  expect(Object.isFrozen(operation)).toBe(true);
  expect(Object.isFrozen(operation.splices[0])).toBe(true);
});

it('routes large or heavily escaped edits to staged operations without truncating', async () => {
  await expect(
    prepareNoteSave(input([{ start: 0, end: 1, text: 'x'.repeat(16_384) }]), now),
  ).resolves.toBeDefined();
  for (const text of ['x'.repeat(16_385), '\u0001'.repeat(16_384)]) {
    const value = input([{ start: 0, end: 1, text }]);
    await expect(prepareNoteSave(value, now)).rejects.toThrow('staged save');
    expect(value.splices[0].text).toBe(text);
  }
  const many = input(Array.from({ length: 33 }, (_, start) => ({ start, end: start, text: 'x' })));
  many.sourceLength = 40;
  await expect(prepareNoteSave(many, now)).rejects.toThrow('staged save');
});

it('rejects stale operation deadlines and invalid identity instead of minting retries', async () => {
  for (const patch of [
    { expiresAt: '2026-10-03T00:00:00.000Z' },
    { expiresAt: '2026-10-06T00:00:00.000Z' },
    { expiresAt: '2026-10-04T00:00:00Z' },
    { expiresAt: '2026-02-31T00:00:00.000Z' },
    { operationId: 'fresh-id' },
    { baseRevision: '' },
    { sourceLength: -1 },
  ])
    await expect(prepareNoteSave({ ...input(), ...patch }, now)).rejects.toThrow();
});
