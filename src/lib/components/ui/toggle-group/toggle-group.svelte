<script lang="ts">
  import { cn } from '$lib/utils';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { ChoiceGroupState } from '../choice-group-state.svelte';
  import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { setContext, untrack } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';
  import type { ProximityAxis } from '$lib/interaction';
  import { TOGGLE_GROUP_CONTEXT, type ToggleGroupContext } from './context';

  const toggleGroupVariants = tv({
    base: 'relative isolate inline-flex items-center justify-center gap-0.5 rounded-(--radius-medium) border-0 bg-card',
    variants: {
      variant: {
        default: 'shadow-(--elevation-raised)',
        outline: 'border border-border shadow-none',
        flat: 'bg-muted/40 shadow-none',
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
    axis?: ProximityAxis;
    class?: string;
    children?: Snippet;
  }

  let {
    value = $bindable(),
    onValueChange,
    type = 'single',
    disabled = false,
    axis = 'x',
    variant = 'default',
    size = 'default',
    class: className = '',
    children,
    ...restProps
  }: Props = $props();
  let root = $state<HTMLElement | null>(null);
  const choiceGroup = new ChoiceGroupState(
    () => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []),
    untrack(() => axis),
  );

  setContext<ToggleGroupContext>(TOGGLE_GROUP_CONTEXT, {
    state: choiceGroup,
    get size() {
      return size;
    },
    get variant() {
      return variant;
    },
  });

  $effect(() => {
    if (!root) return;
    choiceGroup.connect(root);
    return () => choiceGroup.disconnect();
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
    bind:ref={root}
    type="multiple"
    value={Array.isArray(value) ? value : []}
    onValueChange={handleMultipleValueChange}
    {disabled}
    class={cn(toggleGroupVariants({ variant, size }), className)}
    {...restProps as any}
  >
    {#if choiceGroup.hover}
      <ProximityHighlight store={choiceGroup.hover} selectedIndexes={choiceGroup.selectedIndexes} />
    {/if}
    {@render children?.()}
  </ToggleGroupPrimitive.Root>
{:else}
  <ToggleGroupPrimitive.Root
    bind:ref={root}
    type="single"
    value={typeof value === 'string' ? value : ''}
    onValueChange={handleSingleValueChange}
    {disabled}
    class={cn(toggleGroupVariants({ variant, size }), className)}
    {...restProps as any}
  >
    {#if choiceGroup.hover}
      <ProximityHighlight store={choiceGroup.hover} selectedIndexes={choiceGroup.selectedIndexes} />
    {/if}
    {@render children?.()}
  </ToggleGroupPrimitive.Root>
{/if}
