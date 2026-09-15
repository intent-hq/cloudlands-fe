<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { untrack, type Snippet } from 'svelte';
  import { getCardGroup } from './card-group-context';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    surfaceHoverClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';

  type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    interactive?: boolean;
    level?: number;
    border?: 'none' | 'outlined';
    selected?: boolean;
    media?: Snippet;
  };

  let {
    ref = $bindable(null),
    class: className,
    inert = false,
    interactive = false,
    level,
    border,
    selected = false,
    media,
    children,
    ...restProps
  }: Props = $props();

  const group = getCardGroup();
  const outlined = $derived(
    border === 'outlined' ||
      (border === undefined && (!group || (group.border === 'outlined' && group.separated))),
  );
  const substrate = useSurface();
  const surface = clampSurface(untrack(() => level ?? substrate + 1));
  setSurface(surface);
  const hoverSurface = clampSurface(surface + 1);
</script>

<div
  bind:this={ref}
  data-slot="card"
  data-selected={selected || undefined}
  data-orientation={group?.orientation}
  data-surface-level={surface}
  data-inert={inert || undefined}
  data-interactive={interactive || undefined}
  {inert}
  class={cn(
    'flex min-w-0 flex-col overflow-hidden rounded-(--radius-large) text-card-foreground',
    outlined
      ? group
        ? 'border border-border bg-transparent'
        : surfaceClasses(surface)
      : 'bg-transparent',
    selected && 'bg-selected',
    group?.orientation === 'inline' &&
      'flex-row items-center [&>[data-slot=card-header]]:min-w-0 [&>[data-slot=card-header]]:flex-1',
    group && 'relative',
    interactive
      ? cn(
          'cursor-pointer transition-[background-color,box-shadow] duration-(--motion-fast) ease-(--ease-standard)',
          'focus-visible:outline focus-visible:-outline-offset-1',
          'active:bg-active data-[state=pressed]:bg-active motion-reduce:transition-none',
          surfaceHoverClasses(hoverSurface),
        )
      : '',
    className,
  )}
  {...restProps}
>
  {#if media}<div data-slot="card-media" class="shrink-0 p-4">{@render media()}</div>{/if}
  {@render children?.()}
</div>
