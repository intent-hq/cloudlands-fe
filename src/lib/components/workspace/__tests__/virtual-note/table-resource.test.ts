import { Plugin } from '@tiptap/pm/state';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { SourceProjection } from './source-projection';
import { tableCloneWork, cloneTableWindow } from './table-payload';
import { encodeTablePages, type TablePage } from './table-transfer';

// Independent reference graph: native JSON/TextEncoder, no production byte helper.
function referenceOwners(input: SourceProjection[]) {
  const projections = [...new Set(input)].filter((p) => p.tableSource);
  const owners = [...new Set(projections.map((p) => p.table!.window.cells))];
  const payload = {
    owners,
    projections: projections.map((p) => ({
      source: p.tableSource!.descriptor,
      context: {
        ...p.context,
        table: { ...p.table!.window, cells: { owner: owners.indexOf(p.table!.window.cells) } },
      },
    })),
  };
  return {
    count: owners.length,
    bytes: new TextEncoder().encode(JSON.stringify(payload)).length,
    descriptors: projections.reduce(
      (n, p) => n + new TextEncoder().encode(JSON.stringify(p.tableSource!.descriptor)).length,
      0,
    ),
  };
}

beforeAll(() => store.init());
afterAll(() => store.dispose());
it('rejects an oversized initial native table tree before replacing the mounted view', async () => {
  const source = '| H |\n| --- |\n| body |';
  const session = new DocumentSession(
    new SourceJournal(() => source, 1),
    document.createElement('div'),
  );
  try {
    await session.seek(source.indexOf('body'));
    const old = session.editor!,
      doc = old.getJSON();
    const project = session as unknown as { project: (...args: unknown[]) => SourceProjection };
    const original = project.project.bind(session);
    const spy = vi.spyOn(project, 'project').mockImplementation((...args) => {
      const next = original(...args);
      next.content.content![0].content![1].content![0].content![0].content = Array.from(
        { length: 4096 },
        (_, n) => ({ type: 'text', text: 'x', ...(n % 2 ? { marks: [{ type: 'bold' }] } : {}) }),
      );
      return next;
    });
    expect(await session.seek(source.indexOf('body'))).toBe(false);
    spy.mockRestore();
    expect(session.error).toContain('node budget');
    expect(old.isDestroyed).toBe(false);
    expect(session.editor).toBe(old);
    expect(old.getJSON()).toEqual(doc);
    expect(session.service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});

it('accounts for native mark wrappers, annotation splits and table columns, and catches DOM overflow', async () => {
  const source = '| **H** |\n| --- |\n| **bold** _italic_ `code` [link](https://example.com) |';
  const service = new SourceJournal(() => source, 1);
  service.anchors = Array.from({ length: 8 }, (_, n) => ({
    id: `a${n}`,
    from: source.indexOf('bold') + n,
    to: source.indexOf('link') + n,
    alive: true,
  }));
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('bold'));
    const stats = session.snapshot(),
      bound = stats.tableResourceBound!;
    expect(bound.supported).toBe(true);
    expect(stats.tableDomElements).toBeLessThanOrEqual(bound.elements);
    expect(stats.tableDomTextNodes).toBeLessThanOrEqual(bound.textNodes);
    expect(bound.columns).toBe(1);
    expect(bound.nodes).toBe(stats.pmNodes);
    const extra = document.createElement('div');
    for (let n = 0; n <= bound.elements; n++) extra.append(document.createElement('span'));
    session.editor!.view.dom.append(extra);
    expect(() => session.snapshot()).toThrow('DOM exceeds');
    extra.remove();
    expect(session.snapshot().tableDomElements).toBe(stats.tableDomElements);
  } finally {
    session.destroy();
  }
});

