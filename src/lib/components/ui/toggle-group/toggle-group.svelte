<script lang="ts">
  import { cn } from '$lib/utils';
  import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { setContext } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';

  const toggleGroupVariants = tv({
    base: 'inline-flex items-center justify-center gap-px rounded-(--radius-medium) border border-border bg-card p-0.5',
    variants: {
      variant: {
        default: 'shadow-(--elevation-raised)',
        outline: 'shadow-none',
        flat: 'border-transparent bg-muted/40 shadow-none',
      },
      size: {
        default: '',
        xs: '',
        sm: '',
        lg: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  type ToggleGroupVariant = VariantProps<typeof toggleGroupVariants>;

  interface Props extends HTMLAttributes<HTMLDivElement>, ToggleGroupVariant {
    value?: string | string[];
    onValueChange?: ((value: string) => void) | ((value: string[]) => void);
    type?: 'single' | 'multiple';
    disabled?: boolean;
    class?: string;
    children?: Snippet;
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

  setContext('toggle-group-style', {
    get size() {
      return size;
    },
    get variant() {
      return variant;
    },
  });

  function handleSingleValueChange(nextValue: string) {
    value = nextValue;
    (onValueChange as ((value: string) => void) | undefined)?.(nextValue);
  }

  function handleMultipleValueChange(nextValue: string[]) {
    value = nextValue;
    (onValueChange as ((value: string[]) => void) | undefined)?.(nextValue);
  }
</script>

{#if type === 'multiple'}
  <ToggleGroupPrimitive.Root
    type="multiple"
    value={Array.isArray(value) ? value : []}
    onValueChange={handleMultipleValueChange}
    {disabled}
    class={cn(toggleGroupVariants({ variant, size }), className)}
    {...restProps as any}
  >
    {@render children?.()}
  </ToggleGroupPrimitive.Root>
{:else}
  <ToggleGroupPrimitive.Root
    type="single"
    value={typeof value === 'string' ? value : ''}
    onValueChange={handleSingleValueChange}
    {disabled}
    class={cn(toggleGroupVariants({ variant, size }), className)}
    {...restProps as any}
  >
    {@render children?.()}
  </ToggleGroupPrimitive.Root>
{/if}
