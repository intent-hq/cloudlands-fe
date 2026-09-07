<script lang="ts">
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectDefaultReasoningEffort,
    selectModelDisplayName,
    selectModelEffortLevels,
    selectSelectedModel,
  } from '$store/renderer/slices/model/model-selectors';
  import { setDefaultReasoningEffort } from '$store/renderer/slices/model/model-slice';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
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
    // Do NOT dispatch setActiveProvider/reloadModelsForProvider here: the
    // ModelPicker below has `updateGlobalDefault` set, so it already
    // dispatches `selectModel(modelId, providerId)` right after this
    // callback returns. That action's saga (model-selection-saga) is the
    // sole owner of persisting the provider+model default — it performs the
    // provider switch (including reload) AND the atomic
    // `model.defaultProvider` + `model.providerDefaults` write. Dispatching
    // setActiveProvider here too raced a second, non-atomic
    // `model.defaultProvider` write from provider-settings-saga against that
    // atomic write, corrupting the persisted default (monorepo#4102-recurrence).
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
  {#if anySpecialistHasExplicitModel}
    <button
      type="button"
      onclick={resetAllSpecialistsToInherit}
      class="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      {m.settings_aiBehavior_resetAllSpecialists()}
    </button>
  {/if}
</div>
