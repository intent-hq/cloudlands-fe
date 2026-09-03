<script lang="ts">
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  let {
    rows,
    onSelect,
    class: className = '',
  }: {
    rows: WorkspacePRPresentationRow[];
    onSelect: (pr: WorkspacePRPresentationRow) => void;
    class?: string;
  } = $props();

  function getPrLabel(pr: WorkspacePRPresentationRow): string {
    const identity = pr.repo
      ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
      : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [identity, pr.title, pr.details].filter(Boolean).join('\n');
  }

  function getPrState(pr: WorkspacePRPresentationRow): string {
    return [pr.repoContext, pr.accessibleStateLabel].filter(Boolean).join(' · ');
  }
</script>

<div class="grid w-80 max-w-[calc(100vw-2rem)] gap-1 {className}" data-sidebar-pr-list>
  {#each rows as pr (pr.identity)}
    <button
      type="button"
      class="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
      aria-label={getPrLabel(pr)}
      title={getPrLabel(pr)}
      disabled={!pr.url}
      data-sidebar-pr-link
      data-sidebar-pr-url={pr.url}
      data-pr-identity={pr.identity}
      data-pr-status={pr.status}
      onclick={() => onSelect(pr)}
    >
      <Fa icon={pr.statusIcon} size={16} class="shrink-0 {pr.foregroundClass}" />
      <span class="type-body min-w-0 truncate text-foreground">
        {pr.title || m.workspace_hoverCard_pullRequest_label()}
      </span>
      <span class="type-body shrink-0 text-muted-foreground" data-sidebar-pr-state>
        {getPrState(pr)}
      </span>
      <span class="type-body shrink-0 text-muted-foreground">#{pr.number}</span>
    </button>
  {/each}
</div>
