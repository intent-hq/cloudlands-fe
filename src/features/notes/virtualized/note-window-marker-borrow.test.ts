/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoteWindowView } from './note-window-view';
import type { NoteWindow } from './note-window-reader';
import * as markerCapture from './editing/note-marker-capture';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { noteAssemblyResources } from './note-assembly-reservation';

const views: NoteWindowView[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Date, 'now').mockReturnValue(1000);
});
afterEach(async () => {
  for (const view of views.splice(0)) view.destroy();
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
// Controlled admitted window/lease, actual configured native view and projection.
// This is correspondence and lifetime evidence, not comment-origin authority.
function fixture(
  text = 'A <!--anchor:comment-a:point--> B',
  retain?: (window: NoteWindow) => () => void,
) {
  const window: NoteWindow = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    expiresAt: new Date(10000).toISOString(),
    sourceLength: 100 + text.length,
    range: { start: 100, end: 100 + text.length },
    text,
    context: [
      {
        kind: 'boundary',
        id: 'paragraph',
        construct: 'paragraph',
        entryPath: 'markdown',
        sourceRange: { start: 100, end: 100 + text.length },
        continuationBefore: false,
        continuationAfter: false,
      },
    ],
    details: {},
    mapBindings: [],
    documentEnd: true,
    cost: {
      requests: 2,
      wireBytes: text.length + 200,
      sourceBytes: new TextEncoder().encode(text).length,
      contextBytes: 200,
      assemblyPeakBytes: 2 * text.length + 200,
    },
  };
  const drop = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    retainWindow: (window) => {
      const release = retain?.(window);
      return () => {
        release?.();
        drop();
      };
    },
  });
  views.push(view);
  expect(view.show(window)).toBe(true);
  const position = view.projection!.tokens.find((t) => t.raw.startsWith('<!--anchor:'))!.pm;
  const identity = {
    scope: window.scope,
    sourceRevision: window.sourceRevision,
    snapshotId: window.snapshotId,
    expiresAt: window.expiresAt!,
    documentGeneration: 0,
    liveGeneration: view.selectionCaptureGeneration,
    selectionGeneration: 0,
  };
  return { view, window, position, identity, drop };
}
it('borrows an actual read-only atom without creating edit or canonical authority', () => {
  const f = fixture();
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => true);
  expect(f.view.editor!.isEditable).toBe(false);
  expect(lease.capture).toMatchObject({
    canonicalId: 'comment-a',
    literal: '<!--anchor:comment-a:point-->',
    provenance: 'native-correspondence-only',
  });
  expect(lease.current()).toBe(true);
  lease.release();
  lease.release();
  expect(lease.current()).toBe(false);
});
it('retains the original window debt after native retirement until borrower settlement', async () => {
  const f = fixture();
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => true);
  const lost = vi.fn();
  lease.subscribe(lost);
  f.view.destroy();
  await Promise.resolve();
  expect(lease.current()).toBe(false);
  expect(lost).toHaveBeenCalledOnce();
  expect(f.drop).not.toHaveBeenCalled();
  lease.release();
  await vi.waitFor(() => expect(f.drop).toHaveBeenCalledOnce());
});
it('permanently revokes external owner loss even after restoration', () => {
  const f = fixture();
  let owned = true;
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => owned);
  owned = false;
  expect(lease.current()).toBe(false);
  owned = true;
  expect(lease.current()).toBe(false);
  lease.release();
});
it('refuses a clipped lexical paragraph despite a complete-looking native wrapper', () => {
  const f = fixture();
  f.window.context[0].sourceRange.start--;
  expect(() => f.view.borrowMarkerOccurrence(f.identity, f.position, () => true)).toThrow();
});
it('pins original boundary values across in-place mutation and restoration', () => {
  const f = fixture();
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => true);
  f.window.context[0].sourceRange.end++;
  expect(lease.current()).toBe(false);
  f.window.context[0].sourceRange.end--;
  expect(lease.current()).toBe(false);
  lease.release();
});
it('refuses mapping mutation during the post-capture owner callback', () => {
  const f = fixture();
  let captured = false,
    mutated = false;
  const actual = markerCapture.captureNoteMarker;
  vi.spyOn(markerCapture, 'captureNoteMarker').mockImplementation((...args) => {
    const result = actual(...args);
    captured = true;
    return result;
  });
  expect(() =>
    f.view.borrowMarkerOccurrence(f.identity, f.position, () => {
      if (captured) {
        mutated = true;
        f.view.projection!.positions.set(f.position, 101);
      }
      return true;
    }),
  ).toThrow();
  expect(mutated).toBe(true);
});
it('rechecks later correspondence and permanently rejects a restored token map', () => {
  const f = fixture();
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => true);
  const map = f.view.projection!.positions,
    prior = map.get(f.position)!;
  map.set(f.position, prior + 1);
  expect(lease.current()).toBe(false);
  map.set(f.position, prior);
  expect(lease.current()).toBe(false);
  lease.release();
});
it('binds original expiry and rejects expiry without releasing outstanding debt early', () => {
  const f = fixture();
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () => true);
  vi.mocked(Date.now).mockReturnValue(10000);
  expect(lease.current()).toBe(false);
  expect(f.drop).not.toHaveBeenCalled();
  vi.mocked(Date.now).mockReturnValue(1000);
  expect(lease.current()).toBe(false);
  lease.release();
});

