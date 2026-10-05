import { expect, it } from 'vitest';
import {
  notePagesReducer,
  pagePanelOpened,
  pagePanelClosed,
  pageStateReceived,
  sourcePageReceived,
  pageRequestStarted,
  pageDraftChanged,
  pageSaveStarted,
  pageSaveSettled,
  pageSavePreparationFailed,
  pageDraftsUnchanged,
} from './note-pages-slice';
const scope = { backendId: 'db-a', workspaceId: 'ws-a', noteId: 'spec', noteInstanceId: 'inc-a' };
const tuple = {
  kind: 'notePageState' as const,
  scope,
  stateGeneration: '10',
  sourceRevision: 'r:7',
  attributionGeneration: 'a:2',
  attributionState: 'ready' as const,
  commentRevision: 'c:4',
  deleted: false,
  invalidation: 'all' as const,
};
const source = {
  kind: 'noteSourcePage' as const,
  scope,
  sourceRevision: 'r:7',
  snapshotId: 'snap',
  expiresAt: '2099-01-01T00:00:00.000Z',
  sourceLength: 20,
  range: { start: 0, end: 3 },
  text: 'A😀',
  nextCursor: 'next',
  previousCursor: null,
  contextRef: 'ctx',
  metadataRef: 'meta',
};
it('ignores stale save preparation and local cancellation results', () => {
  let state = opened();
  const generation = state.byWorkspaceId['ws-a'].notes.spec.generation;
  state = notePagesReducer(
    state,
    pageDraftChanged('ws-a', 'spec', {
      scope,
      sequence: 1,
      baseRevision: 'r:7',
      splices: [{ start: 0, end: 0, text: 'x' }],
      selection: { anchor: 1, head: 1, anchorAffinity: 'after', headAffinity: 'after' },
    }),
  );
  const current = state;
  state = notePagesReducer(
    state,
    pageSavePreparationFailed('ws-a', 'spec', generation + 1, 'late'),
  );
  state = notePagesReducer(state, pageDraftsUnchanged('ws-a', 'spec', generation + 1, 'r:7', 1));
  state = notePagesReducer(state, pageDraftsUnchanged('ws-a', 'spec', generation, 'other', 1));
  expect(state).toEqual(current);
  state = notePagesReducer(
    state,
    pageSavePreparationFailed('ws-a', 'spec', generation, 'staged save needed'),
  );
  expect(state.byWorkspaceId['ws-a'].notes.spec.error).toBe('staged save needed');
  expect(state.byWorkspaceId['ws-a'].notes.spec.drafts).toHaveLength(1);
  expect(state.byWorkspaceId['ws-a'].notes.spec.status).toBe('ready');
});
function opened() {
  let s = notePagesReducer(undefined, pagePanelOpened('ws-a', 'spec', 'panel-a'));
  s = notePagesReducer(s, pageStateReceived('ws-a', 'spec', 0, tuple));
  return s;
}
it('keeps pages distinct, rejects late generations and bounds clean pages', () => {
  let s = opened();
  for (let i = 0; i < 8; i++) {
    s = notePagesReducer(s, pageRequestStarted('ws-a', 'spec', 0, String(i)));
    s = notePagesReducer(
      s,
      sourcePageReceived('ws-a', 'spec', 0, String(i), {
        ...source,
        range: { start: i, end: i + 3 },
      }),
    );
  }
  expect(Object.keys(s.byWorkspaceId['ws-a'].notes.spec.pages)).toHaveLength(4);
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', 0, {
      ...tuple,
      stateGeneration: '11',
      sourceRevision: 'r:8',
    }),
  );
  s = notePagesReducer(s, sourcePageReceived('ws-a', 'spec', 0, 'late', source));
  expect(Object.keys(s.byWorkspaceId['ws-a'].notes.spec.pages)).toHaveLength(0);
});
it('does not roll epochs back across channels and retains dirty content after deletion/unmount', () => {
  let s = opened();
  s = notePagesReducer(
    s,
    pageDraftChanged('ws-a', 'spec', {
      scope,
      sequence: 1,
      baseRevision: 'r:7',
      splices: [{ start: 0, end: 1, text: 'draft' }],
      selection: {
        anchorAffinity: 'before' as const,
        headAffinity: 'after' as const,
        anchor: 0,
        head: 1,
      },
    }),
  );
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', 0, { ...tuple, stateGeneration: '12', deleted: true }),
  );
  s = notePagesReducer(s, pageStateReceived('ws-a', 'spec', 0, tuple));
  s = notePagesReducer(s, pagePanelClosed('ws-a', 'spec', 'panel-a'));
  expect(s.byWorkspaceId['ws-a'].notes.spec.status).toBe('deleted');
  expect(s.byWorkspaceId['ws-a'].notes.spec.drafts[0].splices[0].text).toBe('draft');
});
it('only a matching authoritative receipt clears its captured sequence prefix', () => {
  let s = opened();
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: [{ start: 0, end: 1, text: 'draft' }],
    selection: {
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
      anchor: 0,
      head: 1,
    },
  };
  s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', draft));
  s = notePagesReducer(
    s,
    pageSaveStarted(
      'ws-a',
      'spec',
      {
        scope,
        baseRevision: 'r:7',
        operationId: 'op',
        payloadDigest: 'digest',
        expiresAt: '2099-01-01T00:00:00.000Z',
        splices: draft.splices,
      },
      1,
    ),
  );
  s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', { ...draft, sequence: 2 }));
  const receipt = {
    kind: 'noteCommitReceipt' as const,
    outcome: 'committed' as const,
    scope,
    operationId: 'op',
    payloadDigest: 'digest',
    beforeRevision: 'r:7',
    afterRevision: 'r:8',
    sourceLength: 23,
    mappingRef: 'map',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    receiptExpiresAt: '2099-01-08T00:00:00.000Z',
    invalidation: 'all' as const,
  };
  s = notePagesReducer(s, pageSaveSettled('ws-a', 'spec', { ...receipt, payloadDigest: 'other' }));
  expect(s.byWorkspaceId['ws-a'].notes.spec.drafts).toHaveLength(2);
  s = notePagesReducer(s, pageSaveSettled('ws-a', 'spec', receipt));
  expect(s.byWorkspaceId['ws-a'].notes.spec.drafts.map((d) => d.sequence)).toEqual([2]);
  expect(s.byWorkspaceId['ws-a'].notes.spec.history).toHaveLength(2);
  expect(s.byWorkspaceId['ws-a'].notes.spec.receipts).toEqual([receipt]);
});

