<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';

  import { selectSelectedModel } from '$lib/store/slices/model/model-selectors';
  import { getDispatch } from '$lib/store/utils/utils';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
    selectCustomSpecialists,
    selectSpecialists,
    selectIsBuiltIn,
    selectIsFileBased,
    selectHasOverrides,
    selectEffectiveModel,
    selectEffectiveBehaviorPrompt,
    selectResolvedDefaultModel,
    selectGetFileSpecialist,
    selectSpecialistFilePath,
    selectUserOverrides,
    selectEffectiveCodingAgent,
    selectResolvedDefaultCodingAgent,
  } from '$lib/store/slices/specialists/specialists-selectors';
  import {
    setModelOverride,
    clearModelOverride,
    setBulkModelOverrides,
    setBehaviorPromptOverride,
    clearBehaviorPromptOverride,
    clearAllOverrides,
    createCustomSpecialist,
    updateCustomSpecialist,
    deleteCustomSpecialist,
    deleteFileSpecialist as deleteFileSpecialistAction,
    saveFileSpecialist,
    setCodingAgentOverride,
    clearCodingAgentOverride,
  } from '$lib/store/slices/specialists/specialists-slice';
  import {
    selectActiveProviderId,
    selectEnabledProviderIds,
  } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { setActiveProvider } from '$lib/store/slices/provider-settings/provider-settings-slice';
  import { reloadModelsForProvider } from '$lib/store/slices/model/model-slice';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import AgentRulesEditor from './AgentRulesEditor.svelte';
  import AutoSaveTextarea from './AutoSaveTextarea.svelte';
  import type { AIBehaviorView } from './AIBehaviorSidebar.svelte';
  import Header from '../ui/Header.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { track } from '$lib/services/analytics';
  import { parseCompoundModelId } from '$shared/config/provider-config';

  interface Props {
    activeView: AIBehaviorView;
    onSpecialistCreated?: (id: string) => void;
    onSpecialistDeleted?: () => void;
    onDiscard?: () => void;
  }

  let { activeView, onSpecialistCreated, onSpecialistDeleted, onDiscard }: Props = $props();

  const dispatch = getDispatch();
  const specialists = selectSpecialists();
  const userOverrides = selectUserOverrides();
  const selectedModel = selectSelectedModel();
  const activeProviderId$ = selectActiveProviderId();

  // Check if all specialists already use the currently selected default model
  const allSpecialistsUseSelectedModel = $derived.by(() => {
    void $userOverrides; // track override changes for reactivity
    const specs = $specialists;
    return (
      specs.length > 0 &&
      specs.every(
        (s) => selectEffectiveModel.select(getReduxStore().getState(), s.id) === $selectedModel,
      )
    );
  });

  // Get the default model for new specialists - use the user's current selection
  function getDefaultModel(): string {
    return $selectedModel;
  }

  // New specialist form state
  let newName = $state('');
  let newDescription = $state('');
  let newCodingAgent = $state($activeProviderId$);
  let newModel = $state(getDefaultModel());
  let newPrompt = $state('You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...');

  // Character limits
  const MAX_PROMPT_LENGTH = 50000;
  const WARNING_THRESHOLD = 40000;

  const newPromptCharCount = $derived(newPrompt.length);
  const newPromptIsOverLimit = $derived(newPromptCharCount > MAX_PROMPT_LENGTH);
  const newPromptIsApproachingLimit = $derived(
    newPromptCharCount > WARNING_THRESHOLD && !newPromptIsOverLimit,
  );
  const newPromptPercentage = $derived(
    Math.min(100, Math.round((newPromptCharCount / MAX_PROMPT_LENGTH) * 100)),
  );

  // Reset form when switching to create view
  $effect(() => {
    if (activeView.type === 'create-specialist') {
      newName = '';
      newDescription = '';
      newCodingAgent = $activeProviderId$;
      newModel = getDefaultModel();
      newPrompt = 'You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...';
    }
  });

  // Get current specialist if viewing one
  const currentSpecialist = $derived(
    activeView.type === 'specialist' ? $specialists.find((s) => s.id === activeView.id) : null,
  );

  const isBuiltIn = $derived(
    currentSpecialist
      ? selectIsBuiltIn.select(getReduxStore().getState(), currentSpecialist.id)
      : false,
  );

  const isFileBased = $derived(
    currentSpecialist
      ? selectIsFileBased.select(getReduxStore().getState(), currentSpecialist.id)
      : false,
  );

  const hasOverrides = $derived.by(() => {
    void $userOverrides; // track override changes for reactivity
    return currentSpecialist
      ? selectHasOverrides.select(getReduxStore().getState(), currentSpecialist.id)
      : false;
  });

  const specialistFilePath = $derived(
    currentSpecialist
      ? selectSpecialistFilePath.select(getReduxStore().getState(), currentSpecialist.id)
      : undefined,
  );

  // Local state for specialist model selection
  let specialistCodingAgentValue = $state('');
  let specialistModelValue = $state('');

  // Sync specialist model value when specialist changes or overrides are cleared
  $effect(() => {
    if (currentSpecialist) {
      specialistCodingAgentValue = selectEffectiveCodingAgent.select(getReduxStore().getState(), currentSpecialist.id);
      void $userOverrides; // track override changes
      specialistModelValue = selectEffectiveModel.select(
        getReduxStore().getState(),
        currentSpecialist.id,
      );
    }
  });

  function handleGlobalModelChange(compoundModelId: string) {
    if (!compoundModelId) return;
    const { providerId } = parseCompoundModelId(compoundModelId);
    if (providerId && providerId !== $activeProviderId$) {
      dispatch(setActiveProvider(providerId));
      dispatch(reloadModelsForProvider());
    }
  }

  function handleSpecialistModelChange(compoundModelId: string) {
    if (!currentSpecialist || !compoundModelId) return;

    const { providerId: newProvider } = parseCompoundModelId(compoundModelId);
    specialistCodingAgentValue = newProvider;
    specialistModelValue = compoundModelId;

    if (isBuiltIn) {
      // Update coding agent override
      const resolvedDefaultProvider = selectResolvedDefaultCodingAgent.select(
        getReduxStore().getState(),
        currentSpecialist.id,
      );
      if (newProvider !== resolvedDefaultProvider) {
        dispatch(setCodingAgentOverride(currentSpecialist.id, newProvider));
      } else {
        dispatch(clearCodingAgentOverride(currentSpecialist.id));
      }

      // Update model override
      const resolvedDefaultModel = selectResolvedDefaultModel.select(
        getReduxStore().getState(),
        currentSpecialist.id,
        newProvider,
      );
      if (compoundModelId !== resolvedDefaultModel) {
        dispatch(setModelOverride(currentSpecialist.id, compoundModelId));
      } else {
        dispatch(clearModelOverride(currentSpecialist.id));
      }
    } else if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        getReduxStore().getState(),
        currentSpecialist.id,
      );
      if (fileSpec) {
        dispatch(
          saveFileSpecialist({
            id: fileSpec.id,
            name: fileSpec.name,
            description: fileSpec.description,
            codingAgent: newProvider,
            model: compoundModelId,
            modelTier: fileSpec.modelTier,
            roleReminder: fileSpec.roleReminder,
            behaviorPrompt: fileSpec.behaviorPrompt,
          }),
        );
      }
    } else {
      dispatch(
        updateCustomSpecialist(currentSpecialist.id, {
          codingAgent: newProvider,
          model: compoundModelId,
        }),
      );
    }
  }

  function handleCreateModelChange(compoundModelId: string) {
    if (!compoundModelId) return;
    const { providerId } = parseCompoundModelId(compoundModelId);
    newCodingAgent = providerId;
    newModel = compoundModelId;
  }

  function handlePromptSave(prompt: string) {
    if (!currentSpecialist) return;
    if (isBuiltIn) {
      if (prompt !== currentSpecialist.defaultBehaviorPrompt) {
        dispatch(setBehaviorPromptOverride(currentSpecialist.id, prompt));
      } else {
        dispatch(clearBehaviorPromptOverride(currentSpecialist.id));
      }
    } else if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        getReduxStore().getState(),
        currentSpecialist.id,
      );
      if (fileSpec) {
        dispatch(
          saveFileSpecialist({
            id: fileSpec.id,
            name: fileSpec.name,
            description: fileSpec.description,
            codingAgent: fileSpec.codingAgent,
            model: fileSpec.model,
            modelTier: fileSpec.modelTier,
            roleReminder: fileSpec.roleReminder,
            behaviorPrompt: prompt,
          }),
        );
      }
    } else {
      dispatch(updateCustomSpecialist(currentSpecialist.id, { behaviorPrompt: prompt }));
    }
  }

  function resetAllOverrides() {
    if (!currentSpecialist) return;
    dispatch(clearAllOverrides(currentSpecialist.id));
  }

  function deleteSpecialist() {
    if (!currentSpecialist) return;
    // Capture values before deletion since currentSpecialist is a $derived
    // that will become null once the specialist is removed from the store
    const specialistId = currentSpecialist.id;
    const specialistName = currentSpecialist.name;
    const wasFileBased = isFileBased;
    if (wasFileBased) {
      dispatch(deleteFileSpecialistAction(specialistId));
    } else {
      dispatch(deleteCustomSpecialist(specialistId));
    }
    onSpecialistDeleted?.();
    track('Deleted Specialist', {
      specialist_id: specialistId,
      specialist_name: specialistName,
    });
  }

  function createSpecialist() {
    if (!newName.trim() || newPromptIsOverLimit) return;
    dispatch(
      createCustomSpecialist({
        name: newName.trim(),
        description: newDescription.trim() || 'Custom specialist',
        codingAgent: newCodingAgent,
        model: newModel,
        behaviorPrompt: newPrompt,
      }),
    );
    // Read the newly created specialist ID from state (reducer generates it)
    const customSpecialists = selectCustomSpecialists.select(getReduxStore().getState());
    const created = customSpecialists[customSpecialists.length - 1];
    track('Created Specialist', {
      specialist_name: newName.trim(),
      has_custom_prompt: newPrompt.trim().length > 0,
    });
    if (created) {
      onSpecialistCreated?.(created.id);
    }
  }

  function discardNewSpecialist() {
    newName = '';
    newDescription = '';
    newCodingAgent = $activeProviderId$;
    newModel = getDefaultModel();
    newPrompt = 'You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...';
    onDiscard?.();
  }

  function hasAnyModelOverride(): boolean {
    if (!currentSpecialist) return false;
    const overrides = selectUserOverrides.select(getReduxStore().getState());
    return (
      !!overrides.codingAgentOverrides?.[currentSpecialist.id] ||
      !!overrides.modelOverrides[currentSpecialist.id]
    );
  }
