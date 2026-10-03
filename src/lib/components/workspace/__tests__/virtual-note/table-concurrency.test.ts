import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { CellSelection } from '@tiptap/pm/tables';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { store } from '$store/renderer/configured-store';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = '| H | R |\n| :--- | ---: |\n| beforeafter | right |\n| bottom | last |';
async function start() {
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  await session.seek(source.indexOf('after'));
  session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('after')));
  return { service, session };
}
it('retains native cell selection across destroyed views', async () => {
  const { session } = await start();
  try {
    const cells = session.projection!.table!.entries.filter((e) => e.cell.row === 1);
    session.editor!.view.dispatch(
      session.editor!.state.tr.setSelection(
        CellSelection.create(session.editor!.state.doc, cells[0].pm, cells[1].pm),
      ),
    );
    const selection = session.editor!.state.selection.toJSON();
    const old = session.editor!;
    await session.seek(session.selection.head);
    expect(old.isDestroyed).toBe(true);
    expect(session.editor!.state.selection.toJSON()).toEqual(selection);
  } finally {
    session.destroy();
  }
});
it('maps session structure and global history through remote prose and row insertions', async () => {
  const { service, session } = await start();
  try {
    session.editor!.commands.splitBlock();
    const cell = session.editor!.state.selection.$head.node(3).toJSON();
    session.remote({ from: 0, to: 0, insert: 'Remote prose\n\n' });
    expect(
      session.projection!.table ??
        session.projection!.mixed?.parts.find((part) => part.projection.table)?.projection.table,
    ).toBeDefined();
    expect(session.error).toBe('');
    expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(cell);
    const at = service.region(0).indexOf('| before');
    session.remote({ from: at, to: at, insert: '| remote | row |\n' });
    await session.seek(session.selection.head);
    expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(cell);
    await session.history();
    expect(service.region(0)).toBe(
      'Remote prose\n\n' + source.replace('| before', '| remote | row |\n| before'),
    );
    expect(session.editor!.state.selection.$head.node(3).childCount).toBe(1);
    await session.history(true);
    expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(cell);
  } finally {
    session.destroy();
  }
});
it('rolls back cell metadata, source, view and history if journal recording fails', async () => {
  const { service, session } = await start();
  try {
    const native = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(source),
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    try {
      expect(native.state.doc.childCount).toBe(1);
      native.commands.setTextSelection(session.editor!.state.selection.head);
      expect(native.state.doc.childCount).toBe(2);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
    } finally {
      native.destroy();
    }
    const doc = session.editor!.state.doc.toJSON(),
      selection = session.editor!.state.selection.toJSON(),
      revision = service.revision,
      depth = service.depth,
      metadataBytes = service.stats.backingTableMetadataBytes,
      metadata = [...(service as unknown as { tableStates: Map<string, string> }).tableStates],
      history = Array.from({ length: service.depth }, (_, i) => ({
        event: structuredClone(service.event(i)),
        changes: [...service.changes(i)],
      }));
    expect(metadata).toEqual([['tail:0', '1']]);
    const fail = vi.spyOn(service, 'record').mockImplementationOnce(() => {
      throw new Error('injected table admission failure');
    });
    session.editor!.commands.splitBlock();
    fail.mockRestore();
    expect(session.error).toContain('injected table admission failure');
    expect(service.region(0)).toBe(source);
    expect(service.revision).toBe(revision);
    expect(service.depth).toBe(depth);
    expect(service.stats.backingTableMetadataBytes).toBe(metadataBytes);
    expect([...(service as unknown as { tableStates: Map<string, string> }).tableStates]).toEqual(
      metadata,
    );
    expect(
      Array.from({ length: service.depth }, (_, i) => ({
        event: service.event(i),
        changes: [...service.changes(i)],
      })),
    ).toEqual(history);
    expect(session.editor!.state.doc.toJSON()).toEqual(doc);
    expect(session.editor!.state.selection.toJSON()).toEqual(selection);
  } finally {
    session.destroy();
  }
});
it('rejects a remote deletion of live structural metadata atomically', async () => {
  const { service, session } = await start();
  try {
    session.editor!.commands.splitBlock();
    const revision = service.revision,
      doc = session.editor!.state.doc.toJSON(),
      depth = service.depth;
    const from = source.indexOf('| before'),
      to = source.indexOf('| bottom');
    expect(() => session.remote({ from, to, insert: '' })).toThrow(/Conflict/);
    expect(service.region(0)).toBe(source);
    expect(service.revision).toBe(revision);
    expect(service.depth).toBe(depth);
    expect(session.editor!.state.doc.toJSON()).toEqual(doc);
  } finally {
    session.destroy();
  }
});

it('discards a delayed table navigation after a local native edit without overwriting source or selection', async () => {
  const { service, session } = await start();
  try {
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = session.seek(source.indexOf('bottom'));
    session.editor!.view.dispatch(session.editor!.state.tr.insertText('LOCAL'));
    expect(session.error).toBe('');
    const doc = session.editor!.getJSON(),
      selection = structuredClone(session.selection),
      revision = service.revision;
    session.delayFetch = undefined;
    release();
    expect(await pending).toBe(false);
    expect(session.editor!.getJSON()).toEqual(doc);
    expect(session.selection).toEqual(selection);
    expect(service.revision).toBe(revision);
    expect(service.region(0)).toBe(source.replace('beforeafter', 'beforeLOCALafter'));
    expect(session.snapshot().mounted).toBe(1);
    await session.history();
    expect(service.region(0)).toBe(source);
    await session.history(true);
    expect(service.region(0)).toBe(source.replace('beforeafter', 'beforeLOCALafter'));
    expect(session.editor!.getJSON()).toEqual(doc);
  } finally {
    session.destroy();
  }
});

