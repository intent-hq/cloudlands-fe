<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import './tooltip-motion.css';
  import { clampSurface, setSurface, useSurface } from '$lib/components/ui/surface-context';
  import { useStaticOverlay } from '../static-overlay-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 0,
    side = 'top',
    children,
    arrowClasses,
    portalTarget,
    staticPosition,
    ...restProps
  }: TooltipPrimitive.ContentProps & {
    arrowClasses?: string;
    portalTarget?: Element | string;
    staticPosition?: boolean;
  } = $props();

  const rootStaticPosition = useStaticOverlay();
  const isStatic = $derived(staticPosition ?? rootStaticPosition());
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
</script>

{#snippet tooltipBody()}
  {@render children?.()}
{/snippet}

{#if isStatic}
  <TooltipPrimitive.ContentStatic
    bind:ref
    role="tooltip"
    data-slot="tooltip-content"
    data-static-position
    data-surface-level={surface}
    data-overlay-surface
    class={cn(
      'tooltip-motion overlay-surface type-caption z-(--layer-tooltip) w-fit text-balance bg-foreground px-2 py-1 text-background',
      className,
    )}
    onFocusOutside={() => {}}
    {...restProps as any}
  >
    {@render tooltipBody()}
  </TooltipPrimitive.ContentStatic>
{:else}
  <TooltipPrimitive.Portal to={portalTarget}>
    <TooltipPrimitive.Content
      bind:ref
      role="tooltip"
      data-slot="tooltip-content"
      data-surface-level={surface}
      data-overlay-surface
      {sideOffset}
      {side}
      class={cn(
        'tooltip-motion overlay-surface type-caption z-(--layer-tooltip) w-fit text-balance bg-foreground px-2 py-1 text-background',
        className,
      )}
      onFocusOutside={() => {}}
      {...restProps}
    >
      {@render children?.()}
      <TooltipPrimitive.Arrow>
        {#snippet child({ props })}
          <div
            class={cn(
              'z-(--layer-tooltip) size-2.5 rotate-45 rounded-[2px] bg-foreground',
              'data-[side=top]:translate-x-1/2 data-[side=top]:translate-y-[calc(-50%_+_2px)]',
              'data-[side=bottom]:-translate-x-1/2 data-[side=bottom]:-translate-y-[calc(-50%_+_1px)]',
              'data-[side=right]:translate-x-[calc(50%_+_2px)] data-[side=right]:translate-y-1/2',
              'data-[side=left]:-translate-y-[calc(50%_-_3px)]',
              arrowClasses,
            )}
            {...props}
          ></div>
        {/snippet}
      </TooltipPrimitive.Arrow>
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
{/if}
