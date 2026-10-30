<script lang="ts">
  import { monitorAccessibleLabel } from '$lib/utils/review-monitor-presentation';
  import Fa from 'svelte-fa';
  import * as Menu from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  let {
    rows,
    onSelect,
    interactive = true,
    inline = false,
    class: className = '',
  }: {
    rows: WorkspacePRPresentationRow[];
    onSelect: (pr: WorkspacePRPresentationRow) => void;
    /**
     * `true` (default) renders rows as `Menu.Item`s and must sit inside a
     * `Menu.Content`; `false` renders static rows for catalog/preview surfaces.
     */
    interactive?: boolean;
    inline?: boolean;
    class?: string;
  } = $props();

  // Title takes the flexible column; the state cell may also shrink and truncate
  // so a long repo context cannot push the number off the row.
  const rowClass =
    'grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-x-2 h-8 rounded-md px-2 py-0 type-caption font-normal text-left';

  function getPrLabel(pr: WorkspacePRPresentationRow): string {
    const identity =
      pr.resource?.repository.provider === 'gitlab'
        ? `${pr.repo} !${pr.number}`
        : pr.repo
          ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
          : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [monitorAccessibleLabel(identity, pr), pr.title, pr.details].filter(Boolean).join('\n');
  }

  function getPrState(pr: WorkspacePRPresentationRow): string {
    if (inline) return pr.repoContext ?? pr.repo?.split('/').pop() ?? '';
    return [pr.repoContext, pr.accessibleStateLabel].filter(Boolean).join(' · ');
  }
</script>

{#snippet rowContent(pr: WorkspacePRPresentationRow)}
  <Fa icon={pr.statusIcon} size={16} class="shrink-0 {pr.foregroundClass}" />
  <span class="type-caption min-w-0 truncate text-foreground">
    {pr.title ||
      (pr.resource?.repository.provider === 'gitlab'
        ? m.workspace_hoverCard_mergeRequest_label()
        : m.workspace_hoverCard_pullRequest_label())}
  </span>
  <span
    class="type-caption min-w-0 truncate text-muted-foreground {inline ? 'max-w-24' : ''}"
    data-sidebar-pr-state
  >
    {getPrState(pr)}
  </span>
  <span class="type-caption shrink-0 text-muted-foreground"
    >{pr.numberLabel ?? `#${pr.number}`}</span
  >
{/snippet}

<div class="grid w-full gap-0.5 {className}" data-sidebar-pr-list>
  {#each rows as pr (pr.identity)}
    {#if inline}
      <Button
        variant="ghost"
        wrapContent={false}
        class={rowClass}
        aria-label={getPrLabel(pr)}
        title={getPrLabel(pr)}
        disabled={!pr.url}
        data-sidebar-pr-link
        data-sidebar-pr-url={pr.url}
        data-pr-identity={pr.identity}
        data-pr-status={pr.status}
        onclick={() => onSelect(pr)}
        onkeydown={(event) => event.stopPropagation()}
      >
        {@render rowContent(pr)}
      </Button>
    {:else if interactive}
      <Menu.Item
        class={rowClass}
        aria-label={getPrLabel(pr)}
        title={getPrLabel(pr)}
        disabled={!pr.url}
        data-sidebar-pr-link
        data-sidebar-pr-url={pr.url}
        data-pr-identity={pr.identity}
        data-pr-status={pr.status}
        onSelect={() => onSelect(pr)}
      >
        {@render rowContent(pr)}
      </Menu.Item>
    {:else}
      <div
        class="{rowClass} {pr.url ? '' : 'cursor-default opacity-50'}"
        title={getPrLabel(pr)}
        data-sidebar-pr-link
        data-sidebar-pr-url={pr.url}
        data-pr-identity={pr.identity}
        data-pr-status={pr.status}
      >
        {@render rowContent(pr)}
      </div>
    {/if}
  {/each}
</div>
