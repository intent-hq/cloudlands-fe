<script lang="ts">
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { ChoiceGroupState } from '../choice-group-state.svelte';
  import { cn } from '$lib/utils';
  import { setContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { CHECKBOX_GROUP_CONTEXT, type CheckboxGroupContext } from './context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value?: string[];
    onValueChange?: (value: string[]) => void;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    layout?: 'inline' | 'stacked';
    class?: string;
    children?: Snippet;
  }

  let {
    value = $bindable([]),
    onValueChange,
    name,
    disabled = false,
    required = false,
    layout = 'stacked',
    class: className,
    children,
    ...restProps
  }: Props = $props();
  let root = $state<HTMLElement | null>(null);
  const choiceGroup = new ChoiceGroupState(() => value, 'xy');

  function setChecked(itemValue: string, checked: boolean) {
    const next = checked
      ? value.includes(itemValue)
        ? value
        : [...value, itemValue]
      : value.filter((entry) => entry !== itemValue);
    value = next;
    onValueChange?.(next);
  }

  setContext<CheckboxGroupContext>(CHECKBOX_GROUP_CONTEXT, {
    state: choiceGroup,
    get value() {
      return value;
    },
    get name() {
      return name;
    },
    get disabled() {
      return disabled;
    },
    get layout() {
      return layout;
    },
    setChecked,
  });

  $effect(() => {
    if (!root) return;
    choiceGroup.connect(root);
    return () => choiceGroup.disconnect();
  });
</script>

<div
  bind:this={root}
  role="group"
  aria-disabled={disabled || undefined}
  data-required={required || undefined}
  class={cn(
    'relative isolate flex w-72 max-w-full gap-0 select-none',
    layout === 'inline' ? 'flex-row items-stretch' : 'flex-col',
    className,
  )}
  {...restProps}
>
  {#if choiceGroup.hover}
    <ProximityHighlight store={choiceGroup.hover} selectedIndexes={choiceGroup.selectedIndexes} />
  {/if}
  {@render children?.()}
</div>
