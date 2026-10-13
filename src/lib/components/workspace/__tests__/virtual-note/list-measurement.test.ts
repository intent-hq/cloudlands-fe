import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Mapping } from '@tiptap/pm/transform';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import type { ListProjection } from './list-projection';

beforeAll(() => store.init());
afterAll(() => store.dispose());

// Independent reference: the original complete payload and native UTF-8 encoding.
function reference(list?: ListProjection) {
  return new TextEncoder().encode(
    JSON.stringify({
      positions: [...(list?.positions ?? [])],
      ends: [...(list?.ends ?? [])],
      boundaries: [...(list?.boundaries ?? [])],
      tokens: list?.tokens,
      indentation: list?.indentation,
      nestedCode: list?.codeParts,
      nestedCodeAdmission: list?.codes,
      parts: [
        ...(list?.entries.map((e) => e.part) ?? []),
        ...(list?.prose.map((e) => e.part) ?? []),
      ].map((part) => ({
        source: part?.source,
        content: part?.content,
        positions: [...(part?.positions ?? [])],
        ends: [...(part?.ends ?? [])],
        boundaries: [...(part?.boundaries ?? [])],
        tokens: part?.tokens,
        marks: part?.marks,
      })),
    }),
  ).length;
}

function check(session: DocumentSession) {
  const stats = session.snapshot();
  const list = session.projection?.list;
  const encoded = (text: string) => new TextEncoder().encode(text).length;
  expect(stats.listProjectionPayloadBytes).toBe(reference(list));
  expect(stats.listMeasurementScalars).toBe(session.projection?.list ? 1 : 0);
  expect(stats.listMeasurementPayloadBytes).toBe(
    list
      ? encoded(
          JSON.stringify(
            reference(list) +
              4 -
              encoded(JSON.stringify(list.indentation)) -
              encoded(JSON.stringify(list.codes)),
          ),
        )
      : 0,
  );
  expect(stats.listMeasurementPayloadBytes).toBeLessThanOrEqual(16);
  // Reference the prior independently evaluated expressions for snapshot-local reuse.
  const projection = session.projection;
  const cache = (session as unknown as { cache: Map<string, string> }).cache;
  expect(stats.activeBytes).toBe(encoded(projection?.source ?? ''));
  expect(stats.inlineContextBytes).toBe(encoded(JSON.stringify(projection?.context ?? {})));
  expect(stats.codeMetadataBytes).toBe(encoded(JSON.stringify(projection?.code ?? [])));
  expect(stats.projectionJsonBytes).toBe(encoded(JSON.stringify(projection?.content ?? {})));
  expect(stats.pmBytes).toBe(encoded(JSON.stringify(session.editor?.getJSON() ?? {})));
  expect(stats.editorContentOptionBytes).toBe(
    encoded(JSON.stringify(session.editor?.options.content ?? {})),
  );
  expect(stats.cacheBytes).toBe([...cache.values()].reduce((n, page) => n + encoded(page), 0));
  expect(stats.sourceReplicaPayloadBytes).toBe(
    encoded(projection?.source ?? '') +
      (list?.entries.reduce((n, e) => n + encoded(e.part?.source ?? ''), 0) ?? 0) +
      (list?.prose.reduce((n, e) => n + encoded(e.part.source), 0) ?? 0) +
      encoded(JSON.stringify(projection?.context ?? {})) +
      encoded(JSON.stringify(projection?.code ?? [])) +
      [...cache.values()].reduce((n, page) => n + encoded(page), 0) +
      stats.inFlightBytes +
      (projection?.tokens.reduce((n, t) => n + encoded(t.raw) + encoded(t.text), 0) ?? 0) +
      encoded(JSON.stringify(projection?.content ?? {})) +
      encoded(JSON.stringify(session.editor?.getJSON() ?? {})) +
      encoded(JSON.stringify(session.editor?.options.content ?? {})),
  );
  return stats;
}

