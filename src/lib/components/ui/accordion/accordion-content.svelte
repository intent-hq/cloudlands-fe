<script lang="ts">
  import { animatedHeight } from '$lib/motion';
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    inset?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, inset = true, ...restProps }: Props = $props();
  const density = useSize();
</script>

<!--
  Bits UI rewrites the outer element's `style` attribute whenever its measurement
  variables change, which would clobber the inline styles `animatedHeight` writes.
  The animation therefore lives on an inner wrapper that Bits UI never styles
  (intent-hq/intent#5306).
-->
<AccordionPrimitive.Content forceMount>
  {#snippet child({ props, open })}
    <div {...props} {...restProps} aria-hidden={!open || undefined} inert={!open} class={className}>
      <div use:animatedHeight={open} data-accordion-content-motion class="will-change-[height]">
        <div
          class={cn(
            density === 'compact' ? 'pb-2.5' : 'pb-3',
            'type-caption px-2 pt-1 text-muted-foreground',
            !inset && 'px-0',
          )}
        >
          {@render children?.()}
        </div>
      </div>
    </div>
  {/snippet}
</AccordionPrimitive.Content>
