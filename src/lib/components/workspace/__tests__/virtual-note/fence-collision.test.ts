import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

for (const marker of ['`', '~'])
  it(`safely frames literal ${marker} closing lines with one source/history mutation`, async () => {
    const opening = marker.repeat(4) + 'text extra-info\n';
    const body = '  raw **literal** 🌍\t\n'.repeat(5000);
    const ending = marker.repeat(4) + '  \n\nAfter prose';
    const source = opening + body + ending;
    const service = new SourceJournal(() => source, 1);
    const p = new DocumentSession(service, document.createElement('div'));
    const extra = marker === '`' ? 2 : 1;
    const at = 30000,
      inserted = '\n' + marker.repeat(4) + '\n';
    // Independent expected serialization: grow both enclosing markers to six backticks/five tildes,
    // preserving every body byte, info suffix, closer whitespace and following prose.
    const expected =
      marker.repeat(extra) +
      source.slice(0, at) +
      inserted +
      source.slice(at, -ending.length) +
      marker.repeat(extra) +
      ending;
    try {
      await p.seek(at);
      p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
      p.editor!.view.dispatch(p.editor!.state.tr.insertText(inserted));
      expect(p.error).toBe('');
      expect(service.region(0)).toBe(expected);
      expect(p.selection.head).toBe(at + inserted.length + extra);
      expect(service.depth).toBe(1);
      p.save();
      const old = p.editor!;
      await p.seek(70000);
      expect(old.isDestroyed).toBe(true);
      await p.seek(at + inserted.length + extra);
      expect(p.editor!.state.selection.$head.parent.type.name).toBe('codeBlock');
      expect(p.projection!.sourceAt(p.editor!.state.selection.head)).toBe(
        at + inserted.length + extra,
      );
      await p.history();
      expect(service.region(0)).toBe(source);
      expect(p.selection.head).toBe(at);
      await p.history(true);
      expect(service.region(0)).toBe(expected);
      expect(p.selection.head).toBe(at + inserted.length + extra);
    } finally {
      p.destroy();
    }
  });

for (const marker of ['`', '~']) {
  for (const edge of ['opening', 'closing', 'split-line'] as const)
    it(`protects ${marker} literal closing syntax at the ${edge} boundary`, async () => {
      const opening = marker.repeat(4) + 'text extra-info\n';
      const special = '   ' + marker.repeat(12) + ' '.repeat(8000) + 'X\n';
      const body = 'raw 🌍\t **code**\n'.repeat(2200) + special + 'tail\n'.repeat(9000);
      const ending = marker.repeat(8) + '  \n\nAfter prose';
      const source = opening + body + ending;
      const service = new SourceJournal(() => source, 1),
        p = new DocumentSession(service, document.createElement('div'));
      const at =
        edge === 'opening'
          ? opening.length
          : edge === 'closing'
            ? source.length - ending.length - 1
            : source.indexOf('X\n');
      const inserted = edge === 'split-line' ? '' : '\n' + marker.repeat(4) + '\n';
      const removed = edge === 'split-line' ? 1 : 0;
      const extra = edge === 'split-line' ? (marker === '`' ? 11 : 9) : marker === '`' ? 2 : 1;
      const expected =
        marker.repeat(extra) +
        source.slice(0, at) +
        inserted +
        source.slice(at + removed, -ending.length) +
        marker.repeat(Math.max(0, 4 + extra - 8)) +
        ending;
      try {
        await p.seek(at);
        const e = p.editor!;
        e.commands.setTextSelection({
          from: p.projection!.pmAt(at),
          to: p.projection!.pmAt(at + removed),
        });
        e.view.dispatch(e.state.tr.insertText(inserted));
        expect(p.error).toBe('');
        expect(service.region(0)).toBe(expected);
        expect(p.selection.head).toBe(at + inserted.length + extra);
        p.save();
        await p.seek(10000);
        await p.seek(p.selection.head);
        expect(p.editor!.state.selection.$head.parent.type.name).toBe('codeBlock');
        await p.history();
        expect(service.region(0)).toBe(source);
        await p.history(true);
        expect(service.region(0)).toBe(expected);
        expect(p.snapshot().maxSourceRead).toBeLessThanOrEqual(4096);
        expect(p.snapshot().maxInlineContextBytes).toBeLessThanOrEqual(4096);
        expect(p.snapshot().maxFenceRepairBytes).toBeLessThanOrEqual(4096);
        expect(p.snapshot().maxBackingFenceScanBytes).toBeGreaterThan(70000);
      } finally {
        p.destroy();
      }
    });
}

