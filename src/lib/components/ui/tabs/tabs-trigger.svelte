<script lang="ts">
  import { cn } from '$lib/utils';
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { getContext, untrack, type Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { TABS_CONTEXT, type TabsContext } from './context';

  interface Props extends HTMLButtonAttributes {
    value: string;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    value,
    disabled = false,
    class: className,
    onfocus,
    children,
    ...restProps
  }: Props = $props();
  const context = getContext<TabsContext>(TABS_CONTEXT);
  const index = context.state.allocate(untrack(() => value));
  const selected = $derived(context.value === value);
  const proximityActive = $derived(context.state.hover?.activeIndex === index);
  let element = $state<HTMLElement | null>(null);

  $effect(() => context.state.update(index, value, disabled || context.disabled));
  $effect(() => {
    context.state.register(index, element);
    return () => context.state.register(index, null);
  });

  function handleFocus(event: FocusEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    context.state.activate(index);
    onfocus?.(event);
  }
</script>

<TabsPrimitive.Trigger
  bind:ref={element}
  {value}
  disabled={disabled || context.disabled}
  onfocus={handleFocus}
  data-size={context.size}
  data-variant={context.variant}
  data-proximity-active={proximityActive || undefined}
  class={cn(
    'type-caption relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-(--radius-medium) border-0 bg-transparent px-3 text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
    context.size === 'compact' ? 'h-(--control-height-compact)' : 'h-(--control-height-medium)',
    (selected || proximityActive) && '[--text-caption-weight:500] text-foreground',
    className,
  )}
  {...restProps as any}
>
  {@render children?.()}
</TabsPrimitive.Trigger>
