import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal, LIMITS } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

function fixture() {
  const service = new SourceJournal(() => 'repeated café 🌍 text. '.repeat(300), 1);
  service.anchors = Array.from({ length: 40 }, (_, i) => ({
    id: `cmt-${i}`,
    from: 1,
    to: 5000,
    alive: true,
  }));
  // Model the adapter's permitted surface: the backing collection is not a read
  // method. Service internals remain bound to backing, never to this facade.
  const adapter = new Proxy(service, {
    get(target, key) {
      if (key === 'anchors') throw new Error('Whole annotation map read');
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { service, session: new DocumentSession(adapter, document.createElement('div')) };
}

it('edits, snapshots, evicts and replays history with only bounded annotation reads', async () => {
  const { service, session } = fixture();
  const source = service.region(0);
  try {
    await session.seek(2000);
    const selected = session.projection!.pmAt(2000);
    session.editor!.commands.setTextSelection(selected);
    session.editor!.commands.insertContent('X');
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(source.slice(0, 2000) + 'X' + source.slice(2000));
    const old = session.editor!;
    await session.seek(6000);
    expect(old.isDestroyed).toBe(true);
    await session.history();
    expect(service.region(0)).toBe(source);
    await session.history(true);
    expect(service.region(0)).toBe(source.slice(0, 2000) + 'X' + source.slice(2000));
    const stats = session.snapshot();
    expect(stats.maxAnnotationPageBytes).toBeLessThanOrEqual(LIMITS.request);
    expect(stats.cachePages).toBeLessThanOrEqual(4);
    expect(stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(stats.retainedEditorStates).toBe(0);
  } finally {
    session.destroy();
  }
});

it('makes later overlaps discoverable with one visible page and the shared four-page cache', async () => {
  const { session } = fixture();
  try {
    await session.seek(3000);
    const ids = [];
    do {
      ids.push(...session.annotationPage!.items.map((a) => a.id));
      const next = session.annotationPage!.next;
      if (!next) break;
      expect(await session.loadAnnotations(next)).toBe(true);
    } while (true);
    expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => `cmt-${i}`));
    expect(session.annotationPage!.items.length).toBe(8);
    expect(session.editor!.view.dom.querySelectorAll('[data-proof-comment]').length).toBe(8);
    expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
    expect(session.snapshot().cacheBytes).toBeLessThanOrEqual(16384);
  } finally {
    session.destroy();
  }
});

for (const epoch of ['revision', 'generation', 'commentRevision'] as const) {
  it(`rejects an older annotation response after independent ${epoch} changes`, async () => {
    const { service, session } = fixture();
    try {
      await session.seek(3000);
      let release!: () => void;
      session.delayAnnotationResponse = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      const old = session.loadAnnotations();
      session.delayAnnotationResponse = undefined;
      if (epoch === 'revision') session.remote({ from: 0, to: 0, insert: 'remote ' });
      else service[epoch]++;
      const newer = session.loadAnnotations();
      release();
      expect(await old).toBe(false);
      expect(await newer).toBe(true);
      const accepted = structuredClone(session.annotationPage);
      expect(session.annotationPage).toEqual(accepted);
      expect(session.annotationPage![epoch]).toBe(service[epoch]);
    } finally {
      session.destroy();
    }
  });
}

it('coalesces delayed annotation bursts with one response in flight', async () => {
  const { session, service } = fixture();
  try {
    await session.seek(3000);
    let release!: () => void;
    session.delayAnnotationResponse = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const before = service.annotationReads;
    const pending = Array.from({ length: 25 }, () => session.loadAnnotations());
    expect(service.annotationReads - before).toBe(1);
    expect(session.annotationInFlightBytes).toBeLessThanOrEqual(4096);
    session.delayAnnotationResponse = undefined;
    release();
    const outcomes = await Promise.all(pending);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(service.annotationReads - before).toBe(2);
    expect(session.annotationInFlightBytes).toBe(0);
    expect(session.maxAnnotationInFlightBytes).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
  }
});
