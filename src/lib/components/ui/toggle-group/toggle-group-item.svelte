<script lang="ts">
  import { cn } from '$lib/utils';
  import {
  tv,
  type VariantProps,
} from 'tailwind-variants';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { getContext } from 'svelte';
  import Button from '../button/button.svelte';

  const toggleVariants = tv({
    // i18n-ignore (CSS class list, not UI text)
    base: 'inline-flex items-center justify-center rounded-sm text-sm font-medium ring-offset-background transition-colors hover:bg-muted! hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background! data-[state=on]:shadow-xs text-muted-foreground data-[state=on]:text-muted-foreground',
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 w-9',
        xs: 'h-5 w-5 text-xs',
        sm: 'h-7 w-7 text-xs',
        lg: 'h-10 w-10',
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
    children?: any;
  }

  let {
    value,
    disabled = false,
    variant = 'default',
    size = 'default',
    tooltip = undefined,
    class: className = '',
    onclick,
    children,
    ...restProps
  }: Props = $props();

  // Get context from parent ToggleGroup
  const context = getContext<{
    value: string;
    type: string;
    disabled: boolean;
    size: string;
    setValue: (value: string) => void;
  }>('toggle-group');

  // Use context size if not explicitly set
  const actualSize = $derived(size || context?.size || 'default');

  // Check if this item is selected
  const isSelected = $derived(context?.value === value);

  // Check if disabled (either from prop or context)
  const isDisabled = $derived(disabled || context?.disabled);

  function handleClick(e: MouseEvent) {
    if (!isDisabled && context) {
      context.setValue(value);
    }
    onclick?.(e as any);
  }
</script>

<Button
  variant="ghost-light"
  data-state={isSelected ? 'on' : 'off'}
  data-value={value}
  {tooltip}
  disabled={isDisabled}
  onclick={handleClick}
  class={cn(toggleVariants({ variant, size: actualSize as any }), className)}
  {...restProps as any}
>
  {@render children?.()}
</Button>
