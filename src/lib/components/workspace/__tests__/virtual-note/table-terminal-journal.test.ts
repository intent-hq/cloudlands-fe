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
