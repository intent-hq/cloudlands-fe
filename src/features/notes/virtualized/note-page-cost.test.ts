import { expect, it } from 'vitest';
import { measureNotePageCost } from './note-page-cost';

const allowance = {
  payloadBytes: 65536,
  stringUnits: 196608,
  objectNodes: 65536,
  domNodes: 0,
  physicalReads: 0,
  assemblies: 0,
};
it('measures decoded strings and JSON nodes without serializing another document', () => {
  expect(measureNotePageCost({ text: 'λ😀', items: [null, true, { n: 1 }] }, allowance)).toEqual({
    payloadBytes: 16,
    stringUnits: 13,
    objectNodes: 7,
    domNodes: 0,
    physicalReads: 0,
    assemblies: 0,
  });
});
it('counts shared actual objects once and handles deeply nested bounded payloads iteratively', () => {
  const shared = { text: 'same' };
  expect(measureNotePageCost([shared, shared], allowance).objectNodes).toBe(3);
  let value: unknown = 'end';
  for (let i = 0; i < 2048; i++) value = [value];
  expect(measureNotePageCost(value, allowance).objectNodes).toBe(2049);
});
it('stops work at the reserved node allowance and rejects strings before unbounded UTF8 scanning', () => {
  const value = { large: 'x'.repeat(2_000_000) };
  expect(() => measureNotePageCost(value, allowance)).toThrow(/allowance/);
  expect(() => measureNotePageCost([1, 2, 3], { ...allowance, objectNodes: 2 })).toThrow(
    /allowance/,
  );
});
