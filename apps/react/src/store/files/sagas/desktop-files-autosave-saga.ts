import { fileSaveOperationQueued } from '../../../../../../src/store/renderer/slices/files/files-slice';
import { m } from '$shared/paraglide/messages.js';
import { createChannelFromSelector } from '@themislib/themis/saga';
import { put, take, type SagaGenerator } from 'typed-redux-saga';
import { store } from '@/store';
import { createFilesAutosaveSaga } from '../../../../../../src/store/renderer/slices/files/sagas/files-autosave-saga-factory';
import { captureFileSaveAuthority } from '@/features/workspace/file-save-runtime';
import { selectFileContentEntry } from '../files-selectors';
import {
  selectDesktopFileEditScope,
  selectDesktopFileEditCurrent,
  selectDesktopFileEditAuthorityCurrent,
} from '../desktop-file-selectors';

type EditScope = NonNullable<ReturnType<typeof selectDesktopFileEditScope.select>>;
function* waitForRetirement(scope: EditScope): SagaGenerator<void> {
  const channel = yield* createChannelFromSelector(selectDesktopFileEditCurrent, scope);
  try {
    if (yield* selectDesktopFileEditCurrent.effect(scope)) {
      while ((yield* take(channel)).payload) {
        /* observe until the first retirement */
      }
    }
    // Record a cancelled, never-dispatched save in the existing receipt owner so a coalesced
    // root/permission ABA cannot make the retained dirty editor silently look admitted again.
    if (!(yield* selectDesktopFileEditAuthorityCurrent.effect(scope)))
      yield* put(
        fileSaveOperationQueued({
          requestId: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          path: scope.path,
          absolutePath: scope.absolutePath,
          authority: scope.authority,
          status: 'cancelled',
          error: m.workspace_client_accessChanged_error(),
        }),
      );
  } finally {
    channel.close();
  }
}
export const desktopFilesAutosaveSaga = createFilesAutosaveSaga({
  selectFileContentEntry,
  admission: {
    captureAuthority: captureFileSaveAuthority,
    serializeSaves: true,
    createRequestId: () => crypto.randomUUID(),
    retirement: {
      captureScope: (workspaceId, path, absolutePath) =>
        selectDesktopFileEditScope.select(store.state, workspaceId, path, absolutePath),
      waitForRetirement,
    },
  },
});