for (const source of [
  'plain café 🌍 "quote" \\ slash \u0001 \ud800',
  'prose café\n\n- "quote" \\ slash \u0001 \ud800 🌍\n  - child\n- after',
  '- parent\n  17. middle\n      - ' + 'café 🌍 repeated '.repeat(1500),
]) {
  it(`counts exact list payload without retaining encoded data: ${source.slice(0, 20)}`, async () => {
    const session = new DocumentSession(
      new SourceJournal(() => source, 1),
      document.createElement('div'),
    );
    try {
      await session.seek(source.length > 4096 ? 12000 : 1);
      const list = session.projection?.list;
      const serialized = JSON.stringify(list);
      const first = check(session);
      for (let i = 0; i < 3; i++)
        expect(check(session).listProjectionPayloadBytes).toBe(first.listProjectionPayloadBytes);
      expect(JSON.stringify(list)).toBe(serialized);
      if (list) {
        expect(list.measurementScalars).toBe(1);
        // These are mutation outputs even when the projection itself is unchanged.
        list.indentation.push({ from: 1, after: 27, delta: -2 });
        list.codes.push({ item: 0, from: 2, bodyFrom: 3, bodyTo: 9, to: 10, language: '"🌍' });
        check(session);
      }
      session.destroy();
      expect(list?.measurementScalars ?? 0).toBe(0);
      expect(check(session).listMeasurementPayloadBytes).toBe(0);
    } finally {
      session.destroy();
    }
  });
}

it('reuses only the scalar subtotal and invalidates before a rejected translation', async () => {
  const session = new DocumentSession(
    new SourceJournal(() => '- alpha\n- beta', 1),
    document.createElement('div'),
  );
  try {
    await session.seek(3);
    const list = session.projection!.list!;
    list.clearMeasurement();
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      session.snapshot();
      session.snapshot();
      const builds = () =>
        stringify.mock.calls.filter(
          ([v]) => v && typeof v === 'object' && 'nestedCodeAdmission' in v,
        ).length;
      expect(builds()).toBe(1);
      const schema = session.editor!.schema;
      const invalid = schema.node('doc', null, [
        schema.node('bulletList', null, [
          schema.node('listItem', null, [
            schema.node('paragraph', null, [schema.text('bad', [schema.marks.italic.create()])]),
          ]),
        ]),
      ]);
      expect(() => list.translateDocument(invalid, new Mapping())).toThrow();
      expect(list.measurementScalars).toBe(0);
      session.snapshot();
      expect(builds()).toBe(2);
    } finally {
      stringify.mockRestore();
    }
    check(session);
  } finally {
    session.destroy();
  }
});

it('preserves both publication phases and releases superseded, evicted and rollback measurements', async () => {
  const source = '- outer\n  - ' + 'repeated café '.repeat(1500) + '\n- after';
  const service = new SourceJournal(() => source, 1);
  const phases: Array<ReturnType<DocumentSession['snapshot']>> = [];
  let capture = false;
  const session = new DocumentSession(service, document.createElement('div'), () => {
    if (capture) phases.push(check(session));
  });
  try {
    await session.seek(8000);
    session.editor!.commands.setTextSelection(session.projection!.pmAt(8000));
    check(session);
    const old = session.projection!.list!;
    capture = true;
    session.editor!.view.dispatch(session.editor!.state.tr.insertText('Z'));
    capture = false;
    expect(session.error).toBe('');
    expect(phases).toHaveLength(2);
    expect(phases[0].annotationInFlightBytes).toBeGreaterThan(0);
    expect(phases[1].annotationInFlightBytes).toBe(0);
    expect(phases[0].listProjectionPayloadBytes).toBe(phases[1].listProjectionPayloadBytes);
    expect(old.measurementScalars).toBe(0);
    session.save();
    const edited = service.region(0),
      editor = session.editor!,
      replaced = session.projection!.list!;
    await session.seek(0);
    expect(editor.isDestroyed).toBe(true);
    expect(replaced.measurementScalars).toBe(0);
    check(session);
    await session.history();
    expect(service.region(0)).toBe(source);
    check(session);
    await session.history(true);
    expect(service.region(0)).toBe(edited);
    check(session);
    const before = session.projection!,
      sourceBefore = service.region(0);
    const failure = vi.spyOn(service, 'recordEdit').mockImplementation(() => {
      throw new Error('measurement rollback');
    });
    try {
      session.editor!.view.dispatch(session.editor!.state.tr.insertText('FAIL'));
    } finally {
      failure.mockRestore();
    }
    expect(session.error).toContain('measurement rollback');
    expect(session.projection).toBe(before);
    expect(service.region(0)).toBe(sourceBefore);
    check(session);
    let release!: () => void;
    session.delayAnnotationResponse = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const heldProjection = session.projection!.list!;
    const held = session.loadAnnotations();
    session.delayAnnotationResponse = undefined;
    const seek = session.seek(15000);
    release();
    expect(await held).toBe(false);
    await seek;
    expect(heldProjection.measurementScalars).toBe(0);
    check(session);
    session.remote({ from: 0, to: 0, insert: '\n' });
    await session.seek(15000);
    check(session);
  } finally {
    session.destroy();
  }
});
