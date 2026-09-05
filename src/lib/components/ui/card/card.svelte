<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { untrack } from 'svelte';
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
  };

  let {
    ref = $bindable(null),
    class: className,
    inert = false,
    interactive = false,
    level,
    children,
    ...restProps
  }: Props = $props();

  const substrate = useSurface();
  const surface = clampSurface(untrack(() => level ?? substrate + 1));
  setSurface(surface);
  const hoverSurface = clampSurface(surface + 1);
</script>

<div
  bind:this={ref}
  data-slot="card"
  data-surface-level={surface}
  data-inert={inert || undefined}
  data-interactive={interactive || undefined}
  {inert}
  class={cn(
    'flex min-w-0 flex-col overflow-hidden rounded-(--radius-large) text-card-foreground',
    surfaceClasses(surface),
    interactive
      ? cn(
          'cursor-pointer outline-none transition-[background-color,box-shadow] duration-(--motion-fast) ease-(--ease-standard)',
          'focus-visible:ring-1 focus-visible:ring-ring',
          'active:bg-active data-[state=pressed]:bg-active motion-reduce:transition-none',
          surfaceHoverClasses(hoverSurface),
        )
      : '',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
