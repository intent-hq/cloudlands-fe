<script lang="ts">
  import { cn } from '$lib/utils';
  import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { getContext, untrack } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';
  import { TOGGLE_GROUP_CONTEXT, type ToggleGroupContext } from './context';

  const toggleVariants = tv({
    base: 'type-caption relative z-10 inline-flex cursor-pointer items-center justify-center rounded-(--radius-small) border border-transparent bg-transparent font-medium text-muted-foreground transition-[border-color,color,font-weight] duration-spring-fast ease-spring-fast hover:border-input hover:font-semibold hover:text-foreground active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-transparent data-[state=on]:font-semibold data-[state=on]:text-foreground motion-reduce:transition-none',
    variants: {
      variant: {
        default: '',
        outline: 'bg-transparent',
        flat: 'border-transparent hover:border-transparent data-[state=on]:border-transparent',
      },
      size: {
        default: 'h-(--control-height-medium) min-w-8 px-2',
        xs: 'h-(--control-height-small) min-w-7 px-1.5',
        sm: 'h-(--control-height-small) min-w-7 px-1.5',
        lg: 'h-(--control-height-large) min-w-9 px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  type ToggleVariant = VariantProps<typeof toggleVariants>;

  interface Props extends HTMLButtonAttributes, ToggleVariant {
    value: string;
    tooltip?: string;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    value,
    disabled = false,
    variant = undefined,
    size = undefined,
    tooltip = undefined,
    class: className = '',
    onclick,
    onfocus,
    children,
    ...restProps
  }: Props = $props();

  const context = getContext<ToggleGroupContext>(TOGGLE_GROUP_CONTEXT);
  const index = context.state.allocate(untrack(() => value));
  let element = $state<HTMLElement | null>(null);

  const actualSize = $derived(size ?? context?.size ?? 'default');
  const actualVariant = $derived(variant ?? context?.variant ?? 'default');

  $effect(() => context.state.update(index, value, disabled));
  $effect(() => {
    context.state.register(index, element);
    return () => context.state.register(index, null);
  });

  function handleFocus(event: FocusEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    context.state.activate(index);
    onfocus?.(event);
  }
</script>

<ToggleGroupPrimitive.Item
  bind:ref={element}
  {value}
  title={tooltip}
  {disabled}
  {onclick}
  onfocus={handleFocus}
  class={cn(toggleVariants({ variant: actualVariant, size: actualSize }), className)}
  {...restProps as any}
>
  {@render children?.()}
</ToggleGroupPrimitive.Item>
