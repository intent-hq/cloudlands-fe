import { call, put, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import {
  loadSetupScriptPresenceRequested,
  setupScriptPresenceLoadFailed,
  setupScriptPresenceLoaded,
} from '../setup-scripts-slice';
import { takeLatestInContext } from '../../../utils/context-saga-effects';

function* loadPresence(
  action: ReturnType<typeof loadSetupScriptPresenceRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  try {
    const record: Awaited<ReturnType<typeof appClient.setupScripts.get>> = yield* call(
      [appClient.setupScripts, appClient.setupScripts.get],
      workspaceId,
    );
    yield* put(setupScriptPresenceLoaded(workspaceId, !!record?.script?.trim()));
  } catch {
    yield* put(setupScriptPresenceLoadFailed(workspaceId));
  }
}

export function* setupScriptsSaga(): SagaGenerator<void> {
  yield* takeLatestInContext(
    [loadSetupScriptPresenceRequested],
    (action) => action.payload[0],
    loadPresence,
  );
}
