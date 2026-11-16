import type { ScriptWithState } from '$features/scripts/types';
import { appClient } from '$lib/client';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { store } from '$store/renderer/store';
import { filesReadSaga } from '$store/renderer/slices/files/sagas/files-read-saga';
import { admitLegacyPrincipal } from './fixtures/principal-state';

/**
 * Preview wiring for `workspace-home-run`: every file read fails with the
 * `home-unavailable` data `fileError(workspaceId)` returns (PROTOCOL
 * `09-error-codes.md`), through the real read saga; script reads come from the
 * store. Returns the teardown.
 */
export function setupWorkspaceHomeRunPreview(
  fileError: (workspaceId: string) => Record<string, unknown>,
): () => void {
  const previous = {
    read: appClient.files.read,
    output: appClient.scripts.output,
    list: appClient.scripts.list,
  };
  appClient.files.read = async (workspaceId) => {
    const data = { code: 'home-unavailable', retryable: true, ...fileError(workspaceId) };
    throw new BackendError({ code: 'INTERNAL', message: 'Internal error', rpcCode: -32603, data });
  };
  appClient.scripts.output = async () => '';
  appClient.scripts.list = async (workspaceId) =>
    Object.values(store.state.scripts.byWorkspaceId[workspaceId]?.scripts ?? {}).filter(
      (row): row is ScriptWithState => typeof row.command === 'string',
    );
  admitLegacyPrincipal();
  const stopFiles = store.runSaga(filesReadSaga);
  return () => {
    stopFiles();
    appClient.files.read = previous.read;
    appClient.scripts.output = previous.output;
    appClient.scripts.list = previous.list;
  };
}