</script>

<div class="editor-container flex-1">
  <!-- System Prompt View -->
  {#if activeView.type === 'system-prompt'}
    <!-- Metadata (empty for system prompt) -->
    <div></div>

    <!-- Global defaults -->
    <div id="default-model" class="mb-6">
      <Header size={3} class="mb-3">Global defaults</Header>
      <div class="space-y-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Default coding agent
        </p>
        <div class="flex items-center gap-2 flex-wrap">
          <ModelPicker
            selectedModel={$selectedModel}
            onModelChange={handleGlobalModelChange}
            showDefaultOption={false}
            variant="default"
            updateGlobalStore
          />
          {#if !allSpecialistsUseSelectedModel}
            <button
              type="button"
              onclick={() => {
                // Batch all overrides into a single action to prevent race conditions
                const overrides = $specialists.reduce(
                  (acc, s) => {
                    acc[s.id] = $selectedModel;
                    return acc;
                  },
                  {} as Record<string, string>
                );
                // Dispatch a single bulk update action instead of looping
                dispatch(setBulkModelOverrides(overrides));
                track('Used Model for All Specialists', { model_id: $selectedModel });
              }}
              class="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer whitespace-nowrap"
            >
              Use for all specialists
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Agent Instructions (1fr) -->
    <div class="min-h-0 h-full">
      <AgentRulesEditor />
    </div>

    <!-- Actions (empty for system prompt) -->
    <div></div>

    <!-- Specialist Editor View -->
  {:else if activeView.type === 'specialist' && currentSpecialist}
    <!-- Metadata -->
    <div class="mb-6">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-medium text-foreground">{currentSpecialist.name}</h2>
        {#if isBuiltIn && hasOverrides}
          <span class="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
            Modified
          </span>
        {/if}
        {#if !isBuiltIn}
          <span class="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">
            Custom
          </span>
        {/if}
      </div>
      <p class="text-xs text-subtle mt-1">{currentSpecialist.description}</p>
    </div>

    <!-- Coding Agent -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Coding Agent
        </h2>
        {#if isBuiltIn && hasAnyModelOverride()}
          <button
            type="button"
            onclick={resetAllOverrides}
            class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Fa icon={faRotateLeft} class="w-3 h-3" />
            Reset
          </button>
        {/if}
      </div>
      <ModelPicker
        selectedModel={specialistModelValue}
        onModelChange={handleSpecialistModelChange}
        showDefaultOption={false}
        size="sm"
        variant="default"
      />
      {#if isBuiltIn && !hasAnyModelOverride()}
        <p class="text-xs text-subtle mt-2">
          Uses the global default unless you override it here.
        </p>
      {/if}
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full">
      <AutoSaveTextarea
        value={selectEffectiveBehaviorPrompt.select(
          getReduxStore().getState(),
          currentSpecialist.id,
        )}
        originalValue={currentSpecialist.defaultBehaviorPrompt}
        label="System Prompt"
        labelClass="text-xs font-medium text-muted-foreground uppercase tracking-wider"
        placeholder="Enter behavior instructions for this specialist..."
        minRows={12}
        maxLength={50000}
        onSave={handlePromptSave}
        onReset={isBuiltIn
          ? () => dispatch(clearBehaviorPromptOverride(currentSpecialist.id))
          : undefined}
      />
    </div>

    <!-- Actions -->
    <div class="pt-4 border-border flex items-center justify-between">
      {#if !isBuiltIn}
        <button
          type="button"
          onclick={deleteSpecialist}
          class="text-sm text-muted-foreground hover:text-destructive-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <Fa icon={faTrash} class="w-3.5 h-3.5" />
          Delete specialist
        </button>
      {:else}
        <div></div>
      {/if}
      {#if specialistFilePath}
        <OpenComboButton filePath={specialistFilePath} isDirectory={false} />
      {/if}
    </div>

    <!-- Create Specialist View -->
  {:else if activeView.type === 'create-specialist'}
    <!-- Metadata -->
    <div class="mb-6">
      <h2 class="text-sm font-medium text-foreground">Create Specialist</h2>
      <p class="text-xs text-subtle mt-1">
        Create a custom specialist with specific behavior and model settings.
      </p>
    </div>

    <!-- Model Picker (combined with name/description for create) -->
    <div class="space-y-4 mb-6">
      <div>
        <label class="text-sm font-medium text-foreground block mb-1.5">Name</label>
        <Input noFocusStyle type="text" bind:value={newName} placeholder="e.g., Code Reviewer" />
      </div>

      <div>
        <label class="text-sm font-medium text-foreground block mb-1.5">Description</label>
        <Input
          noFocusStyle
          type="text"
          bind:value={newDescription}
          placeholder="e.g., Reviews code for quality and best practices"
        />
      </div>

      <div>
        <span class="text-sm font-medium text-foreground block mb-1.5">Coding Agent</span>
        <ModelPicker
          selectedModel={newModel}
          onModelChange={handleCreateModelChange}
          showDefaultOption={false}
          variant="default"
          size="sm"
        />
      </div>
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full flex flex-col gap-1.5">
      <label class="text-sm font-medium text-foreground block shrink-0">System Prompt</label>
      <textarea
        bind:value={newPrompt}
        placeholder="Instructions for this specialist..."
        class="w-full grow p-3 text-sm rounded-lg border border-border bg-background resize-none
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
          {newPromptIsOverLimit ? 'border-destructive' : ''}"
      ></textarea>
      {#if newPromptIsApproachingLimit || newPromptIsOverLimit}
        <div
          class="flex items-center justify-end text-xs shrink-0 {newPromptIsOverLimit
            ? 'text-destructive'
            : 'text-warning'}"
        >
          <span>{newPromptPercentage}% of limit used</span>
        </div>
      {/if}
    </div>

    <!-- Actions -->
    <div class="pt-4 border-border flex justify-end gap-2">
      <Button variant="ghost" onclick={discardNewSpecialist}>Discard</Button>
      <Button
        variant="default"
        onclick={createSpecialist}
        disabled={!newName.trim() || newPromptIsOverLimit}
      >
        <Fa icon={faPlus} class="w-3.5 h-3.5 mr-1.5" />
        Create Specialist
      </Button>
    </div>
  {/if}
</div>

<style>
  .editor-container {
    height: 100%;
    overflow-y: auto;

    display: grid;
    grid-template-rows: min-content min-content 1fr min-content;
  }

  /* Warning color fallback */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }
  .bg-warning\/15 {
    background-color: hsla(38, 92%, 50%, 0.15);
  }
</style>