it('holds actual Redux window and capture DATA through unmount until pending work settles', async () => {
  let state = a.initialNotePagesState;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 100000,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  const f = fixture(undefined, (window) => {
    dispatch(a.pagePanelOpened('w', 'n', 'p'));
    dispatch(
      a.pageStateReceived('w', 'n', 0, {
        kind: 'notePageState',
        scope: window.scope,
        sourceRevision: 'r',
        stateGeneration: '1',
        attributionGeneration: 'a',
        attributionState: 'ready',
        commentRevision: 'c',
        deleted: false,
        invalidation: 'all',
      }),
    );
    dispatch(a.pageWindowRequested('w', 'n', 'p', 100));
    const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
    dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
    dispatch(
      a.pageWindowSettled('w', 'n', 'p', 0, 1, window, null, {
        sponsor: seed.owner,
        resource: seed.data,
        owner: 'window-seed',
      }),
    );
    dispatch(a.pageResourcesReleased(seed.owner));
    dispatch(a.pageWindowRetained('w', 'n', 'p', 0, window, 'marker-native'));
    expect(Object.hasOwn(state.resourceLedger.owners, 'marker-native')).toBe(true);
    return () => dispatch(a.pageResourcesReleased('marker-native'));
  });
  // Test consumer admits its bounded proof/retained result and pending work;
  // these logical units are not a JavaScript heap measurement.
  dispatch(
    a.pageResourcesRequested(
      'marker-operation',
      [
        {
          id: 'marker-proof',
          cost: {
            payloadBytes: 4 * 32768,
            stringUnits: 4 * 32768,
            objectNodes: 4 * 32768,
            domNodes: 0,
            physicalReads: 1,
            assemblies: 1,
          },
        },
      ],
      1,
    ),
  );
  const lease = f.view.borrowMarkerOccurrence(f.identity, f.position, () =>
    Object.hasOwn(state.resourceLedger.owners, 'marker-operation'),
  );
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const work = pending.finally(() => {
    lease.release();
    dispatch(a.pageResourcesReleased('marker-operation'));
  });
  try {
    f.view.destroy();
    dispatch(workspaceUnmounted('w'));
    await Promise.resolve();
    expect(lease.current()).toBe(false);
    expect(Object.hasOwn(state.resourceLedger.owners, 'marker-native')).toBe(true);
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    expect(state.resourceLedger.used.objectNodes).toBeGreaterThan(4 * 32768);
    settle();
    await work;
    await vi.waitFor(() =>
      expect(state.resourceLedger.used).toEqual({
        payloadBytes: 0,
        stringUnits: 0,
        objectNodes: 0,
        domNodes: 0,
        physicalReads: 0,
        assemblies: 0,
      }),
    );
  } finally {
    settle();
    await work;
  }
});
