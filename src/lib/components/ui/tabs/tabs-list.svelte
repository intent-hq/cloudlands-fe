<script lang="ts">
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { cn } from '$lib/utils';
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { getContext, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { TABS_CONTEXT, type TabsContext } from './context';
  import TabsIndicator from './tabs-indicator.svelte';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, ...restProps }: Props = $props();
  const context = getContext<TabsContext>(TABS_CONTEXT);
  let root = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!root) return;
    context.state.connect(root);
    return () => context.state.disconnect();
  });
</script>

<TabsPrimitive.List
  bind:ref={root}
  class={cn(
    'relative isolate inline-flex max-w-full items-center gap-0.5 select-none',
    context.variant === 'default'
      ? 'rounded-(--radius-medium) bg-muted'
      : 'max-w-full overflow-x-auto px-1',
    className,
  )}
  {...restProps as any}
>
  {#if context.state.hover}
    {#if context.variant === 'default'}
      <TabsIndicator store={context.state.hover} selectedIndexes={context.state.selectedIndexes} />
      <ProximityHighlight store={context.state.hover} selectedIndexes={[]} />
    {:else}
      <ProximityHighlight
        store={context.state.hover}
        selectedIndexes={context.state.selectedIndexes}
        selectedClass="bg-active"
        hoverClass="bg-active"
      />
    {/if}
  {/if}
  {@render children?.()}
</TabsPrimitive.List>