it('keeps standalone packed cell source ownership explicit through snapshot publication', async () => {
  const source = '| H |\n| --- |\n| **marked** 漢字 body |';
  const session = new DocumentSession(
    new SourceJournal(() => source, 1),
    document.createElement('div'),
  );
  try {
    await session.seek(source.indexOf('body'));
    expect(session.projection!.table).toBeDefined();
    // A string here is the redundant raw join, including in retained debug output.
    expect(typeof session.snapshot().source).toBe('object');
    expect(() => session.projection!.source).toThrow('packed cell source');
    expect(session.service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});

it('meters exact owner descriptors through edit, rollback, eviction and destroy without flattening', async () => {
  const source =
    '| H |\n| --- |\n| **marked** <!--anchor:owned:start-->body<!--anchor:owned:end--> |';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const check = () => {
    const p = session.projection!,
      w = p.table!.window,
      stats = session.snapshot();
    const descriptor = {
      kind: 'packed-cells',
      revision: w.revision,
      from: w.cells[0].first,
      to: w.cells.at(-1)!.last,
      length: w.cells.reduce((n, c) => n + c.raw.length, 0),
      ranges: w.cells.map((c, i) => [i, c.first, c.last]),
    };
    expect(stats.source).toEqual(descriptor);
    expect(stats.activeBytes).toBe(encode(descriptor));
    expect(stats.tableSourceDescriptorBytes).toBe(encode(descriptor));
    expect(stats.inlineContextBytes).toBe(encode(p.context));
    expect(stats.logicalSourceBytes).toBe(
      w.cells.reduce((n, c) => n + new TextEncoder().encode(c.raw).length, 0),
    );
    expect(stats.tableSourceOwnerCount).toBe(1);
    expect(stats.maxTableSourceOwnerOverlap).toBeLessThanOrEqual(2);
    expect(stats.activeBytes + stats.inlineContextBytes).toBeLessThanOrEqual(16384);
    expect(() => p.source).toThrow('packed cell source');
  };
  try {
    await session.seek(source.indexOf('body'));
    check();
    const outgoing = session.projection!,
      before = JSON.stringify(outgoing.table!.window);
    session.editor!.commands.setTextSelection(outgoing.pmAt(source.indexOf('body') + 1));
    session.editor!.commands.insertContent('Q');
    expect(session.error).toBe('');
    check();
    expect(JSON.stringify(outgoing.table!.window)).toBe(before);
    const accepted = service.region(0),
      selection = structuredClone(session.selection),
      revision = service.revision;
    const target = session as unknown as { project: (...args: unknown[]) => SourceProjection };
    const spy = vi.spyOn(target, 'project').mockImplementationOnce(() => {
      throw new Error('forced admission failure');
    });
    session.editor!.commands.insertContent('R');
    spy.mockRestore();
    expect(service.region(0)).toBe(accepted);
    expect(service.revision).toBe(revision);
    expect(session.selection).toEqual(selection);
    check();
    session.error = '';
    for (let n = 0; n < 4; n++) {
      const old = session.editor!;
      await session.seek(source.indexOf('body'));
      expect(old.isDestroyed).toBe(true);
      check();
    }
    const failedSave = vi.spyOn(service, 'save').mockImplementationOnce(() => {
      throw new Error('offline save');
    });
    expect(() => session.save()).toThrow('offline save');
    failedSave.mockRestore();
    expect(service.region(0)).toBe(accepted);
    expect(service.dirty).toContain(0);
    check();
    await session.history();
    expect(service.region(0)).toBe(source);
    check();
    await session.history(true);
    expect(service.region(0)).toBe(accepted);
    check();
    expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
  } finally {
    session.destroy();
  }
  expect(session.snapshot().tableSourceOwnerCount).toBe(0);
  expect(session.snapshot().tableSourceDescriptorBytes).toBe(0);
  expect(session.snapshot().source).toBeUndefined();
});

it('reference-counts receive buffers, cache overlap, clone scratch and both publication phases', async () => {
  const source = '| H |\n| --- |\n| **marked** body |';
  const service = new SourceJournal(() => source, 1);
  let capture = false;
  const phases: Array<ReturnType<DocumentSession['snapshot']>> = [];
  const session = new DocumentSession(service, document.createElement('div'), () => {
    if (capture) phases.push(session.snapshot());
  });
  const size = (s: string) => new TextEncoder().encode(s).length;
  try {
    await session.seek(source.indexOf('body'));
    const owner = session.projection!.table!.window;
    const pages = encodeTablePages(owner, 'packed-cells');
    const old = session.projection!;
    const before = session.snapshot();
    const receiver = session as unknown as {
      receiveTable: (pages: TablePage[], ownership: 'packed-cells') => typeof owner;
    };
    const decoded = receiver.receiveTable(pages, 'packed-cells');
    const stats = session.snapshot(),
      receipt = stats.tableReceiveAccounting;
    expect(receipt.wireBytes).toBe(pages.reduce((n, p) => n + size(JSON.stringify(p)), 0));
    expect(receipt.decodeBufferBytes).toBe(size(pages.map((p) => p.payload).join('')));
    expect(receipt.decodedOwnerBytes).toBe(size(JSON.stringify(decoded)));
    expect(receipt.previousProjectionBytes).toBe(referenceOwners([old]).bytes);
    expect(receipt.cacheBeforeBytes).toBe(before.cacheBytes);
    expect(receipt.cachePeakBytes).toBeGreaterThanOrEqual(stats.cacheBytes);
    expect(stats.maxTableCacheAndDecodeBytes).toBeGreaterThanOrEqual(
      receipt.wireBytes +
        receipt.decodeBufferBytes +
        receipt.decodedOwnerBytes +
        receipt.cachePeakBytes,
    );
    const cloned = cloneTableWindow(owner),
      cloneBytes = size(JSON.stringify(cloned));
    expect(tableCloneWork.maxExpandedPayloadBytes).toBeGreaterThanOrEqual(cloneBytes);
    expect(tableCloneWork.maxOwnerAndClonePayloadBytes).toBeGreaterThanOrEqual(
      2 * cloneBytes + size(JSON.stringify(owner)),
    );
    expect(tableCloneWork.liveScratchBytes).toBe(0);
    session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('body')));
    capture = true;
    session.editor!.commands.insertContent('Q');
    capture = false;
    expect(phases).toHaveLength(2);
    expect(phases[0].annotationInFlightBytes).toBeGreaterThan(0);
    expect(phases[1].annotationInFlightBytes).toBe(0);
    expect(phases[0].source).toEqual(phases[1].source);
    const debug = JSON.stringify(session.snapshot());
    session.recordDebugPublication(size(debug));
    expect(session.snapshot().debugPublicationBytes).toBe(size(debug));
  } finally {
    session.destroy();
  }
});

