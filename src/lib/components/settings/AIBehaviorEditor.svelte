<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import AgentRulesEditor from './AgentRulesEditor.svelte';
  import AutoSaveTextarea from './AutoSaveTextarea.svelte';
  import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';
  import type { AIBehaviorView } from './AIBehaviorSidebar.svelte';
  import Header from '../ui/Header.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { track } from '$lib/services/analytics';

  interface Props {
    activeView: AIBehaviorView;
    onSpecialistCreated?: (id: string) => void;
    onSpecialistDeleted?: () => void;
    onDiscard?: () => void;
  }

  let { activeView, onSpecialistCreated, onSpecialistDeleted, onDiscard }: Props = $props();

  // Model selection for system prompt
  let selectedModelValue = $state(modelStore.selectedModel);

  // Sync with modelStore
  $effect(() => {
    selectedModelValue = modelStore.selectedModel;
  });

  $effect(() => {
    if (selectedModelValue && selectedModelValue !== modelStore.selectedModel) {
      modelStore.selectModel(selectedModelValue);
    }
  });

  // Get the default model for new specialists - use the user's current selection
  function getDefaultModel(): string {
    return modelStore.selectedModel;
  }

  // New specialist form state
  let newName = $state('');
  let newDescription = $state('');
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
      newModel = getDefaultModel();
      newPrompt = 'You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...';
    }
  });

  // Get current specialist if viewing one
  const currentSpecialist = $derived(
    activeView.type === 'specialist'
      ? specialistsStore.specialists.find((s) => s.id === activeView.id)
      : null,
  );

  const isBuiltIn = $derived(
    currentSpecialist ? specialistsStore.isBuiltIn(currentSpecialist.id) : false,
  );

  const isFileBased = $derived(
    currentSpecialist ? specialistsStore.isFileBased(currentSpecialist.id) : false,
  );

  const hasOverrides = $derived(
    currentSpecialist ? specialistsStore.hasOverrides(currentSpecialist.id) : false,
  );

  const specialistFilePath = $derived(
    currentSpecialist ? specialistsStore.getSpecialistFilePath(currentSpecialist.id) : undefined,
  );

  // Local state for specialist model selection
  let specialistModelValue = $state('');

  // Sync specialist model value when specialist changes or overrides are cleared
  $effect(() => {
    if (currentSpecialist) {
      specialistModelValue = specialistsStore.getEffectiveModel(currentSpecialist.id);
    }
  });

  // Handle specialist model changes — only called when the user explicitly picks a model
  function handleSpecialistModelChange(newModel: string) {
    if (!currentSpecialist || !newModel) return;

    if (isBuiltIn) {
      // Get the resolved default model for the current provider (from tier)
      const resolvedDefault = specialistsStore.getResolvedDefaultModel(currentSpecialist.id);
      if (newModel !== resolvedDefault) {
        specialistsStore.setModelOverride(currentSpecialist.id, newModel);
      } else {
        specialistsStore.clearModelOverride(currentSpecialist.id);
      }
    } else if (isFileBased) {
      const fileSpec = specialistsStore.getFileSpecialist(currentSpecialist.id);
      if (fileSpec) {
        specialistsStore.saveFileSpecialist({
          id: fileSpec.id,
          name: fileSpec.name,
          description: fileSpec.description,
          model: newModel,
          modelTier: fileSpec.modelTier,
          roleReminder: fileSpec.roleReminder,
          behaviorPrompt: fileSpec.behaviorPrompt,
        });
      }
    } else {
      specialistsStore.updateCustomSpecialist(currentSpecialist.id, {
        model: newModel,
      });
    }
  }

  function handlePromptSave(prompt: string) {
    if (!currentSpecialist) return;
    if (isBuiltIn) {
      if (prompt !== currentSpecialist.defaultBehaviorPrompt) {
        specialistsStore.setBehaviorPromptOverride(currentSpecialist.id, prompt);
      } else {
        specialistsStore.clearBehaviorPromptOverride(currentSpecialist.id);
      }
    } else if (isFileBased) {
      const fileSpec = specialistsStore.getFileSpecialist(currentSpecialist.id);
      if (fileSpec) {
        specialistsStore.saveFileSpecialist({
          id: fileSpec.id,
          name: fileSpec.name,
          description: fileSpec.description,
          model: fileSpec.model,
          modelTier: fileSpec.modelTier,
          roleReminder: fileSpec.roleReminder,
          behaviorPrompt: prompt,
        });
      }
    } else {
      specialistsStore.updateCustomSpecialist(currentSpecialist.id, { behaviorPrompt: prompt });
    }
  }

  function resetAllOverrides() {
    if (!currentSpecialist) return;
    specialistsStore.clearAllOverrides(currentSpecialist.id);
  }

  function deleteSpecialist() {
    if (!currentSpecialist) return;
    // Capture values before deletion since currentSpecialist is a $derived
    // that will become null once the specialist is removed from the store
    const specialistId = currentSpecialist.id;
    const specialistName = currentSpecialist.name;
    const wasFileBased = isFileBased;
    if (wasFileBased) {
      specialistsStore.deleteFileSpecialist(specialistId);
    } else {
      specialistsStore.deleteCustomSpecialist(specialistId);
    }
    onSpecialistDeleted?.();
    track('Deleted Specialist', {
      specialist_id: specialistId,
      specialist_name: specialistName,
    });
  }

  function createSpecialist() {
    if (!newName.trim() || newPromptIsOverLimit) return;
    const created = specialistsStore.createCustomSpecialist({
      name: newName.trim(),
      description: newDescription.trim() || 'Custom specialist',
      model: newModel,
      behaviorPrompt: newPrompt,
    });
    track('Created Specialist', {
      specialist_name: newName.trim(),
      has_custom_prompt: newPrompt.trim().length > 0,
    });
    onSpecialistCreated?.(created.id);
  }

  function discardNewSpecialist() {
    newName = '';
    newDescription = '';
    newModel = getDefaultModel();
    newPrompt = 'You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...';
    onDiscard?.();
  }

  function hasModelOverride(): boolean {
    if (!currentSpecialist) return false;
    return !!specialistsStore.userOverrides.modelOverrides[currentSpecialist.id];
  }
