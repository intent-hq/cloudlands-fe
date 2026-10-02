import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
const source = '| H |\n| --- |\n| text |';
const at = source.indexOf('text');
const selection = { anchor: at, head: at, affinity: 1 as const, revision: 1 };
const record = (s: SourceJournal) =>
  s.record(
    {
      changes: [],
      before: selection,
      after: { ...selection, revision: s.revision },
      anchorsBefore: [],
      anchorsAfter: [],
    },
    false,
  );
const seeded = () => {
  const s = new SourceJournal(() => source, 1);
  s.atomic(() => {
    s.beginChanges();
    s.stageTableTrailing(0, true, s.revision);
    record(s);
  });
  return s;
};
it('rolls back failed source-less table terminal admission and rejects stale writes', () => {
  const s = new SourceJournal(() => source, 1),
    revision = s.revision;
  expect(() =>
    s.atomic(() => {
      s.beginChanges();
      s.stageTableTrailing(0, true, revision);
      record(s);
      throw Error('injected after journal');
    }),
  ).toThrow('injected');
  expect(s.revision).toBe(revision);
  expect(s.depth).toBe(0);
  expect(s.region(0)).toBe(source);
  expect(s.tableWindow(at)!.trailing).toBe(false);
  expect(() => s.atomic(() => s.stageTableTrailing(0, true, revision - 1))).toThrow('Stale');
  expect(s.tableWindow(at)!.trailing).toBe(false);
});
it('keeps terminal context on bounded pages and replays its exact source-less state', () => {
  const s = seeded();
  expect(s.tableWindow(at)!.trailing).toBe(true);
  for (const c of s.changes(0))
    expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(4096);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.tableWindow(at)!.trailing).toBe(false);
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(s.tableWindow(at)!.trailing).toBe(true);
  expect(s.region(0)).toBe(source);
  expect(new SourceJournal(() => source, 1).tableWindow(at)!.trailing).toBe(false);
});
it('maps remote prefix insertion and retained terminal redo without losing accepted source', () => {
  const s = seeded(),
    remote = { from: 0, to: 0, insert: 'prefix\n\n' };
  s.atomic(() => {
    s.validateTableRemote(remote);
    s.apply(remote);
    s.rebase(remote);
  });
  expect(s.tableWindow(at + remote.insert.length)!.trailing).toBe(true);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.tableWindow(at + remote.insert.length)!.trailing).toBe(false);
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(s.tableWindow(at + remote.insert.length)!.trailing).toBe(true);
  expect(s.region(0)).toBe(remote.insert + source);
});
it('rejects remote owner removal atomically instead of transferring a terminal state to unrelated source', () => {
  const s = seeded(),
    revision = s.revision,
    remote = { from: 0, to: source.length, insert: 'unrelated' };
  expect(() =>
    s.atomic(() => {
      s.validateTableRemote(remote);
      s.apply(remote);
      s.rebase(remote);
    }),
  ).toThrow('Conflict');
  expect(s.region(0)).toBe(source);
  expect(s.revision).toBe(revision);
  expect(s.tableWindow(at)!.trailing).toBe(true);
});

it('rejects remote deletion of a nonhistorical native terminal owner', () => {
  const s = new SourceJournal(() => source, 1);
  s.atomic(() => s.stageTableTrailing(0, true, s.revision, false));
  const revision = s.revision,
    remote = { from: 0, to: source.length, insert: 'unrelated' };
  expect(() =>
    s.atomic(() => {
      s.validateTableRemote(remote);
      s.apply(remote);
      s.rebase(remote);
    }),
  ).toThrow('Conflict');
  expect(s.region(0)).toBe(source);
  expect(s.revision).toBe(revision);
});

it('refreshes retained viewport geometry after a native source-less terminal append', () => {
  const s = new SourceJournal(() => source, 1);
  const window = s.tableViewportWindow(at, {
    width: 640,
    height: 520,
    font: 'sans-serif|16px|24px|normal',
  })!;
  s.atomic(() => s.stageTableTrailing(0, true, s.revision, false));
  const next = s.tableWindow(at, window)!;
  expect(next.revision).toBe(s.revision);
  expect(next.geometry!.revision).toBe(s.revision);
  expect(next.trailing).toBe(true);
  expect(next.cells.map((c) => c.raw)).toEqual(window.cells.map((c) => c.raw));
  expect(() => s.tableHeights.record(window.geometry!, window.geometry!.heights)).toThrow(
    'Stale table geometry',
  );
  expect(() => s.tableHeights.record(next.geometry!, next.geometry!.heights)).not.toThrow();
  expect(s.region(0)).toBe(source);
});

it('retains measured fragment placement through source-less terminal admission and rollback', () => {
  const text = 'abcdefghij '.repeat(6000);
  const source = `| H | R |\n| --- | --- |\n| ${text} | neighbor |`;
  const s = new SourceJournal(() => source, 1);
  const viewport = { width: 1280, height: 520, top: 0, font: '16px/24px sans-serif' };
  const initial = s.tableViewportWindow(source.indexOf(text), viewport)!;
  const cell = initial.cells.find((c) => c.row === 1 && c.column === 0)!;
  s.tableHeights.measureCells(initial, [
    { cell: cell.from, height: cell.raw.length * 0.73, padding: 17 },
  ]);
  const middle = s.tableViewportWindow(cell.body, {
    ...viewport,
    top: initial.geometry!.total / 2,
  })!;
  expect(middle.layout![0].top).toBeGreaterThan(10000);
  const geometry = middle.geometry!,
    layout = middle.layout;
  expect(() =>
    s.atomic(() => {
      s.stageTableTrailing(0, true, s.revision, false);
      const next = s.tableWindow(cell.body, middle)!;
      expect(next.layout).toEqual(layout);
      expect(next.geometry).toEqual({ ...geometry, revision: s.revision });
      throw Error('rollback measured append');
    }),
  ).toThrow('rollback measured append');
  expect(s.revision).toBe(geometry.revision);
  expect(s.tableWindow(cell.body, middle)!.layout).toEqual(layout);
  s.atomic(() => s.stageTableTrailing(0, true, s.revision, false));
  const next = s.tableWindow(cell.body, middle)!;
  expect(next.layout).toEqual(layout);
  expect(next.geometry).toEqual({ ...geometry, revision: s.revision });
  expect(s.region(0)).toBe(source);
  expect(() => s.tableHeights.record(geometry, geometry.heights)).toThrow('Stale');
  s.atomic(() => s.stage({ from: cell.body, to: cell.body + 1, insert: 'X' }, false));
  const changed = s.tableViewportWindow(cell.body, viewport)!;
  expect(changed.geometry!.total).toBeLessThan(geometry.total);
  expect(s.region(0)).toBe(source.slice(0, cell.body) + 'X' + source.slice(cell.body + 1));
});
