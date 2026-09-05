<script lang="ts">
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { ChoiceGroupState } from '../choice-group-state.svelte';
  import { cn } from '$lib/utils';
  import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
  import { setContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { RADIO_GROUP_CONTEXT, type RadioGroupContext } from './context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value?: string;
    onValueChange?: (value: string) => void;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    readonly?: boolean;
    layout?: 'inline' | 'stacked';
    class?: string;
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    onValueChange,
    name,
    disabled = false,
    required = false,
    readonly = false,
    layout = 'stacked',
    class: className,
    children,
    ...restProps
  }: Props = $props();
  let root = $state<HTMLElement | null>(null);
  const choiceGroup = new ChoiceGroupState(() => (value ? [value] : []), 'xy');

  setContext<RadioGroupContext>(RADIO_GROUP_CONTEXT, {
    state: choiceGroup,
    get value() {
      return value;
    },
    get disabled() {
      return disabled;
    },
  });

  $effect(() => {
    if (!root) return;
    choiceGroup.connect(root);
    return () => choiceGroup.disconnect();
  });

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<RadioGroupPrimitive.Root
  bind:ref={root}
  {value}
  onValueChange={handleValueChange}
  {name}
  {disabled}
  {required}
  {readonly}
  orientation={layout === 'inline' ? 'horizontal' : 'vertical'}
  class={cn(
    'relative isolate flex w-72 max-w-full gap-0 select-none',
    layout === 'inline' ? 'flex-row items-stretch' : 'flex-col',
    className,
  )}
  {...restProps as any}
>
  {#if choiceGroup.hover}
    <ProximityHighlight
      store={choiceGroup.hover}
      selectedIndexes={choiceGroup.selectedIndexes}
      selectedClass="bg-active"
    />
  {/if}
  {@render children?.()}
</RadioGroupPrimitive.Root>
