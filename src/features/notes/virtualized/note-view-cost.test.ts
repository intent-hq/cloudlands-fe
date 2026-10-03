import { expect, it } from 'vitest';
import { measureNoteProjection, NOTE_VIEW_LIMITS } from './note-view-cost';
import { SourceProjection } from './projection/source-projection';
it('charges retained provenance and document payload once per owned object without serializing the shared graph', () => {
  const p = new SourceProjection('café 🌍 '.repeat(700));
  const cost = measureNoteProjection(p);
  expect(cost.projectedNodes).toBe(2);
  expect(cost.derivedBytes).toBeGreaterThan(p.source.length * 10);
  expect(cost.derivedBytes).toBeLessThan(NOTE_VIEW_LIMITS.derivedBytes);
  expect(cost.provenanceEntries).toBeGreaterThan(p.source.length);
});
it('rejects a dense native tree before it can be mounted', () => {
  const p = new SourceProjection('a\n\n'.repeat(NOTE_VIEW_LIMITS.nodes + 1));
  expect(() => measureNoteProjection(p)).toThrow(/node budget/);
});