for (const rollback of [false, true])
  it(`counts rollback-held source owners across native appended edits (rollback=${rollback})`, async () => {
    const source = '| H |\n| --- |\n| body |';
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(source.indexOf('body'));
      session.editor!.commands.setTextSelection(
        session.projection!.pmAt(source.indexOf('body') + 1),
      );
      const old = session.projection!,
        oldDoc = session.editor!.getJSON(),
        oldSelection = structuredClone(session.selection),
        oldRevision = service.revision;
      session.editor!.registerPlugin(
        new Plugin({
          appendTransaction(transactions, _before, state) {
            if (transactions.some((tr) => tr.getMeta('ownerRoot')))
              return state.tr.insertText('R').setMeta('ownerAppend', true);
            return null;
          },
        }),
      );
      const target = session as unknown as { project: (...args: unknown[]) => SourceProjection };
      const original = target.project.bind(session);
      let replacements = 0;
      const references: ReturnType<typeof referenceOwners>[] = [];
      const spy = vi.spyOn(target, 'project').mockImplementation((...args) => {
        const next = original(...args);
        replacements++;
        const reference = referenceOwners([old, session.projection!, next]);
        references.push(reference);
        const stats = session.snapshot();
        expect(stats.tableRollbackOwnerActive).toBe(true);
        expect(stats.maxTableSourceOwnerOverlap).toBe(reference.count);
        expect(stats.maxTableDescriptorOverlapBytes).toBe(reference.descriptors);
        expect(stats.maxTableLivePayloadBytes).toBe(reference.bytes);
        expect(stats.tableReceiveAccounting.previousProjectionBytes).toBe(
          referenceOwners([old, session.projection!]).bytes,
        );
        if (rollback && replacements === 2) throw new Error('appended admission rollback');
        return next;
      });
      session.editor!.view.dispatch(
        session.editor!.state.tr.insertText('Q').setMeta('ownerRoot', true),
      );
      spy.mockRestore();
      expect(replacements).toBe(2);
      expect(references.map((r) => r.count)).toEqual([2, 3]);
      expect(session.snapshot().maxTableSourceOwnerOverlap).toBe(3);
      expect(session.snapshot().maxTableLivePayloadBytes).toBe(
        Math.max(...references.map((r) => r.bytes)),
      );
      if (rollback) {
        expect(session.projection).toBe(old);
        expect(session.editor!.getJSON()).toEqual(oldDoc);
        expect(service.region(0)).toBe(source);
        expect(service.revision).toBe(oldRevision);
        expect(session.selection).toEqual(oldSelection);
      } else {
        expect(session.error).toBe('');
        expect(service.region(0)).toContain('bQRody');
      }
      expect(session.snapshot().tableRollbackOwnerActive).toBe(false);
      expect(session.snapshot().tableLivePayloadBytes).toBe(
        referenceOwners([session.projection!]).bytes,
      );
      expect(session.snapshot().tableLiveOwnerCount).toBe(1);
      expect(session.snapshot().maxTableRollbackFrames).toBe(1);
    } finally {
      session.destroy();
    }
    expect(session.snapshot().tableLiveOwnerCount).toBe(0);
    expect(session.snapshot().tableLivePayloadBytes).toBe(0);
    expect(session.snapshot().tableRollbackOwnerActive).toBe(false);
  });
