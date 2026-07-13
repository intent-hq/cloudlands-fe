<script lang="ts">
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import {
  faCheck,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
  import Textarea from '../ui/textarea/textarea.svelte';

  interface Props {
    /** Current value (can be a computed/derived value) */
    value: string;
    /** Original value for change detection */
    originalValue?: string;
    placeholder?: string;
    label?: string;
    /** Custom class for the label */
    labelClass?: string;
    description?: string;
    debounceMs?: number;
    minRows?: number;
    /** Maximum character limit (optional) */
    maxLength?: number;
    /** Called when value should be saved */
    onSave: (value: string) => void | Promise<void>;
    /** Called when reset is clicked (only shown if provided) */
    onReset?: () => void;
    class?: string;
  }

  let {
    value,
    originalValue = '',
    placeholder = '',
    label,
    labelClass = 'text-sm font-medium text-foreground',
    description,
    debounceMs = 1000,
    minRows = 8,
    maxLength,
    onSave,
    onReset,
    class: className = '',
  }: Props = $props();

  // Local editable copy of the value
  let localValue = $state(value);
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  let isFocused = $state(false);
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let savedStatusTimeout: ReturnType<typeof setTimeout> | null = null;

  // Sync local value when prop changes (e.g., after reset).
  // Guard: skip while focused to avoid clobbering in-progress edits
  // and losing scroll position when the save round-trips through Redux.
  $effect(() => {
    if (!isFocused) {
      localValue = value;
    }
  });

  const hasChanges = $derived(localValue !== originalValue);

  // Character limit state (only active when maxLength is provided)
  const charCount = $derived(localValue.length);
  const warningThreshold = $derived(maxLength ? Math.floor(maxLength * 0.8) : 0);
  const isOverLimit = $derived(maxLength ? charCount > maxLength : false);
  const isApproachingLimit = $derived(
    maxLength ? charCount > warningThreshold && !isOverLimit : false,
  );
  const charCountPercentage = $derived(
    maxLength ? Math.min(100, Math.round((charCount / maxLength) * 100)) : 0,
  );

  onDestroy(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
  });

  async function save() {
    if (!hasChanges) return;
    // Don't save if over character limit
    if (isOverLimit) return;

    try {
      saveStatus = 'saving';
      await onSave(localValue.trim());
      saveStatus = 'saved';

      if (savedStatusTimeout) clearTimeout(savedStatusTimeout);
      savedStatusTimeout = setTimeout(() => {
        saveStatus = 'idle';
      }, 2000);
    } catch {
      saveStatus = 'idle';
    }
  }

  function handleInput() {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      save();
    }, debounceMs);
  }

  function handleReset() {
    localValue = originalValue;
    saveStatus = 'idle';
    if (debounceTimeout) clearTimeout(debounceTimeout);
    onReset?.();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (debounceTimeout) clearTimeout(debounceTimeout);
      save();
    }
  }
</script>

<div class="h-full flex flex-col gap-2 {className}">
  {#if label || hasChanges}
    <div class="flex items-center justify-between shrink-0">
      {#if label}
        <span class={labelClass}>{label}</span>
      {:else}
        <div></div>
      {/if}
      {#if hasChanges && onReset}
        <button
          type="button"
          onclick={handleReset}
          class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
        >
          <Fa icon={faRotateLeft} class="w-3 h-3" />
          Reset
        </button>
      {/if}
    </div>
  {/if}

  {#if description}
    <p class="text-xs text-subtle shrink-0">{description}</p>
  {/if}

  <div class="relative grow min-h-0 flex flex-col">
    <Textarea
      bind:value={localValue}
      oninput={() => handleInput()}
      onkeydown={handleKeyDown}
      onfocus={() => (isFocused = true)}
      onblur={() => (isFocused = false)}
      {placeholder}
      rows={minRows}
      noFocusStyle
      class="grow {isOverLimit ? 'border-destructive' : ''}"
    ></Textarea>

    <!-- Save indicator -->
    <div
      class="absolute top-2.5 right-3 transition-opacity duration-200 {saveStatus === 'saved'
        ? 'opacity-100'
        : 'opacity-0'}"
    >
      <Fa icon={faCheck} class="w-3.5 h-3.5 text-emerald-500" />
    </div>
  </div>

  <!-- Character limit indicator - only show when approaching or over limit -->
  {#if maxLength && (isApproachingLimit || isOverLimit)}
    <div
      class="flex items-center justify-end text-xs shrink-0 {isOverLimit
        ? 'text-destructive'
        : 'text-warning'}"
    >
      <span>{charCountPercentage}% of limit used</span>
    </div>
  {/if}
</div>

<style>
  /* Textarea should fill its container and scroll internally, not expand */
  .grow :global(textarea) {
    height: 100%;
    resize: none;
    overflow-y: auto;
  }

  /* Warning color fallback if not defined in theme */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }
</style>
