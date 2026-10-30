<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    [attribute: `data-${string}`]: string | undefined;
    title: string;
    meta?: string;
    expanded: boolean;
    onclick: () => void;
    collapsedChevronClass?: string;
  }

  let {
    title,
    meta,
    expanded,
    onclick,
    collapsedChevronClass = '-rotate-90',
    ...restProps
  }: Props = $props();
</script>

<Button
  {...restProps}
  variant="ghost"
  size="compact"
  class="h-8 w-full justify-start gap-2 px-2 type-caption font-normal text-muted-foreground hover:text-foreground"
  aria-expanded={expanded}
  {onclick}
  data-sidebar-group-header
>
  <span class="min-w-0 flex-1 truncate text-left">{title}</span>
  {#if meta}
    <span class="shrink-0 type-caption font-normal tabular-nums text-muted-foreground">{meta}</span>
  {/if}
  <Fa
    icon={faChevronDown}
    class="size-3 shrink-0 opacity-50 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {expanded
      ? ''
      : collapsedChevronClass}"
  />
</Button>
