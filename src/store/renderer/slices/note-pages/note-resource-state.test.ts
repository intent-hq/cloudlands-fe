import { expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import * as a from './note-pages-slice';
import type { NoteResourceCost } from '$features/notes/virtualized/note-resource-ledger';
import type { NoteSourcePage, NotePageState } from '$lib/client/note-pages';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const state: NotePageState = {
  kind: 'notePageState',
  scope,
  stateGeneration: '1',
  sourceRevision: 'r',
  attributionGeneration: 'a',
  attributionState: 'ready',
  commentRevision: 'c',
  deleted: false,
  invalidation: 'all',
};
const page: NoteSourcePage = {
  kind: 'noteSourcePage',
  scope,
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00.000Z',
  sourceLength: 100,
  range: { start: 0, end: 4 },
  text: 'read',
  nextCursor: null,
  previousCursor: null,
  contextRef: 'ctx',
  metadataRef: 'meta',
};

it('retains an exact cached allocation across eviction and releases it only after its consumer', () => {
  let s = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 65536,
      stringUnits: 65536,
      objectNodes: 65536,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  s = a.notePagesReducer(s, a.pagePanelOpened('w', 'n', 'p'));
  s = a.notePagesReducer(s, a.pageStateReceived('w', 'n', 0, state));
  for (let i = 0; i < 5; i++) {
    s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, String(i), String(i), 8192));
    s = a.notePagesReducer(s, a.sourcePageReceived('w', 'n', 0, String(i), { ...page }));
    if (i === 0) {
      s = a.notePagesReducer(
        s,
        a.pageCachedRetained(
          'w',
          'n',
          0,
          '0',
          'assembly:input',
          s.byWorkspaceId.w.notes.n.pages['0'],
        ),
      );
      expect(s.resourceLedger.resources['frame:0'].owners).toContain('assembly:input');
    }
    s = a.notePagesReducer(s, a.pageReadSettled('w', 'n', 0, String(i)));
  }
  expect(s.byWorkspaceId.w.notes.n.pages['0']).toBeUndefined();
  expect(s.resourceLedger.resources['frame:0'].owners).toEqual(['assembly:input']);
  s = a.notePagesReducer(s, workspaceUnmounted('w'));
  expect(Object.keys(s.resourceLedger.resources)).toEqual(['frame:0']);
  expect(s.resourceLedger.used.physicalReads).toBe(0);
  s = a.notePagesReducer(s, a.pageResourcesReleased('assembly:input'));
  expect(s.resourceLedger.used.payloadBytes).toBe(0);
});

it('never retains an equal copy or a stale generation as the cached allocation', () => {
  let s = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 65536,
      stringUnits: 65536,
      objectNodes: 65536,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  s = a.notePagesReducer(s, a.pagePanelOpened('w', 'n', 'p'));
  s = a.notePagesReducer(s, a.pageStateReceived('w', 'n', 0, state));
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, '0', '0', 8192));
  s = a.notePagesReducer(s, a.sourcePageReceived('w', 'n', 0, '0', page));
  s = a.notePagesReducer(s, a.pageCachedRetained('w', 'n', 1, '0', 'stale', page));
  s = a.notePagesReducer(s, a.pageCachedRetained('w', 'n', 0, '0', 'copy', { ...page }));
  expect(s.resourceLedger.owners.stale).toBeUndefined();
  expect(s.resourceLedger.owners.copy).toBeUndefined();
});

const limit: NoteResourceCost = {
  payloadBytes: 100,
  stringUnits: 100,
  objectNodes: 10,
  domNodes: 10,
  physicalReads: 1,
  assemblies: 1,
};
const allocation = (id: string) => ({ id, cost: { ...limit, assemblies: 0 } });

it('keeps global runtime ownership through session invalidation and workspace removal', () => {
  let s = a.notePagesReducer(a.initialNotePagesState, a.pageResourceLimitsConfigured(limit));
  s = a.notePagesReducer(s, a.pagePanelOpened('w', 'n', 'panel'));
  s = a.notePagesReducer(s, a.pageResourcesRequested('physical/read', [allocation('frame')]));
  s = a.notePagesReducer(s, a.pageResourcesRequested('other-workspace/read', [allocation('next')]));
  s = a.notePagesReducer(s, a.pageReset('w', 'n'));
  s = a.notePagesReducer(s, workspaceUnmounted('w'));
  expect(s.resourceLedger.used.physicalReads).toBe(1);
  expect(s.resourceLedger.owners['other-workspace/read']).toBeUndefined();
  s = a.notePagesReducer(s, a.pageResourcesReleased('physical/read'));
  expect(s.resourceLedger.owners['other-workspace/read']).toEqual(['next']);
});

