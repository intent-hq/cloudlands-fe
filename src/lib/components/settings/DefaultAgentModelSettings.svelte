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
  import {
    selectBundledSpecialists,
    selectFileSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import {
    deleteFileSpecialist as deleteFileSpecialistAction,
    saveFileSpecialist,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import {
    buildResetToInheritPayloads,
    hasExplicitModelPin,
  } from './utils/reset-specialists-to-inherit';

  interface Props {
    testId?: string;
    /** Explicit owner for settings opened outside a workspace route. */
    workspaceId?: WorkspaceId | null;
  }

  let { testId, workspaceId }: Props = $props();

  const selectedModel$ = selectSelectedModel();
  const defaultReasoningEffort$ = selectDefaultReasoningEffort();
  const activeProviderId$ = selectActiveProviderId();
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const fileSpecialists$ = selectFileSpecialists();
  const routeWorkspaceContext = getWorkspaceRouteContext();
  const routeWorkspaceId = $derived(
    workspaceId !== undefined ? workspaceId : routeWorkspaceContext?.workspaceId,
  );

  // Show the reset-all button when any specialist pins an explicit
  // frontmatter model instead of inheriting.
  const anySpecialistHasExplicitModel = $derived(hasExplicitModelPin($fileSpecialists$));

  function getCurrentWorkspacePath(): string | undefined {
    if (!routeWorkspaceId) return undefined;
    const workspace = selectWorkspaceById.select(appStore.state, routeWorkspaceId);
    return workspace?.path ?? workspace?.worktreePath ?? workspace?.repositoryPath;
  }

  /**
   * Clear the explicit model pin from every file specialist that
   * has one so they all inherit the global default. Built-ins without an
   * override file already inherit — no file is created for them. Built-in
   * overrides that become identical to the bundled defaults once the pin
   * is cleared are deleted instead of rewritten (monorepo#1450).
   */
  function resetAllSpecialistsToInherit() {
    const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
    const { saves, deletes } = buildResetToInheritPayloads(
      $fileSpecialists$,
      bundledSpecialists,
      getCurrentWorkspacePath,
    );
    for (const payload of saves) {
      appStore.dispatch(saveFileSpecialist(payload));
    }
    for (const ref of deletes) {
      appStore.dispatch(deleteFileSpecialistAction(ref));
    }
  }

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

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'default-agent-model-section',
          title: m.settings_section_defaults(),
          entries: [
            {
              kind: 'custom',
              id: 'default-agent-model',
              label: m.settings_aiBehavior_defaultModel_label(),
              class: 'md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet defaultModelControl(_: SettingsControlContext)}
  <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
    {#if anySpecialistHasExplicitModel}
      <Button type="button" variant="link" size="sm" onclick={resetAllSpecialistsToInherit}>
        {m.settings_aiBehavior_resetAllSpecialists()}
      </Button>
    {/if}
  </div>
{/snippet}

<div data-testid={testId}>
  <SettingsForm
    {schema}
    embedded
    custom={defineSettingsCustomControls({ 'default-agent-model': defaultModelControl })}
  />
</div>
