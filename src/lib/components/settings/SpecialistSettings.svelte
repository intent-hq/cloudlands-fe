<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faRotateLeft,
    faPlus,
    faTrash,
    faFolderOpen,
    faFileExport,
    faFile,
  } from '@fortawesome/free-solid-svg-icons';
  import { Dropdown, type DropdownOption, type DropdownGroup } from '$lib/components/ui/dropdown';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { additionalAgentsStore } from '$lib/stores/additional-agents.store.svelte';
  import type { Specialist } from '$lib/constants/specialists';
  import SettingsCard from './SettingsCard.svelte';
  import AutoSaveTextarea from './AutoSaveTextarea.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '../ui/input/input.svelte';
  import Textarea from '../ui/textarea/textarea.svelte';
  import AuggieAvatar from '../ui/auggie-avatar/AuggieAvatar.svelte';
  import { track } from '$lib/services/analytics';

  interface Props {
    /** Specialist ID to auto-expand on mount (from URL query parameter) */
    initialExpandedId?: string | null;
  }

  let { initialExpandedId = null }: Props = $props();

  // Track which specialist is expanded
  let expandedId = $state<string | null>(null);

  // Refs to specialist card elements for scrolling
  let cardRefs = $state<Record<string, HTMLDivElement | null>>({});

  // Sync with initialExpandedId when it changes (e.g., from URL parameter)
  $effect(() => {
    if (initialExpandedId) {
      expandedId = initialExpandedId;
      // Scroll to the specialist card after a short delay for DOM update
      setTimeout(() => {
        const cardEl = cardRefs[initialExpandedId];
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  });

  // Create mode state
  let isCreating = $state(false);
  let newName = $state('');
  let newDescription = $state('');
  let newModel = $state(getDefaultModel());
  let newPrompt = $state('');

  // Get the default model for new specialists - use the user's current selection
  function getDefaultModel(): string {
    return modelStore.selectedModel;
  }

  // Character limit for specialist prompts
  const MAX_PROMPT_LENGTH = 50000;
  const WARNING_THRESHOLD = 40000; // 80%

  // Character limit state for new specialist form
  const newPromptCharCount = $derived(newPrompt.length);
  const newPromptIsOverLimit = $derived(newPromptCharCount > MAX_PROMPT_LENGTH);
  const newPromptIsApproachingLimit = $derived(
    newPromptCharCount > WARNING_THRESHOLD && !newPromptIsOverLimit,
  );
  const newPromptPercentage = $derived(
    Math.min(100, Math.round((newPromptCharCount / MAX_PROMPT_LENGTH) * 100)),
  );

  // Derive model options from modelStore
  const modelOptions = $derived<DropdownOption[]>(
    modelStore.availableModels.map((model) => ({
      value: model.value,
      label: model.label,
    })),
  );

  // Check if we have multiple providers enabled
  const enabledProviderIds = $derived(additionalAgentsStore.getEnabledProviderIds());
  const hasMultipleProviders = $derived(enabledProviderIds.length > 1);

  // Derive grouped model options (for multi-provider mode)
  const modelGroups = $derived<DropdownGroup[]>(
    modelStore.getGroupedModels().map((group) => ({
      key: group.providerId,
      label: group.providerDisplayName,
      options: group.models.map((m) => ({
        value: m.value,
        label: m.label,
      })),
    })),
  );

  // Check if the specialist ID is a built-in specialist type
  function isBuiltInSpecialistId(
    id: string,
  ): id is 'spec-writer' | 'implementor' | 'verifier' | 'pr-reviewer' | 'ui-designer' {
    return (
      id === 'spec-writer' ||
      id === 'implementor' ||
      id === 'verifier' ||
      id === 'pr-reviewer' ||
      id === 'ui-designer'
    );
  }

  function toggleExpanded(specialistId: string) {
    expandedId = expandedId === specialistId ? null : specialistId;
    isCreating = false;
  }

  function handleModelChange(specialist: Specialist, newModel: string) {
    if (specialistsStore.isBuiltIn(specialist.id)) {
      // Get the resolved default model for the current provider (from tier)
      const resolvedDefault = specialistsStore.getResolvedDefaultModel(specialist.id);
      if (newModel !== resolvedDefault) {
        specialistsStore.setModelOverride(specialist.id, newModel);
      } else {
        specialistsStore.clearModelOverride(specialist.id);
      }
    } else {
      specialistsStore.updateCustomSpecialist(specialist.id, { model: newModel });
    }
  }

  function handlePromptSave(specialist: Specialist, prompt: string) {
    if (specialistsStore.isBuiltIn(specialist.id)) {
      if (prompt !== specialist.defaultBehaviorPrompt) {
        specialistsStore.setBehaviorPromptOverride(specialist.id, prompt);
      } else {
        specialistsStore.clearBehaviorPromptOverride(specialist.id);
      }
    } else {
      specialistsStore.updateCustomSpecialist(specialist.id, { behaviorPrompt: prompt });
    }
  }

  function resetAllOverrides(specialist: Specialist) {
    specialistsStore.clearAllOverrides(specialist.id);
  }

  function deleteSpecialist(specialistId: string) {
    const specialistName = specialistsStore.specialists.find(s => s.id === specialistId)?.name;
    const isFile = specialistsStore.isFileBased(specialistId);
    if (isFile) {
      specialistsStore.deleteFileSpecialist(specialistId);
    } else {
      specialistsStore.deleteCustomSpecialist(specialistId);
    }
    expandedId = null;
    track('Deleted Specialist', {
      specialist_id: specialistId,
      specialist_name: specialistName,
    });
  }

  function getEffectiveModel(specialist: Specialist): string {
    return specialistsStore.getEffectiveModel(specialist.id);
  }

  function getModelLabel(modelValue: string): string {
    return modelStore.getModelLabel(modelValue);
  }

  function hasOverrides(specialist: Specialist): boolean {
    return specialistsStore.hasOverrides(specialist.id);
  }

  function hasModelOverride(specialist: Specialist): boolean {
    return !!specialistsStore.userOverrides.modelOverrides[specialist.id];
  }

  /**
   * Get the source of a specialist for badge display
   */
  function getSpecialistSource(specialist: Specialist): 'file' | 'builtin' | 'custom' {
    if (specialistsStore.isFileBased(specialist.id)) return 'file';
    if (specialistsStore.isBuiltIn(specialist.id)) return 'builtin';
    return 'custom';
  }

  /**
   * Check if a built-in specialist can be exported to file
   */
  function canExportToFile(specialist: Specialist): boolean {
    return (
      specialistsStore.isBuiltIn(specialist.id) && !specialistsStore.isFileBased(specialist.id)
    );
  }

  /**
   * Export a built-in specialist to a file for customization
   */
  async function exportToFile(specialist: Specialist) {
    const success = await specialistsStore.exportBuiltinToFile(specialist.id);
    if (success) {
      // Specialist is now file-based, UI will update automatically
    }
  }

  /**
   * Open the specialists folder in the file explorer
   */
  async function openSpecialistsFolder() {
    await specialistsStore.openSpecialistsFolder();
  }

  function startCreating() {
    isCreating = true;
    expandedId = null;
    newName = '';
    newDescription = '';
    newModel = getDefaultModel();
    newPrompt = 'You are a specialist agent.\n\nYour job is to:\n1. ...\n2. ...\n3. ...';
  }

  function cancelCreate() {
    isCreating = false;
  }

  function createSpecialist() {
    if (!newName.trim()) return;
    // Don't create if over character limit
    if (newPromptIsOverLimit) return;

    specialistsStore.createCustomSpecialist({
      name: newName.trim(),
      description: newDescription.trim() || 'Custom specialist',
      model: newModel,
      behaviorPrompt: newPrompt,
    });

    track('Created Specialist', {
      specialist_name: newName.trim(),
      has_custom_prompt: newPrompt.trim().length > 0,
    });

    isCreating = false;
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-start justify-between">
    <div>
      <h3 class="text-lg font-semibold text-foreground">Specialists</h3>
      <p class="text-sm text-muted-foreground mt-1">
        Customize AI specialists with specific models and behavior prompts.
      </p>
    </div>
    <button
      type="button"
      onclick={openSpecialistsFolder}
      class="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded-md hover:bg-muted/50"
      title="Open specialists folder (~/.augment/specialists/)"
    >
      <Fa icon={faFolderOpen} class="w-3.5 h-3.5" />
      <span>Open Folder</span>
    </button>
  </div>

  <!-- Specialist Cards -->
  <div class="space-y-3">
    {#each specialistsStore.specialists as specialist (specialist.id)}
      {@const isExpanded = expandedId === specialist.id}
      {@const isBuiltIn = specialistsStore.isBuiltIn(specialist.id)}
      {@const isFileBased = specialistsStore.isFileBased(specialist.id)}
      {@const source = getSpecialistSource(specialist)}
      {@const isCustomized = isBuiltIn && !isFileBased && hasOverrides(specialist)}

      <div bind:this={cardRefs[specialist.id]}>
        <SettingsCard
          title={specialist.name}
          description={specialist.description}
          expanded={isExpanded}
          onToggle={() => toggleExpanded(specialist.id)}
          badges={[
            ...(isFileBased ? [{ label: 'File', variant: 'default' as const }] : []),
            ...(isCustomized ? [{ label: 'Modified', variant: 'primary' as const }] : []),
            ...(source === 'custom' ? [{ label: 'Custom', variant: 'warning' as const }] : []),
          ]}
        >
          {#snippet icon()}
            {#if isBuiltInSpecialistId(specialist.id)}
              <AuggieAvatar
                faceSeed="blank"
                colorSeed="blank"
                size={22}
                class="mt-1"
                specialist={specialist.id}
              />
            {:else}
              <AuggieAvatar faceSeed="blank" colorSeed="blank" class="mt-1" size={22} />
            {/if}
          {/snippet}

          {#snippet preview()}
            <span class="text-xs">{getModelLabel(getEffectiveModel(specialist))}</span>
          {/snippet}

          <!-- Model Selection -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-foreground">Default model</span>
              {#if isBuiltIn && hasModelOverride(specialist)}
                <button
                  type="button"
                  onclick={() => specialistsStore.clearModelOverride(specialist.id)}
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Fa icon={faRotateLeft} class="w-3 h-3" />
                  Reset
                </button>
              {/if}
            </div>
            <Dropdown
              value={getEffectiveModel(specialist)}
              options={hasMultipleProviders ? [] : modelOptions}
              groups={hasMultipleProviders ? modelGroups : []}
              onchange={(value) => handleModelChange(specialist, value as string)}
              variant="default"
              size="sm"
              searchable={false}
              contentClass="min-w-[280px]"
              class="w-full"
            >
              {#snippet trigger({ open: _open, value: _value })}
                <span class="inline-flex items-center justify-between w-full">
                  <span class="truncate">{getModelLabel(getEffectiveModel(specialist))}</span>
                  {#if isBuiltIn && hasModelOverride(specialist)}
                    <span class="text-[10px] text-primary font-medium ml-2">Custom</span>
                  {/if}
                </span>
              {/snippet}
            </Dropdown>
          </div>

          <!-- Behavior Prompt with Auto-Save -->
          <AutoSaveTextarea
            value={specialistsStore.getEffectiveBehaviorPrompt(specialist.id)}
            originalValue={specialist.defaultBehaviorPrompt}
            label="System Prompt"
            placeholder="Enter behavior instructions for this specialist..."
            minRows={10}
            maxLength={50000}
            onSave={(value) => handlePromptSave(specialist, value)}
            onReset={isBuiltIn
              ? () => specialistsStore.clearBehaviorPromptOverride(specialist.id)
              : undefined}
          />

          <!-- Footer Actions -->
          <div class="pt-2 border-t border-border/30 flex items-center justify-between">
            <div class="flex items-center gap-3">
              {#if isFileBased}
                <!-- File-based specialist: show file path and delete option -->
                {@const fileSpec = specialistsStore.getFileSpecialist(specialist.id)}
                <span class="text-xs text-muted-foreground flex items-center gap-1">
                  <Fa icon={faFile} class="w-3 h-3" />
                  {fileSpec?.filePath ? fileSpec.filePath.split('/').pop() : 'File-based'}
                </span>
                <button
                  type="button"
                  onclick={() => deleteSpecialist(specialist.id)}
                  class="text-sm text-muted-foreground hover:text-destructive-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Fa icon={faTrash} class="w-3.5 h-3.5" />
                  Delete file
                </button>
              {:else if isBuiltIn && isCustomized}
                <button
                  type="button"
                  onclick={() => resetAllOverrides(specialist)}
                  class="text-sm text-muted-foreground hover:text-destructive-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Fa icon={faRotateLeft} class="w-3.5 h-3.5" />
                  Reset all customizations
                </button>
              {:else if source === 'custom'}
                <button
                  type="button"
                  onclick={() => deleteSpecialist(specialist.id)}
                  class="text-sm text-muted-foreground hover:text-destructive-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Fa icon={faTrash} class="w-3.5 h-3.5" />
                  Delete specialist
                </button>
              {/if}
            </div>
            <!-- Export to file button for built-in specialists -->
            {#if canExportToFile(specialist)}
              <button
                type="button"
                onclick={() => exportToFile(specialist)}
                class="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Export to file for easy editing and sharing"
              >
                <Fa icon={faFileExport} class="w-3.5 h-3.5" />
                Export to file
              </button>
            {/if}
          </div>
        </SettingsCard>
      </div>
    {/each}

    <!-- Create New Specialist -->
    {#if isCreating}
      <div class="rounded-xl border border-border bg-card p-4 space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="font-medium text-foreground">New Specialist</h4>
          <button
            type="button"
            onclick={cancelCreate}
            class="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Cancel
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <span class="text-sm font-medium text-foreground block mb-1.5">Name</span>
            <Input
              noFocusStyle
              type="text"
              bind:value={newName}
              placeholder="e.g., Code Reviewer"
            />
          </div>

          <div>
            <span class="text-sm font-medium text-foreground block mb-1.5">Description</span>
            <Input
              noFocusStyle
              type="text"
              bind:value={newDescription}
              placeholder="e.g., Reviews code for quality and best practices"
            />
          </div>

          <div>
            <span class="text-sm font-medium text-foreground block mb-1.5">Default model</span>
            <Dropdown
              bind:value={newModel}
              options={hasMultipleProviders ? [] : modelOptions}
              groups={hasMultipleProviders ? modelGroups : []}
              variant="default"
              size="sm"
              searchable={false}
              contentClass="min-w-[280px]"
              class="w-full"
            />
          </div>

          <div>
            <span class="text-sm font-medium text-foreground block mb-1.5">System Prompt</span>
            <Textarea
              bind:value={newPrompt}
              rows={6}
              placeholder="Instructions for this specialist..."
              style="field-sizing: content; min-height: 120px;"
              noFocusStyle
              class={newPromptIsOverLimit ? 'border-destructive' : ''}
            ></Textarea>
            <!-- Character limit indicator - only show when approaching or over limit -->
            {#if newPromptIsApproachingLimit || newPromptIsOverLimit}
              <div
                class="flex items-center justify-end mt-1 text-xs {newPromptIsOverLimit
                  ? 'text-destructive'
                  : 'text-warning'}"
              >
                <span>{newPromptPercentage}% of limit used</span>
              </div>
            {/if}
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onclick={cancelCreate}>Cancel</Button>
          <Button
            variant="default"
            size="sm"
            onclick={createSpecialist}
            disabled={!newName.trim() || newPromptIsOverLimit}
          >
            <Fa icon={faPlus} class="w-3.5 h-3.5 mr-1.5" />
            Create Specialist
          </Button>
        </div>
      </div>
    {:else}
      <button
        type="button"
        onclick={startCreating}
        class="w-full text-left px-4 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-colors flex items-center gap-3 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <Fa icon={faPlus} class="w-4 h-4" />
        <span class="text-sm">Create custom specialist</span>
      </button>
    {/if}
  </div>
</div>

<style>
  /* Warning color fallback if not defined in theme */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }
</style>
