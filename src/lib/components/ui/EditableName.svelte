<script lang="ts">
  /**
   * EditableName - Inline click-to-edit name component
   *
   * Features:
   * - Click to edit, same font style for input and display
   * - No focus ring/outline on input
   * - Enter to save, Escape to cancel
   * - Click outside to save
   * - Auto-resize input to fit content
   */
  import { tick } from 'svelte';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The current name value */
    value: string;
    /** Placeholder text when empty */
    placeholder?: string;
    /** Called when name is saved with a new value */
    onSave: (newValue: string) => void;
    /** Whether editing is allowed */
    disabled?: boolean;
    /** Additional classes for the container */
    class?: string;
    /** Classes for the text styling (applied to both button and input) */
    textClass?: string;
    /** Tooltip text */
    title?: string;
    /** Maximum width in pixels */
    maxWidth?: number;
  }

  let {
    value,
    placeholder = m.ui_editableName_placeholder(),
    onSave,
    disabled = false,
    class: className = '',
    textClass = 'text-sm font-medium',
    title = m.ui_editableName_rename_tooltip(),
    maxWidth = 200,
  }: Props = $props();

  let isEditing = $state(false);
  // Initial value only; the $effect below syncs on prop changes.
  // svelte-ignore state_referenced_locally
  let editedValue = $state(value);
  let inputRef: HTMLInputElement | null = $state(null);

  // Sync editedValue when value prop changes (but not while editing)
  $effect(() => {
    if (!isEditing) {
      editedValue = value;
    }
  });

  async function startEditing() {
    if (disabled) return;
    isEditing = true;
    editedValue = value;
    await tick();
    if (inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  }

  function save() {
    if (!isEditing) return;
    const trimmed = editedValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    isEditing = false;
  }

  function cancel() {
    editedValue = value;
    isEditing = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (inputRef && !inputRef.contains(e.target as Node)) {
      save();
    }
  }

  // Add/remove click listener when editing state changes
  $effect(() => {
    if (isEditing) {
      // Use setTimeout to avoid catching the click that started editing
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  });

  // Calculate input width based on content
  function getInputWidth(text: string): number {
    return Math.max(60, Math.min(maxWidth, text.length * 8 + 20));
  }
</script>

<div class={cn('relative inline-flex items-center min-w-0 shrink whitespace-nowrap', className)}>
  <span
    aria-hidden="true"
    class={cn(
      'pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none',
      isEditing
        ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-muted/50'
        : 'inset-0 border-transparent bg-transparent',
    )}
  ></span>
  {#if isEditing}
    <input
      bind:this={inputRef}
      type="text"
      bind:value={editedValue}
      onblur={save}
      onkeydown={handleKeydown}
      oninput={(e) => {
        const target = e.currentTarget;
        target.style.width = `${getInputWidth(target.value)}px`;
      }}
      class={cn(
        textClass,
        'edit-input relative z-10 bg-transparent border-none outline-none px-0',
        'focus:ring-0! focus:outline-none! focus:ring-transparent!',
        'min-w-[60px]',
      )}
      {placeholder}
      style="width: {getInputWidth(editedValue)}px; max-width: {maxWidth}px"
    />
  {:else}
    <button
      class={cn(
        textClass,
        'relative z-10 bg-transparent border-none cursor-pointer text-left',
        'truncate transition-opacity hover:opacity-80',
        disabled && 'cursor-default opacity-50',
      )}
      style="max-width: {maxWidth}px"
      onclick={startEditing}
      {disabled}
      {title}
    >
      {value || placeholder}
    </button>
  {/if}
</div>

<style>
  input.edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