import vectors from '$lib/client/mock/fixtures/note-pages-contract.json';
import type { NotePageState } from '$lib/client/note-pages';
it('applies the approved crossed-channel generation vectors to the real reducer', () => {
  let s = notePagesReducer(undefined, pagePanelOpened('ws-a', 'spec', 'panel'));
  const generations = [];
  for (const frame of vectors.crossedChannels.frames) {
    const n = s.byWorkspaceId['ws-a'].notes.spec;
    s = notePagesReducer(
      s,
      pageStateReceived('ws-a', 'spec', n.generation, frame.state as NotePageState),
    );
    generations.push(s.byWorkspaceId['ws-a'].notes.spec.state?.stateGeneration);
  }
  expect(generations).toEqual(vectors.crossedChannels.expectedGenerations);
  expect(s.byWorkspaceId['ws-a'].notes.spec.state).toEqual(vectors.crossedChannels.expected);
});

import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
it('never reuses generation ownership after clean workspace unmount and reopen', () => {
  let s = opened();
  const old = s.byWorkspaceId['ws-a'].notes.spec.generation;
  s = notePagesReducer(s, workspaceUnmounted('ws-a'));
  s = notePagesReducer(s, pagePanelOpened('ws-a', 'spec', 'new-panel'));
  const generation = s.byWorkspaceId['ws-a'].notes.spec.generation;
  expect(generation).not.toBe(old);
  s = notePagesReducer(s, pageStateReceived('ws-a', 'spec', generation, tuple));
  s = notePagesReducer(s, pageRequestStarted('ws-a', 'spec', generation, 'same-request'));
  s = notePagesReducer(s, sourcePageReceived('ws-a', 'spec', old, 'same-request', source));
  expect(s.byWorkspaceId['ws-a'].notes.spec.pages).toEqual({});
});

