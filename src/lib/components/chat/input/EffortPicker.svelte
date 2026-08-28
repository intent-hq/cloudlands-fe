<script lang="ts">
  /**
   * EffortPicker
   *
   * Session-level reasoning-effort control that sits next to the model picker.
   * Renders only when the session's model advertises `effortLevels` (catalog
   * metadata, PROTOCOL §5.30/§6.7); the canonical select shows Auto followed by
   * each advertised level in catalog order.
   *
   * Auto maps to an explicit `null`, which clears the session field back to the
   * provider default. Committing a selection routes
   * through `applyReasoningEffort`, which owns the session dispatch and the
   * `agent.update` (§5.5) call — the daemon applies the effort on the next
   * prompt send, so queued messages are not snapshotted.
   */

  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { cn } from '$lib/utils';
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import { applyReasoningEffort } from '$features/agent/reasoning-effort';
  import { store as appStore } from '$store/renderer/store';
  import { selectAgentReasoningEffort } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectAgentModelEffortLevels } from '$store/renderer/slices/model/model-selectors';

  interface Props {
    agentId?: string;
    workspaceId?: string;
    disabled?: boolean;
    class?: string;
    mode?: 'popover' | 'embedded';
    effortLevels?: readonly string[];
    effort?: string | null;
    onEffortChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
  }

  let {
    agentId,
    workspaceId,
    disabled = false,
    class: className = '',
    mode = 'popover',
    effortLevels = [],
    effort = null,
    onEffortChange,
  }: Props = $props();

  const agentIdStore = writable(untrack(() => agentId ?? ''));
  $effect(() => {
    agentIdStore.set(agentId ?? '');
  });

  const effortLevels$ = (
    'withStore' in selectAgentModelEffortLevels
      ? selectAgentModelEffortLevels.withStore(appStore)
      : selectAgentModelEffortLevels
  )(agentIdStore);
  const reasoningEffort$ = (
    'withStore' in selectAgentReasoningEffort
      ? selectAgentReasoningEffort.withStore(appStore)
      : selectAgentReasoningEffort
  )(agentIdStore);

  /** Provider-level ids get a translated label; unknown levels render verbatim. */
  const LEVEL_LABELS: Record<string, () => string> = {
    minimal: () => m.chat_effortPicker_level_minimal(),
    low: () => m.chat_effortPicker_level_low(),
    medium: () => m.chat_effortPicker_level_medium(),
    high: () => m.chat_effortPicker_level_high(),
    xhigh: () => m.chat_effortPicker_level_xhigh(),
    max: () => m.chat_effortPicker_level_max(),
  };

  function levelLabel(level: string): string {
    return LEVEL_LABELS[level]?.() ?? level;
  }

  type EffortOption = { value: string; label: string; effort: string | null };

  const AUTO_OPTION_VALUE = 'auto';

  const embedded = $derived(mode === 'embedded');
  const levels = $derived(embedded ? [...effortLevels] : ($effortLevels$ ?? []));
  const hasLevels = $derived((embedded || !!agentId) && levels.length > 0);
  const controlDisabled = $derived(disabled || (!embedded && !workspaceId));

  const options = $derived.by<EffortOption[]>(() => [
    { value: AUTO_OPTION_VALUE, label: m.chat_effortPicker_level_auto(), effort: null },
    ...levels.map((level, index) => ({
      value: `effort-${index}`,
      label: levelLabel(level),
      effort: level,
    })),
  ]);
  const selectItems = $derived(options.map(({ value, label }) => ({ value, label })));

  // An effort the newly selected model does not advertise keeps the underlying
  // provider-default value without guessing which concrete level the provider uses.
  const persistedValue = $derived(embedded ? effort : ($reasoningEffort$ ?? null));
  const persistedOptionValue = $derived.by(() => {
    if (persistedValue === null || persistedValue === undefined) return AUTO_OPTION_VALUE;
    const supportedIndex = levels.indexOf(persistedValue);
    return supportedIndex >= 0 ? `effort-${supportedIndex}` : `unsupported-${persistedValue}`;
  });
  let selectedOptionValue = $state('');
  const selectedLabel = $derived(
    options.find((option) => option.value === selectedOptionValue)?.label ??
      m.chat_effortPicker_level_auto(),
  );
  let selectOpen = $state(false);

  $effect(() => {
    selectedOptionValue = persistedOptionValue;
  });

  async function commit(optionValue: string) {
    const option = options.find((candidate) => candidate.value === optionValue);
    if (!option || controlDisabled) return;

    // Compare against the persisted field: choosing Auto for an effort the
    // model no longer advertises must still clear that stale value on the daemon.
    const previous = persistedValue ?? null;
    if (option.effort === previous) return;

    const applied = embedded
      ? await onEffortChange?.(option.effort)
      : agentId && workspaceId
        ? await applyReasoningEffort(agentId, workspaceId, option.effort, previous)
        : false;
    if (applied === false) selectedOptionValue = persistedOptionValue;
  }
</script>

{#if hasLevels}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (keyboard boundary around an interactive nested select) -->
  <div
    class={cn(embedded ? 'flex items-center justify-between gap-3' : 'w-auto', className)}
    data-testid="effort-picker-content"
    role="group"
    aria-label={m.chat_effortPicker_popover_ariaLabel()}
    onkeydown={(event) => {
      if (event.key === 'Escape' && !selectOpen) return;
      if (event.key === 'Escape') selectOpen = false;
      event.stopPropagation();
    }}
  >
    {#if embedded}
      <span class="type-caption text-muted-foreground">
        {m.chat_effortPicker_title_label()}
      </span>
    {/if}
    <div class={cn(embedded ? 'w-32' : 'min-w-36')}>
      <Select.Root
        bind:value={selectedOptionValue}
        bind:open={selectOpen}
        items={selectItems}
        disabled={controlDisabled}
        onchange={(value) => void commit(value)}
      >
        <Select.Trigger
          class="h-7 px-2 text-xs"
          aria-label={m.chat_effortPicker_trigger_ariaLabel({ level: selectedLabel })}
          data-testid="effort-picker-trigger"
        >
          <span class="min-w-0 flex-1 truncate text-left">
            {#if !embedded}{m.chat_effortPicker_title_label()} ·{' '}
            {/if}{selectedLabel}
          </span>
        </Select.Trigger>
        <Select.Content portal={!embedded} dropUp={!embedded}>
          {#each options as option (option.value)}
            <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
{/if}
