import { expect, it } from 'vitest';
import {
  notePagesReducer,
  pagePanelOpened,
  pageStateReceived,
  pageWindowRequested,
  pageWindowSettled,
  pageResourcesRequested,
  pageResourcesReleased,
  pageResourceLimitsConfigured,
} from './note-pages-slice';
import type { NoteWindow } from '$features/notes/virtualized/note-window-reader';
it.each(['error', 'scope', 'revision', 'snapshot', 'equal', 'smaller'])(
  'preserves prefix and settles rejected growth: %s',
  (kind) => {
    const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
    const cost = {
      payloadBytes: 100,
      stringUnits: 100,
      objectNodes: 10,
      domNodes: 0,
      physicalReads: 0,
      assemblies: 0,
    };
    let state = notePagesReducer(
      undefined,
      pageResourceLimitsConfigured({
        ...cost,
        payloadBytes: 1000,
        stringUnits: 1000,
        objectNodes: 100,
      }),
    );
    state = notePagesReducer(state, pagePanelOpened('w', 'n', 'p'));
    state = notePagesReducer(
      state,
      pageResourcesRequested('initial', [{ id: 'initial-data', cost }], 12),
    );
    state = notePagesReducer(
      state,
      pageStateReceived('w', 'n', 0, {
        kind: 'notePageState',
        scope,
        stateGeneration: '1',
        sourceRevision: 'r',
        attributionGeneration: '1',
        attributionState: 'ready',
        commentRevision: '1',
        deleted: false,
        invalidation: 'all',
      }),
    );
    state = notePagesReducer(state, pageWindowRequested('w', 'n', 'p', 0));
    const note = () => state.byWorkspaceId.w.notes.n;
    const prefix: NoteWindow = {
      scope,
      sourceRevision: 'r',
      snapshotId: 's',
      expiresAt: '2099-01-01T00:00:00Z',
      sourceLength: 64,
      range: { start: 0, end: 16 },
      text: 'First prefix....',
      context: [],
      details: {},
      mapBindings: [],
      documentEnd: false,
      cost: {
        requests: 1,
        wireBytes: 100,
        sourceBytes: 16,
        contextBytes: 0,
        assemblyPeakBytes: 100,
      },
    };
    state = notePagesReducer(
      state,
      pageWindowSettled('w', 'n', 'p', note().generation, note().windows.p.request, prefix, null, {
        sponsor: 'initial',
        resource: 'initial-data',
        owner: 'published',
      }),
    );
    state = notePagesReducer(state, pageResourcesReleased('initial'));
    state = notePagesReducer(
      state,
      pageResourcesRequested('candidate', [{ id: 'candidate-data', cost }], 12),
    );
    expect(note().windows.p.resourceOwner).toBe('published');
    const oldOwner = note().windows.p.resourceOwner;
    const ledger = state.resourceLedger;
    const growth = {
      generation: note().generation,
      request: note().windows.p.request,
      snapshotId: 's',
      sourceRevision: 'r',
      start: 0,
      end: 16,
      minimumEnd: 32,
    };
    state = notePagesReducer(
      state,
      Reflect.apply(pageWindowRequested, undefined, ['w', 'n', 'p', 0, growth]),
    );
    state = notePagesReducer(
      state,
      pageWindowSettled(
        'w',
        'n',
        'p',
        note().generation,
        note().windows.p.request,
        kind === 'error'
          ? null
          : {
              ...prefix,
              range: { start: 0, end: kind === 'equal' ? 16 : kind === 'smaller' ? 8 : 32 },
              text:
                kind === 'smaller'
                  ? prefix.text.slice(0, 8)
                  : prefix.text + (kind === 'equal' ? '' : 'Second portion..'),
              scope: kind === 'scope' ? { ...scope, noteInstanceId: 'other' } : scope,
              sourceRevision: kind === 'revision' ? 'other' : 'r',
              snapshotId: kind === 'snapshot' ? 'other' : 's',
            },
        kind === 'error' ? 'bounded growth refused' : null,
        { sponsor: 'candidate', resource: 'candidate-data', owner: 'candidate-window' },
      ),
    );
    expect(note().windows.p.value).toBe(prefix);
    expect(note().windows.p.loading).toBe(false);
    expect(note().windows.p.resourceOwner).toBe(oldOwner);
    expect(state.resourceLedger).toBe(ledger);
    expect(state.resourceLedger.owners['candidate-window']).toBeUndefined();
  },
);
