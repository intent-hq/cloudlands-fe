<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { textEntryGroupClasses, textEntryHeight } from '../text-entry';

  const uid = $props.id();
  const contextSize = useSize();

  let {
    ref = $bindable(null),
    size,
    leading,
    trailing,
    children,
    disabled = false,
    invalid = false,
    message,
    error,
    messageId = `${uid}-message`,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    size?: UiSize;
    leading?: Snippet;
    trailing?: Snippet;
    children: Snippet;
    disabled?: boolean;
    invalid?: boolean;
    message?: string;
    error?: string;
    messageId?: string;
  } = $props();

  const resolvedSize = $derived(size ?? contextSize);
  const visibleMessage = $derived(error ?? message);
</script>

<div data-slot="input-group-field" class={cn('min-w-0', className)}>
  <div
    bind:this={ref}
    data-slot="input-group"
    data-disabled={disabled || undefined}
    data-invalid={invalid || Boolean(error) || undefined}
    data-size={resolvedSize}
    aria-describedby={visibleMessage ? messageId : undefined}
    class={cn(
      'group/input-group flex min-w-0 items-stretch overflow-hidden rounded-(--radius-medium) border',
      textEntryGroupClasses,
      textEntryHeight(resolvedSize),
      '[&_[data-slot=input]]:h-full [&_[data-slot=input]]:rounded-none [&_[data-slot=input]]:border-0 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:shadow-none [&_[data-slot=input]]:hover:bg-transparent [&_[data-slot=input]]:focus-visible:bg-transparent [&_[data-slot=input]]:focus-visible:shadow-none',
      '[&_[data-slot=button]]:h-full [&_[data-slot=button]]:rounded-none [&_[data-slot=button]]:border-0 [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:shadow-none [&_[data-slot=button]]:focus-visible:ring-0 [&_[data-slot=button]]:hover:text-foreground [&_[data-slot=button-surface]]:hidden',
    )}
    {...restProps}
  >
    {#if leading}
      <span
        data-slot="input-group-addon"
        data-side="leading"
        class="flex h-[inherit] shrink-0 items-center border-r border-border px-2 text-muted-foreground transition-colors duration-(--spring-fast) has-[[data-slot=button]]:p-0 group-hover/input-group:text-foreground group-focus-within/input-group:text-foreground motion-reduce:transition-none"
      >
        {@render leading()}
      </span>
    {/if}
    <span data-slot="input-group-control" class="flex h-full min-w-0 flex-1 items-center">
      {@render children()}
    </span>
    {#if trailing}
      <span
        data-slot="input-group-addon"
        data-side="trailing"
        class="flex h-[inherit] shrink-0 items-center border-l border-border px-2 text-muted-foreground transition-colors duration-(--spring-fast) has-[[data-slot=button]]:p-0 group-hover/input-group:text-foreground group-focus-within/input-group:text-foreground motion-reduce:transition-none"
      >
        {@render trailing()}
      </span>
    {/if}
  </div>
  {#if visibleMessage}
    <InputMessage id={messageId} tone={error ? 'error' : 'helper'}>{visibleMessage}</InputMessage>
  {/if}
</div>
