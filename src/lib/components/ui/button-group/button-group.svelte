<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import { tv, type VariantProps } from 'tailwind-variants';

  const buttonGroupVariants = tv({
    base: 'inline-flex -space-x-px',
    variants: {
      orientation: {
        horizontal: 'flex-row',
        vertical: 'flex-col -space-x-0 -space-y-px',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  });

  type ButtonGroupVariant = VariantProps<typeof buttonGroupVariants>;

  interface Props extends HTMLAttributes<HTMLDivElement>, ButtonGroupVariant {
    class?: string;
    children?: any;
  }

  let {
    class: className = '',
    orientation = 'horizontal',
    children,
    ...restProps
  }: Props = $props();

  // Apply styles to children buttons
  const groupClass = $derived(
    cn(
      buttonGroupVariants({ orientation }),
      // Remove rounded corners from middle buttons
      orientation === 'horizontal'
        ? '[&>*:not(:first-child):not(:last-child)]:rounded-none [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none'
        : '[&>*:not(:first-child):not(:last-child)]:rounded-none [&>*:first-child]:rounded-b-none [&>*:last-child]:rounded-t-none',
      // Ensure proper z-index for hover/focus states
      '[&>*:hover]:z-10 [&>*:focus]:z-20 [&>*:focus-visible]:z-20',
      // Handle active/selected state
      '[&>*[data-state=active]]:z-10',
      className,
    ),
  );
</script>

<div role="group" class={groupClass} {...restProps}>
  {@render children?.()}
</div>
