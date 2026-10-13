import { expect, it } from 'vitest';
import { DocumentSession } from './document-session';
import { SourceJournal, fixture } from './source-journal';

for (const repeats of [2048, 32768])
  it(`opens one ${repeats}-repeat Unicode paragraph without whole-paragraph hydration`, async () => {
    const source = 'repeated café 🌍 text repeated. '.repeat(repeats);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      expect(await session.show(0)).toBe(true);
      const stats = session.snapshot();
      expect(stats.activeBytes).toBeLessThanOrEqual(16384);
      expect(stats.maxParsedBytes).toBeLessThanOrEqual(16384);
      expect(service.maxRead).toBeLessThanOrEqual(4096);
      expect(stats.reads).toBeLessThanOrEqual(5);
      expect(stats.mounted).toBe(1);
      expect(session.editor!.state.doc.childCount).toBe(1);
      session.editor!.commands.insertContent('NEW');
      expect(service.region(0)).toBe('NEW' + source);
      expect(session.error).toBe('');
    } finally {
      session.destroy();
    }
  });

it('seek hydration and retained provenance stay fixed as one paragraph grows sixteenfold', async () => {
  const measurements = [];
  for (const repeats of [2048, 32768]) {
    const source = 'repeated café 🌍 text repeated. '.repeat(repeats);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.show(0);
      const initial = session.snapshot();
      const destination = source.length - 8192;
      await session.seek(destination);
      const seek = session.snapshot();
      expect(session.projection!.source).toBe(source.slice(destination - 2048, destination + 2048));
      expect(seek.reads - initial.reads).toBe(4);
      expect(seek.contextReads - initial.contextReads).toBeLessThanOrEqual(6);
      expect(seek.maxContextPayloadBytes).toBeLessThanOrEqual(5);
      expect(seek.sourceReplicaPayloadBytes).toBeLessThan(65536);
      expect(seek.activeBytes).toBe(initial.activeBytes);
      expect(seek.provenanceEntries).toBe(initial.provenanceEntries);
      expect(seek.continuationMetadataBytes).toBeLessThan(128);
      expect(
        seek.tokenProvenancePayloadBytes +
          seek.provenancePayloadBytes +
          seek.markProvenancePayloadBytes,
      ).toBeLessThan(1024 * 1024);
      expect(seek.cachePages).toBeLessThanOrEqual(4);
      expect(seek.cacheBytes).toBeLessThanOrEqual(16384);
      expect(seek.maxParsedBytes).toBeLessThanOrEqual(16384);
      expect(seek.retainedEditorStates).toBe(0);
      expect(seek.pendingWindowRequests).toBe(0);
      expect(seek.created).toBe(2);
      expect(seek.destroyed).toBe(1);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(destination));
      session.editor!.commands.insertContent('X');
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(
        source.slice(0, destination) + 'X' + source.slice(destination),
      );
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection).toMatchObject({ anchor: destination, head: destination });
      await session.history(true);
      expect(session.selection).toMatchObject({ anchor: destination + 1, head: destination + 1 });
      measurements.push({ initial, seek });
    } finally {
      session.destroy();
    }
  }
  expect(measurements[0].initial.activeBytes).toBe(measurements[1].initial.activeBytes);
  expect(measurements[0].seek.activeBytes).toBe(measurements[1].seek.activeBytes);
  expect(measurements[0].seek.provenanceEntries).toBe(measurements[1].seek.provenanceEntries);
});

it('bounds UTF-8 reads and never splits a surrogate at arbitrary continuation positions', async () => {
  const source = '🌍'.repeat(40000);
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(20001);
    const p = session.projection!;
    expect(p.start % 2).toBe(0);
    expect(p.source.length % 2).toBe(0);
    expect(p.source).toBe(source.slice(p.start, p.start + p.source.length));
    expect(service.maxRead).toBeLessThanOrEqual(4096);
    expect(session.snapshot().activeBytes).toBeLessThanOrEqual(16384);
  } finally {
    session.destroy();
  }
});

