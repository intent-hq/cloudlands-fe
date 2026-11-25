<script lang="ts">
  import AgentFailureGroupToast from '$lib/components/ui/toast/AgentFailureGroupToast.svelte';
  import ProviderSwitchDialog from '../ProviderSwitchDialog.svelte';
  import type {
    ProviderSwitchDialogRow,
    ProviderSwitchDialogView,
  } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-types';
  import type { BulkSwitchTarget } from '$features/agent/bulk-provider-switch';
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { setProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    checkAllProvidersComplete,
    checkSingleProviderSuccess,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
  import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
  import { wireModelsToProviderModels } from '$shared/models/wire-model-info';
  import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  let {
    rows,
    finishedRows,
    onConfirm,
    onRetryAll,
  }: {
    rows: ProviderSwitchDialogRow[];
    /** Rows shown after Confirm, to render per-agent results. */
    finishedRows?: ProviderSwitchDialogRow[];
    onConfirm: (selections: Record<string, BulkSwitchTarget | null>) => void;
    onRetryAll: () => void;
  } = $props();

  const closed: ProviderSwitchDialogView = {
    open: false,
    groupKey: null,
    kind: null,
    providerLabel: '',
    loading: false,
    running: false,
    finished: false,
    progress: { done: 0, total: 0 },
    rows: [],
  };
  let dialog = $state<ProviderSwitchDialogView>({ ...closed });

  // Two signed-in providers; the failed one (claude-code) must never be offered.
  const catalogs: Record<string, ReturnType<typeof wireModelsToProviderModels>> = {
    codex: wireModelsToProviderModels({
      providerId: 'codex',
      models: [
        { id: 'sol', name: 'Sol 6.2', isDefault: true },
        { id: 'luna', name: 'Luna' },
      ],
    }),
    'claude-code': wireModelsToProviderModels({
      providerId: 'claude-code',
      models: [{ id: 'opus', name: 'Opus 5.5' }],
    }),
  };
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  admitLegacyPrincipal();
  store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
  store.dispatch(hydrateDefaultProvider('claude-code'));
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_MODELS, (params) => ({
    success: true,
    data: catalogs[(params as { providerId: string }).providerId] ?? [],
  }));
  for (const [providerId, models] of Object.entries(catalogs)) {
    store.dispatch(setProviderEnabled({ providerId, enabled: true }));
    store.dispatch(
      checkSingleProviderSuccess(providerId, { available: true, authenticated: true }),
    );
    store.dispatch(providerModelsLoaded(providerId, { models }, 0));
  }
  store.dispatch(checkAllProvidersComplete());
  onDestroy(() => {
    unregisterMockIpcHandler(PROVIDERS_CHANNELS.GET_MODELS);
    disposeStore();
  });
</script>

<div class="w-88 rounded-md border bg-popover p-3" data-testid="group-toast">
  <AgentFailureGroupToast
    title="Claude Code usage or rate limit reached — 5 agents"
    errorSummary="You have hit your weekly limit."
    members={['Implementor / Fix login', 'Verifier / Dark mode', 'Planner / Billing']}
    moreCount={2}
    retrying={false}
    onSwitchAll={() => {
      dialog = {
        ...closed,
        open: true,
        groupKey: 'quota:claude-code',
        kind: 'quota',
        providerLabel: 'Claude Code',
        rows,
      };
    }}
    {onRetryAll}
    onClose={() => {}}
  />
</div>

<ProviderSwitchDialog
  state={dialog}
  onSelect={(rowKey, target) => {
    dialog = {
      ...dialog,
      rows: dialog.rows.map((row) => (row.key === rowKey ? { ...row, selection: target } : row)),
    };
  }}
  onConfirm={() => {
    onConfirm(Object.fromEntries(dialog.rows.map((row) => [row.key, row.selection])));
    if (finishedRows) dialog = { ...dialog, rows: finishedRows, finished: true };
  }}
  {onRetryAll}
  onClose={() => (dialog = { ...closed })}
/>
