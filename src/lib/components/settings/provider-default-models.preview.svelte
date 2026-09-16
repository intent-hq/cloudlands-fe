<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ narrowPane?: boolean }>({
    id: 'provider-default-models',
    title: 'Provider default models',
    defaultState: 'default',
    states: {
      default: { props: {} },
      'narrow-pane': { props: { narrowPane: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
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
    selectBgTypeOverrides,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import { hydrateSettings } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import DefaultAgentModelSettings from './DefaultAgentModelSettings.svelte';
  import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { narrowPane = false }: { narrowPane?: boolean } = $props();
  // The sandbox/CT root owns the isolated store; no persistence sagas run here.
  const previous = {
    models: selectProviderModels.select(appStore.state),
    effort: selectDefaultReasoningEffort.select(appStore.state),
    specialists: selectFileSpecialists.select(appStore.state),
    defaultModel: selectBgDefaultModel.select(appStore.state),
    typeOverrides: selectBgTypeOverrides.select(appStore.state),
  };
  const restoreModels = modelPreview.states.reasoning.setup?.();
  appStore.dispatch(setSelectedModel({ providerId: 'codex', model: 'codex-preview-balanced' }));
  appStore.dispatch(loadDefaultReasoningEffortFromStorage('medium'));
  appStore.dispatch(
    hydrateSettings({
      defaultModel: '',
      typeOverrides: {
        commit: 'claude-code:claude-code-preview-deep',
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
  onDestroy(() => {
    appStore.dispatch(hydrateSettings(previous));
    appStore.dispatch(setFileSpecialists(previous.specialists));
    appStore.dispatch(loadDefaultReasoningEffortFromStorage(previous.effort));
    appStore.dispatch(
      setSelectedModel({ providerId: 'codex', model: previous.models.codex ?? '' }),
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
    })}</output
  >
</div>
