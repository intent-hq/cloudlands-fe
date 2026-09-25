<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { setContext, untrack, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { ChoiceGroupState } from '../choice-group-state.svelte';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { TABS_CONTEXT, type TabsContext, type TabsVariant } from './context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value?: string;
    onValueChange?: (value: string) => void;
    orientation?: 'horizontal' | 'vertical';
    activationMode?: 'automatic' | 'manual';
    loop?: boolean;
    disabled?: boolean;
    variant?: TabsVariant;
    size?: UiSize;
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    onValueChange,
    orientation = 'horizontal',
    activationMode = 'automatic',
    loop = true,
    disabled = false,
    variant = 'default',
    size,
    children,
    ...restProps
  }: Props = $props();
  const contextualSize = useSize();
  const actualSize = $derived(size ?? contextualSize);
  const state = new ChoiceGroupState(
    () => (value ? [value] : []),
    untrack(() => (orientation === 'horizontal' ? 'x' : 'y')),
  );

  setContext<TabsContext>(TABS_CONTEXT, {
    state,
    get value() {
      return value;
    },
    get variant() {
      return variant;
    },
    get size() {
      return actualSize;
    },
    get disabled() {
      return disabled;
    },
  });

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<TabsPrimitive.Root
  {value}
  onValueChange={handleValueChange}
  {orientation}
  {activationMode}
  {loop}
  {disabled}
  {...restProps as any}
>
  {@render children?.()}
</TabsPrimitive.Root>
