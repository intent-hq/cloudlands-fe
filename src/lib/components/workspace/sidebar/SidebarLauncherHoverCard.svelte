<script lang="ts">
  import type { Snippet } from 'svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';

  export interface HoverCardRow {
    label?: string;
    text: string;
  }

  interface Props {
    title: string;
    rows: HoverCardRow[];
    emptyText: string;
    kind: 'agent' | 'note';
    status?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: Snippet;
  }

  let {
    title,
    rows,
    emptyText,
    kind,
    status,
    open = false,
    onOpenChange,
    children,
  }: Props = $props();
  const visibleRows = $derived(rows.filter(({ text }) => text.trim().length > 0));
</script>

{#snippet preview()}
  <div class="w-72 space-y-2" data-sidebar-hover-card={kind}>
    {#if status}
      <span class="inline-flex items-center gap-1 text-xs font-medium text-success">
        <span class="size-1.5 rounded-full bg-success" aria-hidden="true"></span>
        {status}
      </span>
    {/if}
    {#if visibleRows.length > 0}
      {#each visibleRows as row}
        <div class="space-y-0.5" data-sidebar-hover-row={row.label?.toLowerCase() || 'content'}>
          {#if row.label}
            <p class="text-xs font-medium text-muted-foreground">{row.label}</p>
          {/if}
          <p
            class="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-snug text-foreground"
          >
            {row.text}
          </p>
        </div>
      {/each}
    {:else}
      <p class="text-sm text-muted-foreground">{emptyText}</p>
    {/if}
  </div>
{/snippet}

<TooltipRich
  {title}
  content={preview}
  side="top"
  align="start"
  sideOffset={8}
  delayDuration={250}
  maxWidth="20rem"
  showArrow={false}
  contentContainerClass="space-y-2"
  {open}
  {onOpenChange}
>
  {@render children?.()}
</TooltipRich>
