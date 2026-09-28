<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{
    narrowPane?: boolean;
    quickActionDefaultModel?: string;
    quickActionEffort?: string;
    quickActionProvider?: string;
  }>({
    id: 'provider-default-models',
    title: 'Provider default models',
    defaultState: 'default',
    states: {
      default: { props: {} },
      'narrow-pane': { props: { narrowPane: true } },
      'auggie-effort-unavailable': {
        props: {
          quickActionProvider: 'auggie',
          quickActionDefaultModel: 'auggie-preview-balanced',
          quickActionEffort: 'medium',
        },
      },
      'quick-action-effort': {
        props: {
          quickActionDefaultModel: 'codex:codex-preview-balanced',
          quickActionEffort: 'medium',
        },
      },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { checkSingleProviderSuccess } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { selectProviderStatusMap } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import { selectProviderModelsClearEpoch } from '$store/renderer/slices/provider-models/provider-models-selectors';
  import { setupModelPickerPreviewHandler } from '../../../test/catalog-preview-ipc';
  import {
    hydrateDefaultProvider,
    setAvailableModels,
  } from '$store/renderer/slices/model/model-slice';
  import { store as appStore } from '$store/renderer/store';
  import { preview as modelPreview } from '../chat/input/model-picker.preview';
  import {
    selectDefaultReasoningEffort,
    selectProviderModels,
  } from '$store/renderer/slices/model/model-selectors';
  import {
    setSelectedModel,
    loadDefaultReasoningEffortFromStorage,
  } from '$store/renderer/slices/model/model-slice';
  import { selectFileSpecialists } from '$store/renderer/slices/specialists/specialists-selectors';
  import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    selectBgDefaultModel,
    selectBgDefaultReasoningEffort,
    selectBgTypeReasoningEffortOverrides,
    selectBgTypeOverrides,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import { hydrateSettings } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import DefaultAgentModelSettings from './DefaultAgentModelSettings.svelte';
  import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    narrowPane = false,
    quickActionDefaultModel = '',
    quickActionEffort = '',
    quickActionProvider = 'codex',
  }: {
    narrowPane?: boolean;
    quickActionDefaultModel?: string;
    quickActionEffort?: string;
    quickActionProvider?: string;
  } = $props();
  // The sandbox/CT root owns the isolated store; no persistence sagas run here.
  const previous = {
    models: selectProviderModels.select(appStore.state),
    effort: selectDefaultReasoningEffort.select(appStore.state),
    specialists: selectFileSpecialists.select(appStore.state),
    defaultModel: selectBgDefaultModel.select(appStore.state),
    defaultReasoningEffort: selectBgDefaultReasoningEffort.select(appStore.state),
    typeReasoningEffortOverrides: selectBgTypeReasoningEffortOverrides.select(appStore.state),
    typeOverrides: selectBgTypeOverrides.select(appStore.state),
  };
  const previousAuggieStatus = selectProviderStatusMap.select(appStore.state).auggie;
  const restoreModels = modelPreview.states.reasoning.setup?.();
  let restoreAuggie: (() => void) | undefined;
  if (quickActionProvider === 'auggie') {
    // Ordinary Auggie sessions advertise effort; --print quick actions cannot apply it.
    const rows = [
      {
        value: 'auggie-preview-balanced',
        label: 'Balanced',
        isDefault: true,
        effortLevels: ['low', 'medium', 'high'],
      },
    ];
    appStore.dispatch(
      providerCatalogLoaded({
        providers: [
          ...selectProviderCatalogEntries.select(appStore.state),
          {
            id: 'auggie',
            displayName: 'Auggie',
            shortName: 'Auggie',
            command: 'auggie',
            canBeDisabled: false,
            visible: true,
          },
        ],
      }),
    );
    appStore.dispatch(
      checkSingleProviderSuccess('auggie', { available: true, authenticated: true }),
    );
    appStore.dispatch(hydrateDefaultProvider('auggie'));
    appStore.dispatch(
      providerModelsLoaded(
        'auggie',
        { models: rows },
        selectProviderModelsClearEpoch.select(appStore.state),
      ),
    );
    appStore.dispatch(setAvailableModels(rows, 'auggie'));
    appStore.dispatch(setSelectedModel({ providerId: 'auggie', model: 'auggie-preview-balanced' }));
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Preview-only synchronous IPC fixture registration; no domain data is fetched.
    restoreAuggie = setupModelPickerPreviewHandler('auggie', rows);
  }
  appStore.dispatch(setSelectedModel({ providerId: 'codex', model: 'codex-preview-balanced' }));
  appStore.dispatch(loadDefaultReasoningEffortFromStorage('medium'));
  appStore.dispatch(
    hydrateSettings({
      defaultModel: quickActionDefaultModel,
      defaultReasoningEffort: quickActionEffort,
      typeReasoningEffortOverrides: {},
      typeOverrides: {
        commit: quickActionEffort ? '' : 'claude-code:claude-code-preview-deep',
        pr: '',
        review: '',
        fast: '',
      },
    }),
  );
  appStore.dispatch(
    setFileSpecialists([
      {
        id: 'preview-reviewer',
        name: 'Sample reviewer',
        description: 'Reviews sample changes',
        model: 'codex-preview-balanced',
        codingAgent: 'codex',
        behaviorPrompt: 'Review the sample.',
        source: 'user',
        filePath: '/preview/reviewer.md',
      },
    ]),
  );
  const defaultModel$ = selectBgDefaultModel();
  const overrides$ = selectBgTypeOverrides();
  const effort$ = selectDefaultReasoningEffort();
  const quickEffort$ = selectBgDefaultReasoningEffort();
  const quickEffortOverrides$ = selectBgTypeReasoningEffortOverrides();
  onDestroy(() => {
    appStore.dispatch(hydrateSettings(previous));
    appStore.dispatch(setFileSpecialists(previous.specialists));
    appStore.dispatch(loadDefaultReasoningEffortFromStorage(previous.effort));
    appStore.dispatch(
      setSelectedModel({ providerId: 'codex', model: previous.models.codex ?? '' }),
    );
    restoreAuggie?.();
    if (quickActionProvider === 'auggie')
      appStore.dispatch(
        checkSingleProviderSuccess('auggie', previousAuggieStatus ?? { available: false }),
      );
    restoreModels?.();
  });
</script>

<div
  class="w-full min-w-0 bg-background p-6 text-foreground"
  style:max-width={narrowPane ? '420px' : undefined}
  data-testid="provider-default-models"
>
  <h2 class="type-title mb-3 text-foreground">{m.settings_section_defaults()}</h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    <section data-slot="settings-section-body" class="px-6 py-4">
      <DefaultAgentModelSettings workspaceId={null} />
    </section>
    <section data-slot="settings-section-body" class="px-6 py-4">
      <h3 class="type-title mb-5 text-foreground">{m.settings_section_quickActions()}</h3>
      <BackgroundAgentSettings />
    </section>
  </div>
  <output data-testid="defaults-state" class="sr-only"
    >{JSON.stringify({
      defaultModel: $defaultModel$,
      overrides: $overrides$,
      effort: $effort$,
      quickEffort: $quickEffort$,
      quickEffortOverrides: $quickEffortOverrides$,
    })}</output
  >
</div>
