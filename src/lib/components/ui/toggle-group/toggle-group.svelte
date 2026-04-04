<script lang="ts">
  import { cn } from '$lib/utils';
  import { tv, type VariantProps } from 'tailwind-variants';
  import type { HTMLAttributes } from 'svelte/elements';
  import { setContext } from 'svelte';

  const toggleGroupVariants = tv({
    base: 'inline-flex items-center justify-center -space-x-px rounded-md',
    variants: {
      variant: {
        default: 'bg-muted/50',
        outline: 'border border-input bg-transparent',
      },
      size: {
        default: 'p-[2px]',
        xs: 'p-[2px]',
        sm: 'p-1',
        lg: 'p-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  type ToggleGroupVariant = VariantProps<typeof toggleGroupVariants>;

  interface Props extends HTMLAttributes<HTMLDivElement>, ToggleGroupVariant {
    value?: string;
    onValueChange?: (value: string) => void;
    type?: 'single' | 'multiple';
    disabled?: boolean;
    class?: string;
    children?: any;
  }

  let {
    value = $bindable(),
    onValueChange,
    type = 'single',
    disabled = false,
    variant = 'default',
    size = 'default',
    class: className = '',
    children,
    ...restProps
  }: Props = $props();

  // Context for child items
  setContext('toggle-group', {
    get value() {
      return value;
    },
    get type() {
      return type;
    },
    get disabled() {
      return disabled;
    },
    get size() {
      return size;
    },
    setValue: (newValue: string) => {
      if (type === 'single') {
        value = newValue;
        onValueChange?.(newValue);
      }
    },
  });
</script>

<div
  role="group"
  data-disabled={disabled ? '' : undefined}
  class={cn(toggleGroupVariants({ variant, size }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
