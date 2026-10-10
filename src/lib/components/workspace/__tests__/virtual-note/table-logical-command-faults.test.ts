import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source =
  'untouched **prefix**\n\n| H | R |\n| :--- | ---: |\n' +
  Array.from({ length: 80 }, (_, i) => `| left${i} | right${i} |`).join('\n') +
  '\n\nuntouched _suffix_';
async function start() {
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  await session.seek(source.indexOf('right30'));
  session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('right30')));
  return { service, session };
}
for (const fault of ['stage', 'record'] as const) {
  it(`rolls back a logical table command after ${fault} fails`, async () => {
    const { service, session } = await start();
    try {
      const before = {
        doc: session.editor!.getJSON(),
        selection: structuredClone(session.selection),
        nativeSelection: session.editor!.state.selection.toJSON(),
        revision: service.revision,
        depth: service.depth,
      };
      const original = service[fault].bind(service);
      const spy = vi.spyOn(service, fault).mockImplementationOnce((...args: never[]) => {
        Reflect.apply(original, service, args);
        throw new Error(`injected logical ${fault} failure`);
      });
      session.editor!.commands.addColumnAfter();
      spy.mockRestore();
      expect(session.error).toContain(`injected logical ${fault} failure`);
      expect(service.region(0)).toBe(source);
      expect(service.revision).toBe(before.revision);
      expect(service.depth).toBe(before.depth);
      expect(service.stats.backingTableMetadataBytes).toBe(0);
      expect(session.selection).toEqual(before.selection);
      expect(session.editor!.state.selection.toJSON()).toEqual(before.nativeSelection);
      expect(session.editor!.getJSON()).toEqual(before.doc);
    } finally {
      session.destroy();
    }
  });
}
it('rejects stale logical table intents without changing accepted source, selection, or history', async () => {
  const { service, session } = await start();
  try {
    const selection = structuredClone(session.selection);
    const intent = {
      revision: service.revision,
      table: session.projection!.table!.window.from,
      command: 'toggleHeaderColumn' as const,
      selection,
    };
    session.remote({ from: 0, to: 0, insert: 'Remote\n\n' });
    const accepted = service.region(0),
      after = structuredClone(session.selection),
      depth = service.depth;
    expect(() => service.stageLogicalTableCommand(intent, session.editor!)).toThrow(
      /Stale logical table command/,
    );
    expect(service.region(0)).toBe(accepted);
    expect(session.selection).toEqual(after);
    expect(service.depth).toBe(depth);
  } finally {
    session.destroy();
  }
});
it('invalidates an older window after a logical command and retains chronological destroyed-view history', async () => {
  const { service, session } = await start();
  try {
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = session.seek(source.indexOf('left60'));
    session.editor!.commands.addColumnAfter();
    const accepted = service.region(0),
      selection = structuredClone(session.selection);
    session.delayFetch = undefined;
    release();
    expect(await pending).toBe(false);
    await session.seek(selection.head);
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(accepted);
    expect(session.selection).toEqual(selection);
    expect(accepted.startsWith('untouched **prefix**\n\n')).toBe(true);
    expect(accepted.endsWith('\n\nuntouched _suffix_')).toBe(true);
    const old = session.editor!;
    await session.seek(0);
    expect(old.isDestroyed).toBe(true);
    await session.history();
    expect(service.region(0)).toBe(source);
    await session.history(true);
    expect(service.region(0)).toBe(accepted);
    expect(service.revision).toBeGreaterThan(selection.revision);
    expect(session.selection).toEqual({ ...selection, revision: service.revision });
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
  }
});
