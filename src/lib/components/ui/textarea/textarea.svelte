<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { textEntryControlClasses, textEntryFocusResetClasses } from '../text-entry';

  interface Props extends HTMLTextareaAttributes {
    ref?: HTMLTextAreaElement | null;
    value?: string;
    doesExpandToFit?: boolean;
    autoResize?: boolean;
    minHeight?: number;
    maxHeight?: number;
    noFocusStyle?: boolean;
    size?: UiSize;
    message?: string;
    error?: string;
    messageId?: string;
    class?: string;
  }

  const uid = $props.id();
  const contextSize = useSize();

  let {
    ref = $bindable(),
    id,
    class: className,
    value = $bindable(),
    doesExpandToFit = false,
    autoResize = false,
    minHeight = 80,
    maxHeight = 400,
    noFocusStyle = false,
    size,
    message,
    error,
    messageId = `${uid}-message`,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    ...restProps
  }: Props = $props();

  const resolvedSize = $derived(size ?? contextSize);
  const shouldAutoResize = $derived(autoResize || doesExpandToFit);
  const visibleMessage = $derived(error ?? message);
  const describedBy = $derived(
    [ariaDescribedBy, visibleMessage ? messageId : undefined].filter(Boolean).join(' ') ||
      undefined,
  );
  const invalid = $derived(error ? true : ariaInvalid);

  export function focus() {
    ref?.focus();
  }

  export function blur() {
    ref?.blur();
  }

  function adjustHeight() {
    if (!shouldAutoResize || !ref) return;

    // Reset height to auto to get the correct scrollHeight
    ref.style.height = 'auto';

    // Calculate the new height, clamped between min and max
    const newHeight = Math.min(Math.max(ref.scrollHeight, minHeight), maxHeight);
    ref.style.height = `${newHeight}px`;

    // Add overflow-y auto only if content exceeds max height
    ref.style.overflowY = ref.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  // Adjust height when value changes
  $effect(() => {
    if (shouldAutoResize && ref && value !== undefined) {
      adjustHeight();
    }
  });
</script>

<textarea
  bind:this={ref}
  {id}
  data-slot="textarea"
  data-size={resolvedSize}
  bind:value
  oninput={shouldAutoResize ? adjustHeight : undefined}
  aria-describedby={describedBy}
  aria-invalid={invalid}
  class={cn(
    'type-caption text-foreground placeholder:text-muted-foreground flex w-full rounded-(--radius-medium) border px-3',
    textEntryControlClasses,
    resolvedSize === 'compact' ? 'py-1.5' : 'py-2',
    shouldAutoResize ? 'resize-none overflow-hidden' : 'min-h-20',
    noFocusStyle && textEntryFocusResetClasses,
    className,
  )}
  style={shouldAutoResize ? `min-height: ${minHeight}px; max-height: ${maxHeight}px` : undefined}
  autocorrect="off"
  autocapitalize="off"
  spellcheck="false"
  {...restProps}></textarea>

{#if visibleMessage}
  <InputMessage id={messageId} tone={error ? 'error' : 'helper'}>{visibleMessage}</InputMessage>
{/if}
