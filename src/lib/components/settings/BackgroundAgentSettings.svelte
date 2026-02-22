<script lang="ts">
  /**
   * Quick Actions Settings Component
   *
   * Allows users to configure default models for quick actions
   * (commit message, PR description, quick tasks) with a general default
   * and per-type overrides.
   */

  import {
    backgroundAgentSettingsStore,
    BACKGROUND_AGENT_TYPE_INFO,
  } from '$lib/stores/background-agent-settings.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { Dropdown, type DropdownOption } from '$lib/components/ui/dropdown';
  import Header from '../ui/Header.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';

  const USE_DEFAULT_VALUE = '__default__';

  // Local state for default model
  let defaultModelValue = $state(backgroundAgentSettingsStore.defaultModel);

  // Sync default model from store
  $effect(() => {
    defaultModelValue = backgroundAgentSettingsStore.defaultModel;
  });

  // Local state for type overrides - use '__default__' for empty values
  let commitOverride = $state(backgroundAgentSettingsStore.typeOverrides.commit || USE_DEFAULT_VALUE);
  let prOverride = $state(backgroundAgentSettingsStore.typeOverrides.pr || USE_DEFAULT_VALUE);
  let fastOverride = $state(backgroundAgentSettingsStore.typeOverrides.fast || USE_DEFAULT_VALUE);

  // Sync overrides from store
  $effect(() => {
    commitOverride = backgroundAgentSettingsStore.typeOverrides.commit || USE_DEFAULT_VALUE;
  });
  $effect(() => {
    prOverride = backgroundAgentSettingsStore.typeOverrides.pr || USE_DEFAULT_VALUE;
  });
  $effect(() => {
    fastOverride = backgroundAgentSettingsStore.typeOverrides.fast || USE_DEFAULT_VALUE;
  });

  // Handle override changes - update both local state and store
  function handleOverrideChange(type: 'commit' | 'pr' | 'fast', value: string) {
    // Update local state
    if (type === 'commit') commitOverride = value;
    else if (type === 'pr') prOverride = value;
    else if (type === 'fast') fastOverride = value;

    // Update store (convert sentinel value to empty string)
    const storeValue = value === USE_DEFAULT_VALUE ? '' : value;
    backgroundAgentSettingsStore.setTypeOverride(type, storeValue);
  }

  // Model options for override dropdowns - includes "Use default" option
  const overrideModelOptions = $derived<DropdownOption[]>([
    { value: USE_DEFAULT_VALUE, label: 'Use default quick action model' },
    ...modelStore.availableModels.map((model) => ({
      value: model.value,
      label: model.label,
    })),
  ]);

  // Get display label for an override value
  function getOverrideLabel(value: string): string {
    if (value === USE_DEFAULT_VALUE) return 'Use default quick action model';
    return modelStore.getModelLabel(value) || value;
  }
</script>

<!-- Page intro -->
<p class="text-muted-foreground mb-6">
  Quick actions handle things like generating commit messages, writing PR descriptions, and reviewing code changes.
</p>

<!-- Default Model -->
<div id="utility-default-model" class="mb-6">
  <Header size={3} class="mb-3">Default quick action model</Header>
  <p class="text-muted-foreground mb-3">
    Used for all quick actions unless overridden below.
  </p>
  <ModelPicker
    bind:selectedModel={defaultModelValue}
    onModelChange={(model) => backgroundAgentSettingsStore.setDefaultModel(model)}
    showManageLink={false}
    showDefaultOption={false}
    variant="default"
  />
</div>

<!-- Per-type Overrides -->
<div>
  <Header size={3} class="mb-3">Per-action overrides</Header>
  <p class="text-muted-foreground mb-4">
    Override the default model for specific actions.
  </p>

  <div class="space-y-4">
    <!-- Commit message -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-foreground">{BACKGROUND_AGENT_TYPE_INFO.commit.label}</span>
          {#if backgroundAgentSettingsStore.hasOverride('commit')}
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Custom</span>
          {/if}
        </div>
        <p class="text-muted-foreground mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.commit.description}</p>
      </div>
      <div class="shrink-0 w-72">
        <Dropdown
          value={commitOverride}
          options={overrideModelOptions}
          onchange={(value) => handleOverrideChange('commit', value as string)}
          variant="default"
          size="sm"
          contentClass="min-w-[280px]"
        >
          {#snippet trigger({ open: _open, value: _value })}
            <span class="truncate">{getOverrideLabel(commitOverride)}</span>
          {/snippet}
        </Dropdown>
      </div>
    </div>

    <!-- PR description -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-foreground">{BACKGROUND_AGENT_TYPE_INFO.pr.label}</span>
          {#if backgroundAgentSettingsStore.hasOverride('pr')}
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Custom</span>
          {/if}
        </div>
        <p class="text-muted-foreground mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.pr.description}</p>
      </div>
      <div class="shrink-0 w-72">
        <Dropdown
          value={prOverride}
          options={overrideModelOptions}
          onchange={(value) => handleOverrideChange('pr', value as string)}
          variant="default"
          size="sm"
          contentClass="min-w-[280px]"
        >
          {#snippet trigger({ open: _open, value: _value })}
            <span class="truncate">{getOverrideLabel(prOverride)}</span>
          {/snippet}
        </Dropdown>
      </div>
    </div>

    <!-- Quick tasks -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-foreground">{BACKGROUND_AGENT_TYPE_INFO.fast.label}</span>
          {#if backgroundAgentSettingsStore.hasOverride('fast')}
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Custom</span>
          {/if}
        </div>
        <p class="text-muted-foreground mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.fast.description}</p>
      </div>
      <div class="shrink-0 w-72">
        <Dropdown
          value={fastOverride}
          options={overrideModelOptions}
          onchange={(value) => handleOverrideChange('fast', value as string)}
          variant="default"
          size="sm"
          contentClass="min-w-[280px]"
        >
          {#snippet trigger({ open: _open, value: _value })}
            <span class="truncate">{getOverrideLabel(fastOverride)}</span>
          {/snippet}
        </Dropdown>
      </div>
    </div>
  </div>
</div>
