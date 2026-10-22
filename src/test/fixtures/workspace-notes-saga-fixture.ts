import type { Store } from '@themislib/themis/svelte-store';

import { workspaceNotesSaga } from '$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga';

export function startWorkspaceNotesSagaFixture(store: Store<any, any>): Array<() => void> {
  return [store.runSaga(workspaceNotesSaga)];
}
