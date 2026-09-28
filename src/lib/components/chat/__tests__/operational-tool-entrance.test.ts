/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OperationalPanelHost from './OperationalPanelHost.svelte';
import { createToolEntranceReservations } from '../operational-tool-entrance.svelte';
import { createWindowItemProjector } from '../operational-window-items';

const phases = vi.hoisted(() => ({ writes: [] as Array<{ run: () => void; cancelled: boolean }> }));
vi.mock('$lib/utils/layout-phases', () => ({
  scheduleLayoutRead: () => vi.fn(),
  scheduleLayoutWrite: (run: () => void) => {
    const task = { run, cancelled: false };
    phases.writes.push(task);
    return () => {
      task.cancelled = true;
    };
  },
}));
let reserve: ReturnType<typeof createToolEntranceReservations>;
let entered: Set<string | undefined>;
let measured: number | undefined;
let admitted: boolean;
const row = (id: string | undefined) =>
  createWindowItemProjector()(
    [{ type: 'tool_use', id, name: 'view', input: {} }],
    'message',
    () => true,
  )[0];
async function frame() {
  for (const task of phases.writes.splice(0)) if (!task.cancelled) await task.run();
}
beforeEach(() => {
  phases.writes.length = 0;
  entered = new Set();
  measured = undefined;
  admitted = false;
  render(OperationalPanelHost, {
    ready: (panel) => {
      vi.spyOn(panel, 'locate').mockImplementation(() => ({
        node: undefined,
        admitted,
        kind: 'tool',
        scrollRoot: undefined,
        top: 0,
        height: measured ?? 1,
      }));
      vi.spyOn(panel, 'measuredHeight').mockImplementation(() => measured);
      reserve = createToolEntranceReservations(panel, entered);
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('restores natural geometry for a deferred batch after one admission pass', async () => {
  const rows = Array.from({ length: 160 }, (_, index) => row(`tool-${index}`));
  expect(rows.map((item) => reserve(item, true).estimatedHeight)).toEqual(Array(160).fill(1));
  await frame();
  expect(rows.map((item) => reserve(item, true).estimatedHeight)).toEqual(Array(160).fill(28));
  expect(entered.size).toBe(160);
  expect(phases.writes).toHaveLength(0);
});

it('keeps an admitted animation origin until positive cached geometry exists', async () => {
  const item = row('tool');
  expect(reserve(item, true).estimatedHeight).toBe(1);
  entered.add('tool');
  admitted = true;
  await frame();
  expect(reserve(item, true).estimatedHeight).toBe(1);
  measured = 3;
  await frame();
  expect(reserve(item, true)).toBe(item);
  expect(phases.writes).toHaveLength(0);
});

it('uses natural geometry for reduced motion, disabled animation, and initial history', () => {
  const item = row('tool');
  expect(reserve(item, false)).toBe(item);
  entered.add('tool');
  expect(reserve(item, true)).toBe(item);
  expect(phases.writes).toHaveLength(0);
});

it('cancels its pending admission work on renderer destruction', async () => {
  reserve(row('tool'), true);
  cleanup();
  await frame();
  expect(entered.size).toBe(0);
  expect(phases.writes).toHaveLength(0);
});

it('accepts the optional source identity used by the renderer entrance set', async () => {
  const item = row(undefined);
  expect(reserve(item, true).estimatedHeight).toBe(1);
  await frame();
  expect(entered.has(undefined)).toBe(true);
  expect(reserve(item, true)).toBe(item);
  expect(phases.writes).toHaveLength(0);
});
