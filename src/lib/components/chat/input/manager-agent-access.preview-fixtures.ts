import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { workspaceCatalogReceived } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import {
  managerShellWorkspace as workspaceId,
  seedManagerShellAccess,
} from '../../terminal/manager-shell-access.preview-fixtures';

export const managerPreviewAgent = 'preview-manager-agent';

/** Workspace catalogs only; no host catalog, mocked selectors, or execution sagas. */
export function seedManagerAgentAccess(): void {
  seedManagerShellAccess();
  const providerIds = ['codex', 'claude-code'];
  store.dispatch(
    workspaceCatalogReceived(
      workspaceId,
      {
        catalog: {
          providers: MOCK_PROVIDER_CATALOG.providers.filter((row) => providerIds.includes(row.id)),
        },
        readiness: Object.fromEntries(
          providerIds.map((id) => [id, { available: true, authenticated: true }]),
        ),
        settings: [
          {
            path: 'model.defaultProvider',
            value: 'codex',
            label: '',
            description: '',
            category: 'model',
            type: 'string',
          },
          {
            path: 'providers.enabled',
            value: { codex: true, 'claude-code': true },
            label: '',
            description: '',
            category: 'providers',
            type: 'object',
          },
        ],
        specialists: [],
      },
      store.state.providerCatalog.workspaceEpoch ?? 0,
    ),
  );
  for (const providerId of providerIds) {
    store.dispatch(
      providerModelsLoaded(
        providerId,
        {
          models: [
            {
              value: `${providerId}-balanced`,
              label: 'Balanced',
              description: 'Balanced speed and capability',
              isDefault: true,
            },
            { value: `${providerId}-fast`, label: 'Fast', description: 'Quick everyday tasks' },
          ],
        },
        store.state.providerModels.clearEpoch,
        workspaceId,
      ),
    );
  }
  store.dispatch(
    bulkUpsertSessions(
      [
        normalizeAgent({
          id: managerPreviewAgent,
          workspaceId,
          name: 'Website assistant',
          status: 'idle',
          provider: 'codex',
          model: 'codex-balanced',
        }),
      ],
      { preserveExplicitRuntimeFlags: false },
    ),
  );
}

export const selectManagerPreviewPendingRequests = store.createSelector(
  (state) =>
    getItems(state.agentModel.mutations).filter(
      (entry) => entry.agentId === managerPreviewAgent && entry.status === 'pending',
    ).length,
);
