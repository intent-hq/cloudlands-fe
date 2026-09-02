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
    statusTone?: 'success' | 'warning' | 'danger' | 'muted';
    delayDuration?: number;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    gridPosition?: 'start' | 'center' | 'end';
    children?: Snippet;
  }

  let {
    title,
    rows,
    emptyText,
    kind,
    status,
    statusTone = 'success',
    delayDuration = 400,
    open = false,
    onOpenChange,
    gridPosition = 'center',
    children,
  }: Props = $props();
  const visibleRows = $derived(rows.filter(({ text }) => text.trim().length > 0));
</script>

{#snippet preview()}
  <div class="w-72 space-y-2" data-sidebar-hover-card={kind}>
    {#if status}
      <span
        class="inline-flex items-center gap-1 text-xs font-medium"
        class:text-success={statusTone === 'success'}
        class:text-amber-500={statusTone === 'warning'}
        class:text-red-500={statusTone === 'danger'}
        class:text-muted-foreground={statusTone === 'muted'}
      >
        <span
          class="size-1.5 rounded-full"
          class:bg-success={statusTone === 'success'}
          class:bg-amber-500={statusTone === 'warning'}
          class:bg-red-500={statusTone === 'danger'}
          class:bg-muted-foreground={statusTone === 'muted'}
          aria-hidden="true"
        ></span>
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
  {delayDuration}
  maxWidth="20rem"
  showArrow={false}
  class={gridPosition === 'start'
    ? 'justify-self-start'
    : gridPosition === 'end'
      ? 'justify-self-end'
      : 'justify-self-center'}
  contentContainerClass="space-y-2"
  {open}
  {onOpenChange}
>
  {@render children?.()}
</TooltipRich>
