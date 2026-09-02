<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectDefaultReasoningEffort,
    selectModelDisplayName,
    selectModelEffortLevels,
    selectSelectedModel,
  } from '$store/renderer/slices/model/model-selectors';
  import {
    reloadModelsForProvider,
    setDefaultReasoningEffort,
  } from '$store/renderer/slices/model/model-slice';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { store as appStore } from '$store/renderer/store';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';

  let { testId }: { testId?: string } = $props();

  const selectedModel$ = selectSelectedModel();
  const defaultReasoningEffort$ = selectDefaultReasoningEffort();
  const activeProviderId$ = selectActiveProviderId();
  const defaultProviderId$ = selectEffectiveDefaultProviderId();

  function handleModelChange(compoundModelId: string) {
    if (!compoundModelId) return;
    const split = splitLegacyCompoundId(compoundModelId);
    const providerId = split.providerId ?? $defaultProviderId$;
    const modelId = split.modelId;
    const currentEffort = $defaultReasoningEffort$;
    const isKnownModel =
      selectModelDisplayName.select(appStore.state, providerId, modelId) !== undefined;
    const supportedEfforts = selectModelEffortLevels.select(appStore.state, compoundModelId);
    if (currentEffort && isKnownModel && !supportedEfforts?.includes(currentEffort)) {
      appStore.dispatch(setDefaultReasoningEffort(''));
    }
    if (providerId && providerId !== $activeProviderId$) {
      appStore.dispatch(setActiveProvider(providerId));
      appStore.dispatch(reloadModelsForProvider());
    }
  }
</script>

<div data-testid={testId} class="flex min-w-0 flex-wrap items-center gap-3">
  <span class="text-sm font-medium text-foreground shrink-0">
    {m.settings_aiBehavior_defaultModel_label()}
  </span>
  <ModelPicker
    selectedModel={$selectedModel$}
    onModelChange={handleModelChange}
    showDefaultOption={false}
    variant="default"
    size="sm"
    updateGlobalDefault
    showReasoning
    reasoningEffort={$defaultReasoningEffort$ || null}
    onReasoningChange={(effort) => {
      appStore.dispatch(setDefaultReasoningEffort(effort ?? ''));
    }}
  />
</div>
