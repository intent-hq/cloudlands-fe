<script lang="ts">
  /**
   * Quick Actions Settings Component
   *
   * Allows users to configure default models for quick actions
   * (commit message, PR description, quick tasks) with a general default
   * and per-type overrides.
   */

  import {
  BACKGROUND_AGENT_TYPE_INFO,
  setDefaultModel,
  setTypeOverride,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
  selectHasOverride,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import { selectAvailableModels } from '$store/renderer/slices/model/model-selectors';

  import {
  Dropdown,
  type DropdownOption,
} from '$lib/components/ui/dropdown';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const availableModels$ = selectAvailableModels();
  const defaultModel = selectBgDefaultModel();
  const typeOverrides$ = selectBgTypeOverrides();
  const hasCommitOverride$ = selectHasOverride('commit');
  const hasPrOverride$ = selectHasOverride('pr');
  const hasFastOverride$ = selectHasOverride('fast');

  const USE_DEFAULT_VALUE = '__default__';

  // Local state for type overrides - use '__default__' for empty values
  let commitOverride = $state($typeOverrides$.commit || USE_DEFAULT_VALUE);
  let prOverride = $state($typeOverrides$.pr || USE_DEFAULT_VALUE);
  let fastOverride = $state($typeOverrides$.fast || USE_DEFAULT_VALUE);

  // Sync overrides from store
  $effect(() => {
    commitOverride = $typeOverrides$.commit || USE_DEFAULT_VALUE;
  });
  $effect(() => {
    prOverride = $typeOverrides$.pr || USE_DEFAULT_VALUE;
  });
  $effect(() => {
    fastOverride = $typeOverrides$.fast || USE_DEFAULT_VALUE;
  });

  // Handle override changes - update both local state and store
  function handleOverrideChange(type: 'commit' | 'pr' | 'fast', value: string) {
    // Update local state
    if (type === 'commit') commitOverride = value;
    else if (type === 'pr') prOverride = value;
    else if (type === 'fast') fastOverride = value;

    // Update store (convert sentinel value to empty string)
    const storeValue = value === USE_DEFAULT_VALUE ? '' : value;
    appStore.dispatch(setTypeOverride({ type, model: storeValue }));
  }

  // Model options for override dropdowns - includes "Use default" option
  const overrideModelOptions = $derived<DropdownOption[]>([
    { value: USE_DEFAULT_VALUE, label: m.settings_backgroundAgent_useDefaultOption() },
    ...$availableModels$.map((model) => ({
      value: model.value,
      label: model.label,
    })),
  ]);

  // Get display label for an override value
  function getOverrideLabel(value: string): string {
    if (value === USE_DEFAULT_VALUE) return m.settings_backgroundAgent_useDefaultOption();
    return $availableModels$.find((model) => model.value === value)?.label || value;
  }
</script>

<!-- Default Model -->
<div class="flex items-center justify-between gap-4 mb-6">
  <div class="flex-1 min-w-0">
    <p class="text-sm font-semibold text-foreground">{m.settings_backgroundAgent_defaultModel_label()}</p>
  </div>
  <div class="shrink-0 w-72">
    <!-- Empty defaultModel means "provider default": the daemon/CLI default is
         used because background requests omit `model` on the wire. -->
    <ModelPicker
      selectedModel={$defaultModel || undefined}
      onModelChange={(model) => appStore.dispatch(setDefaultModel(model))}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionDescription={m.settings_backgroundAgent_providerDefault_description()}
      variant="default"
    />
  </div>
</div>

<!-- Per-type Overrides -->
<div>
  <p class="text-sm font-semibold text-foreground mb-3">{m.settings_backgroundAgent_overrides_title()}</p>

  <div class="space-y-4">
    <!-- Commit message -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.commit.label}</span
          >
          {#if $hasCommitOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.commit.description}</p>
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
          {#snippet trigger()}
            <span class="truncate flex-1 text-left">{getOverrideLabel(commitOverride)}</span>
            <Fa icon={faChevronDown} class="h-2! w-2! opacity-50 shrink-0" />
          {/snippet}
        </Dropdown>
      </div>
    </div>

    <!-- PR description -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.pr.label}</span
          >
          {#if $hasPrOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.pr.description}</p>
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
          {#snippet trigger()}
            <span class="truncate flex-1 text-left">{getOverrideLabel(prOverride)}</span>
            <Fa icon={faChevronDown} class="h-2! w-2! opacity-50 shrink-0" />
          {/snippet}
        </Dropdown>
      </div>
    </div>

    <!-- Quick tasks -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.fast.label}</span
          >
          {#if $hasFastOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.fast.description}</p>
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
          {#snippet trigger()}
            <span class="truncate flex-1 text-left">{getOverrideLabel(fastOverride)}</span>
            <Fa icon={faChevronDown} class="h-2! w-2! opacity-50 shrink-0" />
          {/snippet}
        </Dropdown>
      </div>
    </div>
  </div>
</div>
