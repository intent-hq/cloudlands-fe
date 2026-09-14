<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    title: string;
    meta?: string;
    expanded: boolean;
    onclick: () => void;
  }

  let { title, meta, expanded, onclick }: Props = $props();
</script>

<Button
  variant="ghost"
  size="compact"
  class="h-7 w-full justify-start gap-2 rounded-md px-2 text-ui font-semibold text-muted-foreground hover:text-foreground"
  aria-expanded={expanded}
  {onclick}
  data-sidebar-group-header
>
  <span class="min-w-0 flex-1 truncate text-left">{title}</span>
  {#if meta}
    <span class="shrink-0 text-xs font-normal text-muted-foreground">{meta}</span>
  {/if}
  <Fa
    icon={faChevronDown}
    class="size-3 shrink-0 opacity-50 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {expanded
      ? ''
      : '-rotate-90'}"
  />
</Button>