it('late seek cannot overwrite a newer native selection or accepted input', async () => {
  const source = 'repeated café 🌍 text repeated. '.repeat(2048);
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.show(0);
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = session.seek(50000);
    session.editor!.commands.setTextSelection({ from: 21, to: 11 });
    const selected = { ...session.selection };
    release();
    expect(await pending).toBe(false);
    expect(session.selection).toEqual(selected);
    expect(session.created).toBe(1);
    const another = session.seek(50000);
    session.editor!.commands.insertContent('NEW');
    const edited = service.region(0);
    release();
    expect(await another).toBe(false);
    expect(service.region(0)).toBe(edited);
    expect(service.depth).toBe(1);
    session.delayFetch = undefined;
    await session.history();
    expect(service.region(0)).toBe(source);
    expect(session.selection).toMatchObject({ anchor: selected.anchor, head: selected.head });
  } finally {
    session.destroy();
  }
});

it('retains the complete fitting paragraph window through 5000-byte paste undo and redo', async () => {
  const service = new SourceJournal(fixture, 2);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.show(0);
    session.editor!.commands.insertContent('x'.repeat(5000));
    const edited = session.editor!.getJSON();
    await session.history();
    await session.history(true);
    expect(session.editor!.getJSON()).toEqual(edited);
    expect(session.projection!.source).toBe('x'.repeat(5000) + fixture(0) + fixture(1));
    expect(session.snapshot().activeBytes).toBeLessThanOrEqual(16384);
  } finally {
    session.destroy();
  }
});

it('pages a pending Unicode input backlog outside the renderer and drains it in order', () => {
  const service = new SourceJournal(() => 'plain paragraph', 1);
  const text = 'ab🌍'.repeat(5000);
  service.enqueueInput({
    command: 'insertText',
    time: 1234,
    text,
    selection: { anchor: 3, head: 3, affinity: 1, revision: 1 },
  });
  expect(service.pendingInputs).toBeGreaterThan(4);
  expect(service.stats.backingInputBytes).toBeGreaterThan(16384);
  let replayed = '',
    count = 0;
  while (service.pendingInputs) {
    const input = service.readInput();
    expect(input.time).toBe(1234);
    expect(input.selection !== undefined).toBe(count === 0);
    expect(input.text!.endsWith('\ud83c')).toBe(false);
    replayed += input.text;
    count++;
    service.acknowledgeInput();
  }
  expect(replayed).toBe(text);
  expect(service.stats.maxInputRead).toBeLessThanOrEqual(4096);
  expect(service.stats.backingInputBytes).toBe(0);
});

it('rebases pending input bookmarks atomically without losing the unacknowledged operation', () => {
  const service = new SourceJournal(() => 'plain paragraph', 1);
  service.enqueueInput({
    command: 'delete',
    time: 1234,
    selection: { anchor: 7, head: 7, affinity: 1, revision: 1 },
  });
  const input = service.readInput();
  expect(() =>
    service.atomic(() => {
      service.apply({ from: 0, to: 0, insert: 'new ' });
      throw new Error('admission failed');
    }),
  ).toThrow('admission failed');
  expect(service.readInput()).toEqual(input);
  expect(service.pendingInputs).toBe(1);
  service.apply({ from: 0, to: 0, insert: 'new ' });
  expect(service.readInput().selection).toMatchObject({ anchor: 11, head: 11, revision: 2 });
});

it('admits Enter before the native keymap while an edge deletion is awaiting context', async () => {
  const service = new SourceJournal(() => 'repeated café 🌍 text repeated. '.repeat(2048), 1);
  const session = new DocumentSession(service, document.createElement('div'));
  let release = () => {};
  try {
    await session.show(0);
    session.delayFetch = () => new Promise<void>((resolve) => (release = resolve));
    session.editor!.commands.setTextSelection(session.projection!.pmAt(4096));
    await Promise.resolve();
    const view = session.editor!.view;
    const key = (key: string) =>
      view.someProp('handleKeyDown', (handler) =>
        handler(view, new KeyboardEvent('keydown', { key, cancelable: true })),
      );
    expect(key('Delete')).toBe(true);
    expect(key('Enter')).toBe(true);
    expect(service.pendingInputs).toBe(2);
    expect(session.error).toBe('');
    expect(service.depth).toBe(0);
  } finally {
    session.destroy();
    session.delayFetch = undefined;
    release();
  }
});
