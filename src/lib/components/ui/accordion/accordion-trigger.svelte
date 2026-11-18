<script lang="ts">
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';

  interface Props extends HTMLButtonAttributes {
    inset?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, inset = true, ...restProps }: Props = $props();
  const density = useSize();
</script>

<AccordionPrimitive.Trigger
  class={cn(
    density === 'compact' ? 'min-h-7 py-1' : 'min-h-9 py-2',
    'w-full',
    'group type-caption flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-(--radius-small) px-2 text-left font-normal text-muted-foreground transition-[color,background-color,font-weight] duration-(--motion-fast) ease-(--ease-standard) hover:bg-hover hover:text-foreground data-[state=open]:font-semibold data-[state=open]:text-foreground focus-visible:outline focus-visible:-outline-offset-1 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
    !inset && 'px-0',
    className,
  )}
  {...restProps as any}
>
  <span class="min-w-0 flex-1">{@render children?.()}</span>
  <span class="first-line-icon">
    <CaretRightIcon
      aria-hidden="true"
      class="size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-(--motion-fast) ease-(--ease-standard) group-hover:text-foreground group-data-[state=open]:rotate-90 group-data-[state=open]:text-foreground motion-reduce:transition-none"
    />
  </span>
</AccordionPrimitive.Trigger>
