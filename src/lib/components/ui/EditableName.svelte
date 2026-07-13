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
    placeholder = 'Untitled',
    onSave,
    disabled = false,
    class: className = '',
    textClass = 'text-sm font-medium',
    title = 'Click to rename',
    maxWidth = 200,
  }: Props = $props();

  let isEditing = $state(false);
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

<div class={cn('inline-flex items-center min-w-0 shrink whitespace-nowrap', className)}>
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
        'bg-transparent border-none outline-none px-0',
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
        'bg-transparent border-none cursor-pointer text-left',
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
