<script lang="ts">
  import { cn } from '$lib/utils';
  import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
  import { getContext, untrack, type Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { RADIO_GROUP_CONTEXT, type RadioGroupContext } from './context';

  interface Props extends HTMLButtonAttributes {
    value: string;
    title: string;
    description?: string;
    disabled?: boolean;
    marker?: Snippet<[{ selected: boolean; index: number }]>;
    class?: string;
  }

  let {
    value,
    title,
    description,
    disabled = false,
    marker,
    class: className,
    onfocus,
    ...restProps
  }: Props = $props();
  const context = getContext<RadioGroupContext>(RADIO_GROUP_CONTEXT);
  const index = context.state.allocate(untrack(() => value));
  const selected = $derived(context.value === value);
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

<RadioGroupPrimitive.Item
  bind:ref={element}
  {value}
  disabled={disabled || context.disabled}
  data-choice-index={index}
  onfocus={handleFocus}
  class={cn(
    'type-caption relative z-10 flex min-h-(--control-height-medium) min-w-0 cursor-pointer items-center gap-2 rounded-(--radius-row) border border-transparent bg-transparent px-2 py-1.5 text-left text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast hover:[--text-caption-weight:500] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
    selected && '[--text-caption-weight:500] text-foreground',
    className,
  )}
  {...restProps as any}
>
  <span
    class={cn(
      'border-border flex size-4 shrink-0 items-center justify-center rounded-full border',
      selected ? 'border-transparent bg-transparent' : 'bg-transparent',
    )}
  >
    {#if marker}
      {@render marker({ selected, index })}
    {:else if selected}
      <span class="bg-foreground size-2 rounded-full"></span>
    {/if}
  </span>
  <span class="min-w-0">
    <span class="block">{title}</span>
    {#if description}<span class="text-muted-foreground block text-ui-xs font-normal"
        >{description}</span
      >{/if}
  </span>
</RadioGroupPrimitive.Item>
