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
    if (!root || context.variant === 'underline') return;
    context.state.connect(root);
    return () => context.state.disconnect();
  });
</script>

<TabsPrimitive.List
  bind:ref={root}
  class={cn(
    'relative isolate inline-flex max-w-full items-center gap-0.5 select-none',
    context.variant === 'default'
      ? 'rounded-(--radius-medium) bg-muted/40'
      : context.variant === 'icon'
        ? 'gap-2 rounded-(--radius-large) bg-muted/60 p-1 dark:bg-surface-4'
        : 'max-w-full overflow-x-auto px-1',
    className,
  )}
  {...restProps as any}
>
  {#if context.state.hover}
    {#if context.variant === 'default' || context.variant === 'icon'}
      {#each context.state.selectedIndexes as selectedIndex, order (order === 0 ? -1 : selectedIndex)}
        <TabsIndicator
          store={context.state.hover}
          selectedIndexes={[selectedIndex]}
          variant={context.variant}
        />
      {/each}
      {#if !context.state.selectedIndexes.includes(context.state.hover.activeIndex ?? -1)}
        <ProximityHighlight store={context.state.hover} selectedIndexes={[]} />
      {/if}
    {:else if context.variant === 'subtle'}
      <ProximityHighlight
        store={context.state.hover}
        selectedIndexes={context.state.selectedIndexes}
        selectedClass="bg-card dark:bg-surface-3 shadow-(--elevation-raised)"
        hoverClass={context.state.selectedIndexes.includes(context.state.hover.activeIndex ?? -1)
          ? 'bg-transparent'
          : 'bg-hover'}
      />
    {/if}
  {/if}
  {@render children?.()}
</TabsPrimitive.List>
