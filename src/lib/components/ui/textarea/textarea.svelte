<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends HTMLTextareaAttributes {
    value?: string;
    doesExpandToFit?: boolean;
    minHeight?: number;
    maxHeight?: number;
    noFocusStyle?: boolean;
    class?: string;
  }

  let {
    class: className,
    value = $bindable(),
    doesExpandToFit = false,
    minHeight = 80,
    maxHeight = 400,
    noFocusStyle = false,
    ...restProps
  }: Props = $props();

  let textareaElement = $state<HTMLTextAreaElement | undefined>(undefined);

  export function focus() {
    textareaElement?.focus();
  }

  export function blur() {
    textareaElement?.blur();
  }

  function adjustHeight() {
    if (!doesExpandToFit || !textareaElement) return;

    // Reset height to auto to get the correct scrollHeight
    textareaElement.style.height = 'auto';

    // Calculate the new height, clamped between min and max
    const newHeight = Math.min(Math.max(textareaElement.scrollHeight, minHeight), maxHeight);
    textareaElement.style.height = `${newHeight}px`;

    // Add overflow-y auto only if content exceeds max height
    textareaElement.style.overflowY = textareaElement.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  // Adjust height when value changes
  $effect(() => {
    if (doesExpandToFit && textareaElement && value !== undefined) {
      adjustHeight();
    }
  });
</script>

<textarea
  bind:this={textareaElement}
  bind:value
  oninput={doesExpandToFit ? adjustHeight : undefined}
  class={cn(
    'type-body border-border bg-card text-foreground placeholder:text-muted-foreground/70 flex w-full rounded-(--radius-medium) border px-3 py-2 shadow-(--elevation-raised) outline-none transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-input read-only:bg-muted/30 read-only:text-muted-foreground read-only:hover:border-border disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25 motion-reduce:transition-none',
    doesExpandToFit ? 'resize-none overflow-hidden' : 'min-h-20',
    noFocusStyle
      ? 'focus-visible:outline-none focus-visible:ring-0'
      : 'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0',
    className,
  )}
  style={doesExpandToFit ? `min-height: ${minHeight}px; max-height: ${maxHeight}px` : undefined}
  autocorrect="off"
  autocapitalize="off"
  spellcheck="false"
  {...restProps}></textarea>