</script>

<div class="editor-container flex-1">
  <!-- System Prompt View -->
  {#if activeView.type === 'system-prompt'}
    <!-- Metadata (empty for system prompt) -->
    <div></div>

    <!-- Model Picker -->
    <div id="default-model" class="mb-6">
      <Header size={3} class="mb-3">Default Model</Header>
      <ModelPicker
        bind:selectedModel={selectedModelValue}
        showDefaultOption={false}
        variant="default"
        updateGlobalStore
      />
    </div>

    <!-- Agent Instructions (1fr) -->
    <div class="min-h-0 h-full">
      <AgentRulesEditor />
    </div>

    <!-- Actions (empty for system prompt) -->
    <div></div>

    <!-- Background Agents View -->
  {:else if activeView.type === 'background-agents'}
    <BackgroundAgentSettings />

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
      <p class="text-xs text-muted-foreground mt-1">{currentSpecialist.description}</p>
    </div>

    <!-- Model Picker -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Default Model
        </h2>
        {#if isBuiltIn && hasModelOverride()}
          <button
            type="button"
            onclick={() => specialistsStore.clearModelOverride(currentSpecialist.id)}
            class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Fa icon={faRotateLeft} class="w-3 h-3" />
            Reset
          </button>
        {/if}
      </div>
      <ModelPicker
        bind:selectedModel={specialistModelValue}
        onModelChange={handleSpecialistModelChange}
        showDefaultOption={false}
        size="sm"
        variant="default"
      />
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full">
      <AutoSaveTextarea
        value={specialistsStore.getEffectiveBehaviorPrompt(currentSpecialist.id)}
        originalValue={currentSpecialist.defaultBehaviorPrompt}
        label="System Prompt"
        labelClass="text-xs font-medium text-muted-foreground uppercase tracking-wider"
        placeholder="Enter behavior instructions for this specialist..."
        minRows={12}
        maxLength={50000}
        onSave={handlePromptSave}
        onReset={isBuiltIn
          ? () => specialistsStore.clearBehaviorPromptOverride(currentSpecialist.id)
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
      <p class="text-xs text-muted-foreground mt-1">
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
        <span class="text-sm font-medium text-foreground block mb-1.5">Default Model</span>
        <ModelPicker
          bind:selectedModel={newModel}
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
