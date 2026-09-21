<script lang="ts" generics="T">
  import { onDestroy, type Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import UnsavedIndicator from './UnsavedIndicator.svelte';
  import type { AutoSaveControl, SaveStatus } from './types';

  interface Props {
    value: T;
    originalValue?: T;
    onSave: (value: T) => void | Promise<void>;
    children: Snippet<[AutoSaveControl<T>]>;
    debounceMs?: number;
    savedFlashMs?: number;
    disabled?: boolean;
    canSave?: (value: T) => boolean;
    prepare?: (value: T) => T;
    equals?: (left: T, right: T) => boolean;
    statusLabel?: (status: SaveStatus) => string | undefined;
    class?: string;
  }

  let {
    value,
    // svelte-ignore state_referenced_locally - intentional initial fallback for uncontrolled baselines
    originalValue = value,
    onSave,
    children,
    debounceMs = 1000,
    savedFlashMs = 2000,
    disabled = false,
    canSave = () => true,
    prepare = (draft) => draft,
    equals = Object.is,
    statusLabel,
    class: className,
  }: Props = $props();

  // svelte-ignore state_referenced_locally - external changes are synchronized by the effect below
  let localValue = $state(value) as T;
  let status = $state<SaveStatus>('idle');
  let focused = $state(false);
  // svelte-ignore state_referenced_locally - comparison sentinel for the synchronization effect
  let lastPropValue = value;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  const dirty = $derived(!equals(localValue, originalValue));
  const control = $derived<AutoSaveControl<T>>({
    value: localValue,
    update,
    onfocus: () => (focused = true),
    onblur: handleBlur,
    onkeydown: handleKeydown,
    disabled,
    status,
  });

  $effect(() => {
    if (!equals(value, lastPropValue)) {
      lastPropValue = value;
      if (!focused) {
        localValue = value;
        status = 'idle';
      }
    }
  });

  function clearDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  async function save() {
    if (disabled || !dirty || !canSave(localValue) || status === 'saving') return;
    status = 'saving';
    try {
      await onSave(prepare(localValue));
      status = 'saved';
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (status = dirty ? 'unsaved' : 'idle'), savedFlashMs);
    } catch {
      status = 'error';
    }
  }

  function update(next: T) {
    localValue = next;
    status = equals(next, originalValue) ? 'idle' : 'unsaved';
    clearDebounce();
    if (!disabled && canSave(next) && !equals(next, originalValue)) {
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void save();
      }, debounceMs);
    }
  }

  function flush() {
    if (!debounceTimer) return;
    clearDebounce();
    void save();
  }

  function handleBlur() {
    flush();
    focused = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      clearDebounce();
      void save();
    }
  }

  onDestroy(() => {
    clearDebounce();
    if (savedTimer) clearTimeout(savedTimer);
  });

  export { flush };
</script>

<div data-slot="auto-save-field" data-state={status} class={cn('relative', className)}>
  {@render children(control)}
  <UnsavedIndicator {status} label={statusLabel?.(status)} class="absolute right-3 top-2.5" />
</div>
