import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

it('retains native adjacent list groups and moved escaped text through eviction and undo', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const source = '- before\n- i\\.tem\n- after';
  const service = new SourceJournal(() => source, 1);
  const p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(11);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(11));
    p.editor!.commands.keyboardShortcut('Backspace');
    now.mockReturnValue(2000);
    // Exact native Chromium cut/insert/join sequence; jsdom has no layout for joinForward.
    const r = p.editor!.state.selection.$head,
      at = r.before() - 2;
    const tr = p.editor!.state.tr.delete(r.before(), r.after()).insert(at, r.parent).join(at);
    p.editor!.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at - 1)));
    expect(p.error).toBe('');
    expect(p.rejectedTransactions).toBe(0);
    expect(service.region(0)).toBe('- beforei\\.tem\n\n- after');
    expect(p.editor!.getJSON().content!.filter((n) => n.type === 'bulletList')).toHaveLength(2);
    p.save();
    const old = p.editor!;
    p.destroy();
    expect(old.isDestroyed).toBe(true);
    const next = new DocumentSession(service, document.createElement('div'));
    try {
      await next.seek(8);
      expect(next.editor!.getJSON().content!.filter((n) => n.type === 'bulletList')).toHaveLength(
        2,
      );
      await next.history();
      expect(service.region(0)).toBe('- before\n\ni\\.tem\n\n- after');
      await next.history(true);
      expect(service.region(0)).toBe('- beforei\\.tem\n\n- after');
      expect(next.editor!.getJSON().content!.filter((n) => n.type === 'bulletList')).toHaveLength(
        2,
      );
    } finally {
      next.destroy();
    }
    const fresh = new DocumentSession(
      new SourceJournal(() => service.region(0), 1),
      document.createElement('div'),
    );
    try {
      await fresh.seek(8);
      expect(fresh.editor!.getJSON().content!.filter((n) => n.type === 'bulletList')).toHaveLength(
        1,
      );
    } finally {
      fresh.destroy();
    }
  } finally {
    p.destroy();
    now.mockRestore();
  }
});

it('a metadata-only revision rejects delayed navigation without losing a local draft or history', async () => {
  const source = '- before\n\n- after',
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(4);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(4));
    p.editor!.commands.insertContent('X');
    const draft = service.region(0),
      depth = service.depth,
      from = draft.indexOf('- after');
    let release!: () => void;
    p.delayFetch = () => new Promise<void>((resolve) => (release = resolve));
    const pending = p.seek(from);
    service.setSeams(
      0,
      service.length,
      [{ from, kind: 'bulletList', start: 1 }],
      service.revision,
      false,
    );
    release();
    expect(await pending).toBe(false);
    expect(service.region(0)).toBe(draft);
    expect(service.depth).toBe(depth);
    p.delayFetch = undefined;
    await p.seek(from);
    expect(p.editor!.getJSON().content!.filter((n) => n.type === 'bulletList')).toHaveLength(2);
    await p.history();
    expect(service.region(0)).toBe(source);
    expect(service.stats.backingSeamCount).toBe(1);
  } finally {
    p.destroy();
  }
});

it('retains the native ordered start after a lift without rewriting untouched marker spelling', async () => {
  const source = '17. **before**\n18. i\\.tem\n19. after',
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(source.indexOf('i\\.tem'));
    p.editor!.commands.setTextSelection(p.projection!.pmAt(source.indexOf('i\\.tem')));
    p.editor!.commands.keyboardShortcut('Backspace');
    expect(p.error).toBe('');
    expect(service.region(0)).toBe('17. **before**\n\ni\\.tem\n\n19. after');
    expect(p.editor!.state.doc.child(2).attrs.start).toBe(17);
    p.save();
    p.destroy();
    const next = new DocumentSession(service, document.createElement('div'));
    try {
      await next.seek(service.length);
      expect(next.editor!.state.doc.child(2).attrs.start).toBe(17);
    } finally {
      next.destroy();
    }
  } finally {
    p.destroy();
  }
});
