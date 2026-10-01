import { store } from '$store/renderer/store';
import { specialistsSaga } from '$store/renderer/slices/specialists/sagas/specialists-saga';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatus } from '$shared/types';
import type { SpecialistImportDiagnostic } from '$lib/client/app-client';
import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceCatalogReceived } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';

export const diagnosticWorkspaceId = WorkspaceId('specialist-import-locality-preview');

export function installDiagnosticWorkspace(
  locality: 'local' | 'remote',
  importDiagnostics: SpecialistImportDiagnostic[],
) {
  const previous = selectWorkspaceById.select(store.state, diagnosticWorkspaceId);
  const previousCatalog = store.state.providerCatalog.byWorkspaceId?.[diagnosticWorkspaceId];
  store.dispatch(
    setWorkspaceEntity({
      id: diagnosticWorkspaceId,
      title: 'Import diagnostics preview',
      branch: 'preview-import-diagnostics',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      path: '/tmp/intent-demo',
      status: WorkspaceStatus.Active,
      environmentConfig:
        locality === 'remote'
          ? { type: 'remote', ssh: { host: 'example.com', user: 'dev' } }
          : undefined,
      ...PREVIEW_FIXTURE_TIMESTAMPS,
    }),
  );
  store.dispatch(
    workspaceCatalogReceived(
      diagnosticWorkspaceId,
      {
        catalog: { providers: [] },
        settings: [],
        specialists: [],
        readiness: {},
        importDiagnostics,
      },
      store.state.providerCatalog.workspaceEpoch ?? 0,
    ),
  );
  return () => {
    store.dispatch(removeWorkspaceEntity(diagnosticWorkspaceId));
    if (previous) store.dispatch(setWorkspaceEntity(previous));
    if (previousCatalog)
      store.dispatch(
        workspaceCatalogReceived(
          diagnosticWorkspaceId,
          previousCatalog,
          store.state.providerCatalog.workspaceEpoch ?? 0,
        ),
      );
  };
}

/** Intercept the fixture's editor choices at the real routed IPC seam. */
export function interceptSpecialistEditorLaunches(
  record: (launch: { channel: string; args: unknown[] }) => void,
) {
  const disposers = ['vscode:open', 'external-editors:open-with-other'].map((channel) =>
    overrideMockIpcHandler(channel, (...args) => {
      record({ channel, args });
      return { success: true };
    }),
  );
  return () => disposers.forEach((dispose) => dispose());
}

export const startSpecialistCatalogPreview = () => store.runSaga(specialistsSaga);