import { pageVisibleRangesChanged, pageSessionDiscarded } from './note-pages-slice';
it('preserves selection/history and invalidates clean pages on remote edits or inconsistent epochs', () => {
  let s = opened();
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: [{ start: 0, end: 1, text: 'mine' }],
    selection: {
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
      anchor: 2,
      head: 0,
    },
  };
  s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', draft));
  s = notePagesReducer(
    s,
    pageVisibleRangesChanged('ws-a', 'spec', 'panel-a', [{ start: 10, end: 20 }]),
  );
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', 0, {
      ...tuple,
      stateGeneration: '11',
      sourceRevision: 'remote',
    }),
  );
  const n = s.byWorkspaceId['ws-a'].notes.spec;
  expect(n.drafts).toEqual([draft]);
  expect(n.needsReconcile).toBe(true);
  expect(n.panels['panel-a']).toEqual([{ start: 10, end: 20 }]);
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', n.generation, {
      ...tuple,
      stateGeneration: '11',
      sourceRevision: 'contradictory',
    }),
  );
  expect(s.byWorkspaceId['ws-a'].notes.spec.status).toBe('error');
  expect(s.byWorkspaceId['ws-a'].notes.spec.history).toEqual([draft]);
});
it('retains draft bytes after conflict/rejection/unknown and requires explicit discard', () => {
  for (const outcome of ['conflict', 'rejected', 'unknown', 'pending'] as const) {
    let s = opened();
    const draft = {
      scope,
      sequence: 1,
      baseRevision: 'r:7',
      splices: [{ start: 0, end: 1, text: 'unsaved' }],
      selection: {
        anchorAffinity: 'before' as const,
        headAffinity: 'after' as const,
        anchor: 0,
        head: 1,
      },
    };
    s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', draft));
    s = notePagesReducer(
      s,
      pageSaveStarted(
        'ws-a',
        'spec',
        {
          scope,
          baseRevision: 'r:7',
          operationId: 'op',
          payloadDigest: 'digest',
          expiresAt: '2099-01-01T00:00:00.000Z',
          splices: draft.splices,
        },
        1,
      ),
    );
    s = notePagesReducer(
      s,
      pageSaveSettled('ws-a', 'spec', {
        kind: 'noteOperationStatus',
        scope,
        operationId: 'op',
        payloadDigest: 'digest',
        outcome,
      }),
    );
    expect(s.byWorkspaceId['ws-a'].notes.spec.drafts).toEqual([draft]);
    s = notePagesReducer(s, pageSessionDiscarded('ws-a', 'spec'));
    expect(s.byWorkspaceId['ws-a'].notes.spec).toBeUndefined();
  }
});

import { pageMappingAccepted } from './note-pages-slice';
import { selectNoteVisibleRanges } from './note-pages-selectors';
it('exposes independent panel source ranges for bounded annotation consumers', () => {
  let s = opened();
  s = notePagesReducer(s, pagePanelOpened('ws-a', 'spec', 'panel-b'));
  s = notePagesReducer(
    s,
    pageVisibleRangesChanged('ws-a', 'spec', 'panel-a', [{ start: 0, end: 10 }]),
  );
  s = notePagesReducer(
    s,
    pageVisibleRangesChanged('ws-a', 'spec', 'panel-b', [{ start: 80, end: 90 }]),
  );
  expect(
    selectNoteVisibleRanges.select(
      { notePages: s } as Parameters<typeof selectNoteVisibleRanges.select>[0],
      'ws-a',
      'spec',
    ),
  ).toEqual([
    { start: 0, end: 10 },
    { start: 80, end: 90 },
  ]);
  // An arbitrary mapping completion without a matching receipt cannot discard a journal.
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: [{ start: 0, end: 1, text: 'mine' }],
    selection: {
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
      anchor: 0,
      head: 1,
    },
  };
  s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', draft));
  s = notePagesReducer(s, pageMappingAccepted('ws-a', 'spec', 'unknown', []));
  expect(s.byWorkspaceId['ws-a'].notes.spec.drafts).toEqual([draft]);
});
it('does not block unsaved edits after a comment-only epoch or same-revision reconnect', () => {
  let s = opened();
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: [{ start: 0, end: 1, text: 'mine' }],
    selection: {
      anchor: 0,
      head: 1,
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
    },
  };
  s = notePagesReducer(s, pageDraftChanged('ws-a', 'spec', draft));
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', 0, {
      ...tuple,
      stateGeneration: '11',
      commentRevision: 'c:5',
    }),
  );
  expect(s.byWorkspaceId['ws-a'].notes.spec.needsReconcile).toBe(false);
  s = notePagesReducer(s, pagePanelClosed('ws-a', 'spec', 'panel-a'));
  s = notePagesReducer(s, pagePanelOpened('ws-a', 'spec', 'panel-b'));
  expect(s.byWorkspaceId['ws-a'].notes.spec.needsReconcile).toBe(false);
});
it('admits a recreated clean note but retains dirty incarnation ownership', () => {
  let s = opened();
  s = notePagesReducer(
    s,
    pageStateReceived('ws-a', 'spec', 0, {
      ...tuple,
      scope: { ...scope, noteInstanceId: 'inc-new' },
      stateGeneration: '1',
    }),
  );
  expect(s.byWorkspaceId['ws-a'].notes.spec.state?.scope.noteInstanceId).toBe('inc-new');
  expect(s.byWorkspaceId['ws-a'].notes.spec.status).toBe('ready');
});
