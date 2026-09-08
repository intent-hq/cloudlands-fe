import { call, put, takeLeading, type SagaGenerator } from 'typed-redux-saga';

import { importLegacyWorkspaces } from '$features/settings/legacy-import.client';
import { loadWorkspacesRequested } from '../../workspace/workspace-slice';
import {
  legacyImportFailed,
  legacyImportRequested,
  legacyImportSucceeded,
} from '../legacy-import-slice';

function* importLegacy(action: { payload?: unknown }): SagaGenerator<void> {
  const force = Array.isArray(action.payload) && action.payload[0] === true;
  try {
    const report: Awaited<ReturnType<typeof importLegacyWorkspaces>> = yield* call(
      importLegacyWorkspaces,
      force,
    );
    yield* put(legacyImportSucceeded(report));
    yield* put(loadWorkspacesRequested());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield* put(legacyImportFailed(message));
  }
}

export function* legacyImportSaga(): SagaGenerator<void> {
  yield* takeLeading(legacyImportRequested, importLegacy);
}
