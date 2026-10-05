<script lang="ts">
  import {
    ActionBar,
    splitActions,
    type ActionDefinition,
    type ActionHandler,
  } from '$lib/components/patterns/action-menu';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  let {
    actions = [],
    onAction,
    visibleCount = Number.POSITIVE_INFINITY,
    controls,
    overflowLabel,
    alwaysVisible = false,
    overflowTriggerRef = $bindable(null),
    class: className,
  }: {
    actions?: readonly ActionDefinition[];
    onAction?: ActionHandler;
    visibleCount?: number;
    controls?: Snippet;
    overflowLabel: string;
    alwaysVisible?: boolean;
    overflowTriggerRef?: HTMLButtonElement | null;
    class?: string;
  } = $props();
  let focused = $state(false);
  let root: HTMLDivElement | null = $state(null);
  const overflowActions = $derived.by(() => {
    const split = splitActions(actions, visibleCount);
    return [...split.visible.filter((action) => action.children?.length), ...split.overflow];
  });

  $effect(() => {
    overflowTriggerRef =
      overflowActions.length > 0
        ? (root?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null)
        : null;
  });
</script>

<div
  bind:this={root}
  data-slot="row-actions"
  data-revealed={alwaysVisible || focused || undefined}
  class={cn(
    'flex items-center gap-1 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none',
    !alwaysVisible &&
      'opacity-0 group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100',
    className,
  )}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focused = false;
  }}
>
  {#if controls}
    {@render controls()}
  {/if}
  <ActionBar {actions} {onAction} {visibleCount} {overflowLabel} destructiveInline={false} />
</div>
