<script lang="ts">
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { useSize } from '$lib/components/ui/size-context';

  interface Props extends HTMLButtonAttributes {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, ...restProps }: Props = $props();
  const density = useSize();
</script>

<AccordionPrimitive.Trigger
  class={cn(
    density === 'compact' ? 'min-h-7 py-1' : 'min-h-9 py-2',
    'group type-caption flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-(--radius-small) px-2 text-left font-normal text-muted-foreground outline-none transition-[color,background-color,font-weight] duration-(--motion-fast) ease-(--ease-standard) hover:bg-hover hover:text-foreground data-[state=open]:font-semibold data-[state=open]:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
    className,
  )}
  {...restProps as any}
>
  <span class="min-w-0 flex-1">{@render children?.()}</span>
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    class="size-4 shrink-0 text-muted-foreground transition-[color,transform,stroke-width] duration-(--motion-fast) ease-(--ease-standard) group-hover:text-foreground group-data-[state=open]:rotate-90 group-data-[state=open]:text-foreground group-data-[state=open]:[stroke-width:2] motion-reduce:transition-none"
    fill="none"
  >
    <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
</AccordionPrimitive.Trigger>
