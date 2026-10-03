import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const mode of ['source-failure', 'history-failure', 'stale', 'oversized'] as const)
  it(`rejects clipped native replacement atomically after ${mode}`, async () => {
    const source =
      'before\n\n| ' +
      '**wide 🌍** '.repeat(800).trim() +
      ' | <!--anchor:keep:point-->KEEP |\n| --- | --- |\n' +
      Array.from({ length: 800 }, (_, i) => `| row${i} | value |\n`).join('') +
      '\nafter';
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div'));
    try {
      await session.seek(source.length - 1);
      const editor = session.editor!,
        original = session.projection!;
      const part = original.mixed!.parts.find((p) => p.projection.table)!;
      editor.view.props.createSelectionBetween!(
        editor.view,
        editor.state.doc.resolve(
          editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1,
        ),
        editor.state.doc.resolve(part.pm + 1),
      );
      await expect.poll(() => session.projection !== original).toBe(true);
      expect(session.error).toBe('');
      const normalized = structuredClone(session.selection);
      expect(normalized.table!.head.offset).toBeGreaterThan(
        editor.state.selection.$head.parent.content.size,
      );
      expect(backing.region(0)).toBe(source);
      expect(backing.depth).toBe(0);
      if (mode === 'source-failure') {
        const stage = backing.stage.bind(backing);
        vi.spyOn(backing, 'stage').mockImplementation((change, history) => {
          stage(change, history);
          throw new Error('injected source failure');
        });
      }
      if (mode === 'history-failure')
        vi.spyOn(backing, 'recordEdit').mockImplementation(() => {
          throw new Error('injected history failure');
        });
      if (mode === 'stale') backing.apply({ from: 0, to: 0, insert: 'REMOTE ' });
      const before = {
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        metadata: backing.stats.backingTableMetadataBytes,
      };
      editor.commands.insertContent(mode === 'oversized' ? 'Z'.repeat(5000) : 'EDIT');
      expect(session.error).toContain(
        mode === 'stale' ? 'Stale' : mode === 'oversized' ? 'budget' : 'injected',
      );
      expect({
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        metadata: backing.stats.backingTableMetadataBytes,
      }).toEqual(before);
      expect(session.selection).toEqual(normalized);
      expect(session.editor).toBe(editor);
      expect(backing.stats.maxBackingTableCommandBytes).toBeGreaterThan(16384);
      expect(backing.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(session.snapshot().mounted).toBe(1);
    } finally {
      vi.restoreAllMocks();
      session.destroy();
    }
  });
