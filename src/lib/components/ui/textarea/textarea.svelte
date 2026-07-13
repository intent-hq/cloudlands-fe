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
    'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
    doesExpandToFit ? 'resize-none overflow-hidden' : 'min-h-20',
    noFocusStyle ? 'focus-visible:outline-none! focus-visible:ring-0!' : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    className,
  )}
  style={doesExpandToFit ? `min-height: ${minHeight}px; max-height: ${maxHeight}px` : undefined}
  autocorrect="off"
  autocapitalize="off"
  spellcheck="false"
  {...restProps}
></textarea>
