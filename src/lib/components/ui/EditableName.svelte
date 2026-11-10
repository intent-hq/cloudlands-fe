<!-- @catalog-exempt: composition over the catalogued Button and Input; no catalog fixtures yet -->

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
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
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
    /** Accessible names of the name button and the edit field. */
    buttonAriaLabel?: string;
    inputAriaLabel?: string;
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
    buttonAriaLabel,
    inputAriaLabel,
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
      inputRef.scrollLeft = 0;
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
</script>

<div
  class={cn(
    'relative inline-flex items-center min-w-0 shrink whitespace-nowrap',
    textClass,
    className,
  )}
  style="max-width: {maxWidth}px"
>
  <Button
    variant="plain"
    labelClass="whitespace-pre"
    class={cn(
      textClass,
      'relative z-10 h-auto min-w-0 max-w-full shrink bg-transparent border-none cursor-text text-left',
      'truncate transition-opacity hover:opacity-80',
      isEditing && 'invisible',
      disabled && 'cursor-default opacity-50',
    )}
    onclick={startEditing}
    {disabled}
    {title}
    aria-label={buttonAriaLabel}
  >
    {(isEditing ? editedValue : value) || placeholder}
  </Button>
  {#if isEditing}
    <Input
      variant="inline"
      bind:ref={inputRef}
      type="text"
      bind:value={editedValue}
      onblur={save}
      onkeydown={handleKeydown}
      class={cn(textClass, 'edit-input absolute inset-0 z-10 h-full')}
      noFocusStyle
      aria-label={inputAriaLabel}
      {placeholder}
    />
  {/if}
  <span
    aria-hidden="true"
    class={cn(
      'pointer-events-none absolute z-0 rounded-(--radius-small) transition-[inset,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none',
      isEditing
        ? '-inset-x-2 -inset-y-0.5 bg-hover dark:bg-surface-1'
        : '-inset-x-1 -inset-y-0.5 bg-transparent',
    )}
  ></span>
</div>

<style>
  input.edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
