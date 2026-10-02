import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { SourceProjection } from './source-projection';

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
