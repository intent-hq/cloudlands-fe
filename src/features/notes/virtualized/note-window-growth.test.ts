import { expect, it } from 'vitest';
import { projectNoteWindow } from './note-window-projection';
import { canonicalGrowthFixture as provider } from './__tests__/canonical-growth-fixture';
const source = 'First prefix....Second portion..Third portion...Fourth portion..';
it('grows a canonical window at the same anchor through actual source cursors', async () => {
  const ordinary = provider();
  expect((await ordinary.read()).range).toEqual({ start: 0, end: 16 });
  const p = provider(),
    window = await p.read(32);
  expect(window.range).toEqual({ start: 0, end: 32 });
  expect(window.text).toBe(source.slice(0, 32));
  expect(p.seen.filter((q) => q.kind === 'source').map((q) => q.cursor ?? q.at)).toEqual([0, '16']);
  const projection = projectNoteWindow(window);
  expect(JSON.stringify(projection.content)).toContain(source.slice(0, 32));
  expect(window.cost.requests).toBeLessThanOrEqual(96);
  expect(window.cost.canonicalBytes).toBeLessThanOrEqual(32768);
});

it('refuses further growth at the unchanged canonical work checkpoint', async () => {
  const p = provider(undefined, 4500),
    window = await p.read(32);
  expect(window.range).toEqual({ start: 0, end: 16 });
  expect(window.cost.canonicalWorkBytes).toBeGreaterThan(4096);
  expect(p.seen.filter((q) => q.kind === 'source')).toHaveLength(1);
});