it('rolls back body and both delimiter writes when admission fails partway through', async () => {
  const source = '````text\n' + 'raw code\n'.repeat(12000) + '````\n\nAfter';
  const service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(30000);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(30000));
    const before = p.editor!.getJSON(),
      revision = service.revision,
      selection = { ...p.selection };
    const stage = service.stage.bind(service);
    let calls = 0;
    service.stage = (splice, history) => {
      stage(splice, history);
      if (++calls === 3) throw new Error('Injected delimiter write failure');
    };
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('\n````\n'));
    expect(p.error).toContain('Injected delimiter write failure');
    expect(service.region(0)).toBe(source);
    expect(service.revision).toBe(revision);
    expect(service.depth).toBe(0);
    expect(service.stats.backingStagedJournalBytes).toBe(0);
    expect(p.selection).toEqual(selection);
    expect(p.editor!.getJSON()).toEqual(before);
  } finally {
    p.destroy();
  }
});

it('rejects stale fence admission before any source or journal write', async () => {
  const service = new SourceJournal(() => '````text\nbody\n````\n\nAfter', 1);
  const revision = service.revision;
  service.apply({ from: 10, to: 10, insert: 'remote' });
  const source = service.region(0),
    current = service.revision;
  expect(() =>
    service.stageProjection([{ from: 12, to: 12, insert: '\n````\n' }], [], revision),
  ).toThrow('Stale code admission revision');
  expect(service.region(0)).toBe(source);
  expect(service.revision).toBe(current);
  expect(service.depth).toBe(0);
});

for (const marker of ['`', '~'])
  it(`grows repeated ${marker} collisions as separate chronological events`, async () => {
    const opening = marker.repeat(4) + 'text\n',
      ending = marker.repeat(4) + '\n\nAfter';
    const source = opening + 'raw code\n'.repeat(12000) + ending;
    const service = new SourceJournal(() => source, 1),
      p = new DocumentSession(service, document.createElement('div'));
    const firstGrowth = marker === '`' ? 2 : 1;
    const first = '\n' + marker.repeat(4) + '\n',
      second = '\n' + marker.repeat(7) + '\n';
    const one =
      marker.repeat(firstGrowth) +
      source.slice(0, 30000) +
      first +
      source.slice(30000, -ending.length) +
      marker.repeat(firstGrowth) +
      ending;
    const at = 30000 + first.length + firstGrowth;
    const two =
      marker.repeat(3) +
      one.slice(0, at) +
      second +
      one.slice(at, -(ending.length + firstGrowth)) +
      marker.repeat(firstGrowth + 3) +
      ending;
    try {
      await p.seek(30000);
      p.editor!.commands.setTextSelection(p.projection!.pmAt(30000));
      p.editor!.view.dispatch(p.editor!.state.tr.insertText(first).setTime(1000));
      expect(service.region(0)).toBe(one);
      p.editor!.view.dispatch(p.editor!.state.tr.insertText(second).setTime(2000));
      expect(p.error).toBe('');
      expect(service.region(0)).toBe(two);
      expect(p.selection.head).toBe(at + second.length + 3);
      expect(service.depth).toBe(2);
      p.save();
      await p.seek(70000);
      await p.history();
      expect(service.region(0)).toBe(one);
      expect(p.selection.head).toBe(at);
      await p.history();
      expect(service.region(0)).toBe(source);
      expect(p.selection.head).toBe(30000);
      await p.history(true);
      expect(service.region(0)).toBe(one);
      expect(p.selection.head).toBe(at);
      await p.history(true);
      expect(service.region(0)).toBe(two);
      expect(p.selection.head).toBe(at + second.length + 3);
    } finally {
      p.destroy();
    }
  });
