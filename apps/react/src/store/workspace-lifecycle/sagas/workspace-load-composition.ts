import { call, cancel, fork, type SagaGenerator } from 'typed-redux-saga';
import { store, type AppState } from '@/store';
import { backend } from '@/features/backend/backend-transport';
import * as deletions from '@/features/workspace/workspace-deletion';
import { observeWorkspaceLoadAuthority } from '@/features/workspace/workspace-load-read-scope';
import { createElectronWorkspaceLoadTransport } from '$lib/client/live/workspace-load-route-transport';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { createWorkspaceLoadSaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-load-saga-factory';
import { createWorkspaceTabCleanupSaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-tab-cleanup-saga-factory';
import type { WorkspaceLoadOriginPort } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-origin-types';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  selectIsWorkspaceSessionLive,
  selectWorkspaceLoadState,
} from '../workspace-lifecycle-selectors';

/**
 * Inactive React binding: only an explicit Store.runSaga call starts observation.
 * The existing root owns Store, status, principal and membership lifetimes.
 * Same-function starts share the Store's reference-counted task; each caller
 * must invoke its returned cancel handle once, before the Store is disposed.
 * Full hydration remains the canonical lifecycle receivers' responsibility.
 */
export function* workspaceLoadCompositionSaga(): SagaGenerator<void> {
  // Both the port and its binding identity belong to this run, never the module.
  let binding: { port: WorkspaceLoadOriginPort } | undefined;
  const transport = createElectronWorkspaceLoadTransport(IPC_CHANNELS.WORKSPACE_LOAD);
  // These synchronous canonical snapshots are required by the admitted-read
  // contract; cached selector delivery cannot authorize an old physical capture.
  const readCurrentContext = () => selectPrincipalActionContext.select(store.state);
  const receiver = createWorkspaceLoadSaga<AppState>({
    selectWorkspaceById,
    selectIsWorkspaceSessionLive,
    selectWorkspaceLoadState,
    admission: {
      kind: 'principal',
      contextSelector: selectPrincipalActionContext,
      readCurrentContext,
      dispatch: store.dispatch,
      captureRequest: (action) => binding?.port.captureRequest(action) ?? null,
    },
  });
  const producer = createWorkspaceTabCleanupSaga<AppState>({
    kind: 'origin',
    selectIsWorkspaceSessionLive,
    // Async mode never consults the synchronous authority lookup.
    readReadyAuthority: () => null,
    observation: {
      wakeAction: connectionStatusChanged,
      readCurrentContext,
      observe: (signal) =>
        observeWorkspaceLoadAuthority({ transport, backend, store, deletions }, signal),
    },
    bind(port) {
      const owned = { port };
      binding = owned;
      return () => {
        if (binding === owned) binding = undefined;
      };
    },
  });

  // fork installs the receiver's take before the producer can publish a load.
  const receiving = yield* fork(receiver);
  try {
    // The called producer retires its original captures in its synchronous
    // finally before this enclosing frame cancels the remaining load receiver.
    yield* call(producer);
  } finally {
    binding = undefined;
    yield* cancel(receiving);
  }
}
