<script lang="ts">
  import { animatedHeight } from '$lib/motion';
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, ...restProps }: Props = $props();
  const density = useSize();
</script>

<AccordionPrimitive.Content forceMount>
  {#snippet child({ props, open })}
    <div
      {...props}
      {...restProps}
      use:animatedHeight={open}
      aria-hidden={!open || undefined}
      inert={!open}
      class={cn('will-change-[height]', className)}
    >
      <div
        class={cn(
          density === 'compact' ? 'pb-2.5' : 'pb-3',
          'type-caption px-2 pt-1 text-muted-foreground',
        )}
      >
        {@render children?.()}
      </div>
    </div>
  {/snippet}
</AccordionPrimitive.Content>
