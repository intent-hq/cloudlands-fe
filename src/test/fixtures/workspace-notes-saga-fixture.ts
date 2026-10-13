import type { Store } from '@themislib/themis/svelte-store';

import { workspaceNotesSaga } from '$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga';

export function startWorkspaceNotesSagaFixture(store: Store<any, any>): Array<() => void> {
  const release = store.runSaga(workspaceNotesSaga);
  let released = false;
  return [
    () => {
      if (released) return;
      released = true;
      release();
    },
  ];
}
