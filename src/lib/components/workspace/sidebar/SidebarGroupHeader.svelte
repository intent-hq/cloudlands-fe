<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import DisclosureIcon from '$lib/components/icons/DisclosureIcon.svelte';

  interface Props {
    [attribute: `data-${string}`]: string | undefined;
    title: string;
    label?: string;
    meta?: string;
    expanded: boolean;
    onclick: () => void;
  }

  let { title, label, meta, expanded, onclick, ...restProps }: Props = $props();
</script>

<Button
  {...restProps}
  variant="ghost"
  size="compact"
  class="h-8 w-full justify-start gap-2 px-2 type-caption font-normal text-muted-foreground hover:text-foreground"
  aria-expanded={expanded}
  aria-label={label}
  {onclick}
  data-sidebar-group-header
>
  <span class="min-w-0 flex-1 truncate text-left">{title}</span>
  {#if meta}
    <span
      class="min-w-4 shrink-0 text-center text-[11px] font-normal leading-none tabular-nums text-muted-foreground"
      >{meta}</span
    >
  {/if}
  <DisclosureIcon {expanded} />
</Button>