it('refuses to replace the policy while runtime allocations or queued owners survive', () => {
  let s = a.notePagesReducer(a.initialNotePagesState, a.pageResourceLimitsConfigured(limit));
  s = a.notePagesReducer(s, a.pageResourcesRequested('old-view', [allocation('dom')]));
  const unchanged = a.notePagesReducer(
    s,
    a.pageResourceLimitsConfigured({ ...limit, domNodes: 100 }),
  );
  expect(unchanged).toBe(s);
  s = a.notePagesReducer(s, a.pageResourcesTransferred('old-view', 'new-view'));
  expect(s.resourceLedger.used.payloadBytes).toBe(100);
  expect(s.resourceLedger.owners['old-view']).toBeUndefined();
  expect(s.resourceLedger.owners['new-view']).toEqual(['dom']);
});

it('evicts the oldest clean page across notes before admitting another bounded read', () => {
  let s = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 8192,
      stringUnits: 3 * 8192,
      objectNodes: 8192,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  for (const id of ['n', 'other']) {
    s = a.notePagesReducer(s, a.pagePanelOpened('w', id, 'p'));
    s = a.notePagesReducer(
      s,
      a.pageStateReceived('w', id, id === 'n' ? 0 : 1, {
        ...state,
        scope: { ...scope, noteId: id },
      }),
    );
  }
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, 'first', 'first', 8192));
  s = a.notePagesReducer(s, a.sourcePageReceived('w', 'n', 0, 'first', page));
  s = a.notePagesReducer(s, a.pageReadSettled('w', 'n', 0, 'first'));
  expect(s.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'other', 1, 'next', 'next', 8192));
  expect(s.resourceLedger.owners['read:next']).toEqual(['frame:next', 'slot:next']);
  expect(s.byWorkspaceId.w.notes.n.pages.first).toBeUndefined();
  expect(s.resourceLedger.resources['frame:first']).toBeUndefined();
});

it('cannot free an assembly input by evicting its clean page', () => {
  let s = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 8192,
      stringUnits: 3 * 8192,
      objectNodes: 8192,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  s = a.notePagesReducer(s, a.pagePanelOpened('w', 'n', 'p'));
  s = a.notePagesReducer(s, a.pageStateReceived('w', 'n', 0, state));
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, 'first', 'first', 8192));
  s = a.notePagesReducer(s, a.sourcePageReceived('w', 'n', 0, 'first', page));
  s = a.notePagesReducer(s, a.pageCachedRetained('w', 'n', 0, 'first', 'assembly:input', page));
  s = a.notePagesReducer(s, a.pageReadSettled('w', 'n', 0, 'first'));
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, 'next', 'next', 8192));
  expect(s.byWorkspaceId.w.notes.n.pages.first).toBeUndefined();
  expect(s.resourceLedger.owners['read:next']).toBeUndefined();
  expect(s.resourceLedger.resources['frame:first'].owners).toEqual(['assembly:input']);
  s = a.notePagesReducer(s, a.pageResourcesReleased('assembly:input'));
  expect(s.resourceLedger.owners['read:next']).toEqual(['frame:next', 'slot:next']);
});

it('reclaims cache credit when a physical settlement unblocks the oldest queued read', () => {
  let s = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 8192,
      stringUnits: 3 * 8192,
      objectNodes: 8192,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  s = a.notePagesReducer(s, a.pagePanelOpened('w', 'n', 'p'));
  s = a.notePagesReducer(s, a.pageStateReceived('w', 'n', 0, state));
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, 'first', 'first', 8192));
  s = a.notePagesReducer(s, a.pageRequestStarted('w', 'n', 0, 'next', 'next', 8192));
  s = a.notePagesReducer(s, a.sourcePageReceived('w', 'n', 0, 'first', page));
  expect(s.resourceLedger.owners['read:next']).toBeUndefined();
  expect(s.byWorkspaceId.w.notes.n.pages.first).toBe(page);
  s = a.notePagesReducer(s, a.pageReadSettled('w', 'n', 0, 'first'));
  expect(s.resourceLedger.owners['read:next']).toEqual(['frame:next', 'slot:next']);
  expect(s.cleanPages.ids).toEqual([]);
});
