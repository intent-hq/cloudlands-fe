<script lang="ts">
  import { cn } from '$lib/utils';
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import { getContext, untrack, type Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { CHECKBOX_GROUP_CONTEXT, type CheckboxGroupContext } from './context';

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
    onkeydown,
    ...restProps
  }: Props = $props();
  const context = getContext<CheckboxGroupContext>(CHECKBOX_GROUP_CONTEXT);
  const index = context.state.allocate(untrack(() => value));
  const selected = $derived(context.value.includes(value));
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

  function handleKeydown(
    event: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement },
  ) {
    const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (previous || next) {
      event.preventDefault();
      context.state.focusAdjacent(index, previous ? -1 : 1);
    }
    onkeydown?.(event);
  }
</script>

<CheckboxPrimitive.Root
  bind:ref={element}
  checked={selected}
  onCheckedChange={(checked) => context.setChecked(value, checked)}
  name={context.name}
  {value}
  disabled={disabled || context.disabled}
  tabindex={context.state.keyboardIndex === index ? 0 : -1}
  data-choice-index={index}
  onfocus={handleFocus}
  onkeydown={handleKeydown}
  class={cn(
    'type-caption relative z-10 flex min-h-(--control-height-medium) min-w-0 cursor-pointer items-center gap-2 rounded-(--radius-small) border border-transparent bg-transparent px-2 py-1.5 text-left text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast hover:font-semibold disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
    selected && 'font-semibold text-foreground',
    className,
  )}
  {...restProps as any}
>
  <span
    class={cn(
      'border-border flex size-4 shrink-0 items-center justify-center rounded-(--radius-small) border',
      selected ? 'border-transparent bg-transparent text-foreground' : 'bg-transparent',
    )}
  >
    {#if marker}
      {@render marker({ selected, index })}
    {:else if selected}
      <svg class="size-3" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="m2.25 6.25 2.25 2.2 5.25-5"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
        />
      </svg>
    {/if}
  </span>
  <span class="min-w-0">
    <span class="block">{title}</span>
    {#if description}<span class="text-muted-foreground block text-ui-xs font-normal"
        >{description}</span
      >{/if}
  </span>
</CheckboxPrimitive.Root>
