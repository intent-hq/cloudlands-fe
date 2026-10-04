import { expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import * as a from './note-pages-slice';
import type { NoteResourceCost } from '$features/notes/virtualized/note-resource-ledger';

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
