<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { getSidebarGroupContext } from './sidebar-group-context.svelte';

  let {
    ref = $bindable(null),
    children,
    child,
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    child?: Snippet<[{ props: Record<string, unknown> }]>;
  } = $props();
  const group = getSidebarGroupContext();

  const mergedProps = $derived({
    class: cn(
      'group/group-label text-muted-foreground/70 hover:text-muted-foreground flex h-8 w-full shrink-0 items-center justify-start gap-2 rounded-md px-2 text-xs font-normal transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none focus-visible:outline focus-visible:-outline-offset-1 [&>svg]:size-4 [&>svg]:shrink-0',
      group && group.actionCount > 0 && 'pr-(--group-actions-pad)',
      className,
    ),
    'data-slot': 'sidebar-group-label',
    'data-sidebar': 'group-label',
    style: group?.actionCount ? `--group-actions-pad: ${group.actionCount * 28 + 6}px` : undefined,
    ...restProps,
  });
</script>

{#if child}
  {@render child({ props: mergedProps })}
{:else if group?.collapsible}
  <Button
    bind:ref
    {...mergedProps}
    type="button"
    variant="ghost"
    size="sm"
    aria-expanded={group.open}
    onclick={group.toggle}
  >
    <span class="min-w-0 flex-1 truncate text-left">{@render children?.()}</span>
    <span
      class={cn(
        'ml-auto flex h-6 shrink-0 items-center justify-center overflow-hidden transition-[width,opacity] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
        group.open
          ? 'w-0 opacity-0 group-hover/group-label:w-6 group-hover/group-label:opacity-100 group-focus/group-label:w-6 group-focus/group-label:opacity-100'
          : 'w-6 opacity-100',
      )}
      aria-hidden="true"><Fa icon={faChevronDown} /></span
    >
  </Button>
{:else}
  <div bind:this={ref} {...mergedProps}>
    {@render children?.()}
  </div>
{/if}
