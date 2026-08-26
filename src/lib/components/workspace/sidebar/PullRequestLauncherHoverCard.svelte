<script lang="ts">
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  interface Props {
    rows: WorkspacePRPresentationRow[];
    disabled?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onOpenPr: (row: WorkspacePRPresentationRow) => void;
    children?: Snippet;
  }

  let { rows, disabled = false, open = false, onOpenChange, onOpenPr, children }: Props = $props();

  function identity(row: WorkspacePRPresentationRow): string {
    const number = formatInteger(row.number);
    return row.repo ? `${row.repo}#${number}` : `#${number}`;
  }

  function openLabel(row: WorkspacePRPresentationRow): string {
    return m.workspace_progress_viewPrIdentity_tooltip({ identity: identity(row) });
  }
</script>

{#snippet content()}
  <div class="grid max-h-72 w-72 overflow-y-auto" role="list" data-sidebar-pr-hover-card>
    {#each rows as row (row.identity)}
      <div class="border-b border-border/50 last:border-b-0" role="listitem">
        <Button
          variant="plain"
          class="group/pr-row grid h-auto w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40"
          aria-label={openLabel(row)}
          title={openLabel(row)}
          data-sidebar-pr-hover-row
          data-pr-identity={row.identity}
          data-pr-status={row.status}
          onclick={(event) => {
            event.stopPropagation();
            onOpenPr(row);
          }}
        >
          <span class="grid size-4 place-items-center pt-0.5" aria-hidden="true">
            <Fa icon={row.statusIcon} size={13} class="shrink-0 {row.foregroundClass}" />
          </span>
          <span class="grid min-w-0 gap-0.5">
            <span
              class="line-clamp-2 min-w-0 whitespace-normal break-words text-sm font-medium leading-snug text-foreground"
            >
              {row.title || m.workspace_hoverCard_pullRequest_label()}
            </span>
            <span class="flex min-w-0 items-center gap-1.5 text-xs text-subtle">
              {#if row.repoContext}
                <span class="max-w-28 truncate">{row.repoContext}</span>
                <span aria-hidden="true">·</span>
              {/if}
              <span>{row.accessibleStateLabel}</span>
            </span>
          </span>
          <span class="shrink-0 text-xs text-subtle">#{formatInteger(row.number)}</span>
        </Button>
      </div>
    {/each}
  </div>
{/snippet}

<TooltipRich
  {content}
  side="top"
  align="end"
  sideOffset={8}
  delayDuration={0}
  maxWidth="19rem"
  showArrow={false}
  interactive={true}
  variant="custom"
  {disabled}
  {open}
  {onOpenChange}
  contentClass="bg-background text-foreground border-border/70"
  contentContainerClass="p-1! space-y-0"
  class="justify-self-end"
>
  {@render children?.()}
</TooltipRich>
