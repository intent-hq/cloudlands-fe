<script lang="ts">
  import { cn } from '$lib/utils';
  import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { getContext } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';

  const toggleVariants = tv({
    base: 'type-body inline-flex cursor-pointer items-center justify-center rounded-(--radius-small) border border-transparent bg-transparent font-medium text-muted-foreground transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-input hover:bg-accent hover:text-accent-foreground focus-visible:z-10 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-primary/60 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:shadow-(--elevation-raised) motion-reduce:transition-none',
    variants: {
      variant: {
        default: '',
        outline: 'bg-transparent',
        flat: 'border-transparent hover:border-transparent data-[state=on]:border-transparent data-[state=on]:shadow-none',
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
    children,
    ...restProps
  }: Props = $props();

  const context = getContext<{
    size?: ToggleVariant['size'];
    variant?: ToggleVariant['variant'];
  }>('toggle-group-style');

  const actualSize = $derived(size ?? context?.size ?? 'default');
  const actualVariant = $derived(variant ?? context?.variant ?? 'default');
</script>

<ToggleGroupPrimitive.Item
  {value}
  title={tooltip}
  {disabled}
  {onclick}
  class={cn(toggleVariants({ variant: actualVariant, size: actualSize }), className)}
  {...restProps as any}
>
  {@render children?.()}
</ToggleGroupPrimitive.Item>