it('supersedes a delayed table window after a remote row insertion and preserves global history', async () => {
  const { service, session } = await start();
  try {
    session.editor!.view.dispatch(session.editor!.state.tr.insertText('LOCAL'));
    const cell = session.editor!.state.selection.$head.node(3).toJSON();
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = session.seek(source.indexOf('bottom'));
    const at = service.region(0).indexOf('| before');
    const remote = '| remote | row |\n';
    session.remote({ from: at, to: at, insert: remote });
    expect(await pending).toBe(false);
    session.delayFetch = undefined;
    release();
    await vi.waitFor(() => expect(session.projection!.context!.revision).toBe(service.revision));
    expect(session.error).toBe('');
    expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(cell);
    expect(service.region(0)).toBe(source.replace('| beforeafter', remote + '| beforeLOCALafter'));
    await session.history();
    expect(service.region(0)).toBe(source.replace('| before', remote + '| before'));
    await session.history(true);
    expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(cell);
    expect(session.snapshot().mounted).toBe(1);
  } finally {
    session.destroy();
  }
});

for (const change of ['edit', 'selection', 'composition', 'destroy'] as const)
  it(`does not repopulate a delayed measured refill after ${change}`, async () => {
    const { session, service } = await start();
    const internals = session as unknown as {
      navigation: number;
      selectionGeneration: number;
      tableScroller: HTMLElement;
      measuredTableGap: () => {
        cell: number;
        units: number;
        height: number;
        required: number;
        deficit: number;
        position: number;
      };
      fillTableCoverage: (
        navigation: number,
        revision: number,
        generation: number,
      ) => Promise<void>;
    };
    const scroller = document.createElement('div');
    internals.tableScroller = scroller;
    const old = session.projection!,
      cell = old.table!.window.cells.find((c) => c.row === 1)!;
    const oldPayload = JSON.stringify(old.table!.window);
    const gap = vi.spyOn(internals, 'measuredTableGap').mockReturnValue({
      cell: cell.from,
      units: 2146,
      height: 456,
      required: 520,
      deficit: 64,
      position: cell.body,
    });
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    try {
      const pending = internals.fillTableCoverage(
        internals.navigation,
        service.revision,
        internals.selectionGeneration,
      );
      if (change === 'edit') session.editor!.commands.insertContent('Q');
      if (change === 'selection') session.editor!.commands.setTextSelection(1);
      if (change === 'composition')
        Object.defineProperty(session.editor!.view, 'composing', {
          configurable: true,
          value: true,
        });
      if (change === 'destroy') session.destroy();
      const projection = session.projection,
        source = service.region(0),
        selection = structuredClone(session.selection);
      session.delayFetch = undefined;
      release();
      await pending;
      expect(session.projection).toBe(projection);
      expect(service.region(0)).toBe(source);
      expect(session.selection).toEqual(selection);
      expect(JSON.stringify(old.table!.window)).toBe(oldPayload);
      expect(session.snapshot().tableCoverageIntentBytes).toBe(0);
    } finally {
      gap.mockRestore();
      session.destroy();
    }
  });

it('services one newer physical scroll after cancelling a delayed measured refill', async () => {
  const source =
    '| H |\n| --- |\n' +
    Array.from({ length: 100 }, (_, i) => `| row${i} ${'text '.repeat(30)} |`).join('\n');
  const service = new SourceJournal(() => source, 1),
    scroller = document.createElement('div'),
    host = document.createElement('div');
  scroller.append(host);
  const session = new DocumentSession(service, host);
  const state = session as unknown as {
    navigation: number;
    selectionGeneration: number;
    tableScroller: HTMLElement;
    tableColumnWidth: number;
    tableScroll: () => void;
    measuredTableGap: () => unknown;
    fillTableCoverage: (n: number, r: number, g: number) => Promise<void>;
  };
  try {
    await session.seek(source.indexOf('row0'));
    Object.defineProperties(scroller, {
      clientHeight: { value: 520 },
      clientWidth: { value: 1280 },
      scrollHeight: { value: 8000 },
    });
    state.tableScroller = scroller;
    state.tableColumnWidth = 1280;
    scroller.addEventListener('scroll', state.tableScroll);
    const cell = session.projection!.table!.window.cells.find((c) => c.row === 1)!;
    const gap = vi
      .spyOn(state, 'measuredTableGap')
      .mockReturnValueOnce({
        cell: cell.from,
        units: 100,
        height: 456,
        required: 520,
        deficit: 64,
        position: cell.body,
      })
      .mockReturnValue(undefined);
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const selection = structuredClone(session.selection),
      revision = service.revision;
    const pending = state.fillTableCoverage(state.navigation, revision, state.selectionGeneration);
    scroller.scrollTop = 41 * 50;
    scroller.dispatchEvent(new Event('scroll'));
    session.delayFetch = undefined;
    release();
    await pending;
    await vi.waitFor(() =>
      expect(session.projection!.table!.window.cells.some((c) => c.row === 50)).toBe(true),
    );
    expect(service.region(0)).toBe(source);
    expect(service.revision).toBe(revision);
    expect(session.selection).toEqual(selection);
    expect(session.snapshot().tableCoverageIntentBytes).toBe(0);
    gap.mockRestore();
  } finally {
    session.destroy();
  }
});
