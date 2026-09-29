<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { needsAttention } from './home-model';
  import { scrollFade } from '$lib/actions/scroll-fade';

  let {
    workspaces,
    selectedId,
    onselect,
    archived = false,
  }: {
    workspaces: Workspace[];
    selectedId: string | null;
    onselect: (id: string) => void;
    archived?: boolean;
  } = $props();
  function column(workspace: Workspace): string {
    if (workspace.status === WorkspaceStatusEnum.Archived) return 'archived';
    if (needsAttention(workspace)) return 'attention';
    if (workspace.activity === 'agent_running' || workspace.displayStatus === 'in_progress')
      return 'running';
    if (
      workspace.waiting ||
      workspace.displayStatus === 'pr_queued' ||
      workspace.displayStatus === 'pr_open'
    )
      return 'waiting';
    if (workspace.displayStatus === 'complete' || workspace.displayStatus === 'pr_merged')
      return 'complete';
    return 'idle';
  }
  const columns = $derived(
    archived
      ? [{ id: 'archived', label: m.home_filter_archived() }]
      : [
          { id: 'attention', label: m.home_filter_attention() },
          { id: 'running', label: m.home_filter_running() },
          { id: 'waiting', label: m.home_board_waiting() },
          { id: 'idle', label: m.home_board_idle() },
          { id: 'complete', label: m.home_board_complete() },
        ],
  );
</script>

<div
  class="min-h-0 flex-1 overflow-auto px-6 pb-5"
  data-home-board
  use:scrollFade={{ axis: 'x' }}
  aria-label={m.home_board_view()}
>
  <div class="flex min-h-full w-max gap-4">
    {#each columns as group (group.id)}
      {@const items = workspaces.filter((workspace) => column(workspace) === group.id)}
      <section class="flex w-64 shrink-0 flex-col self-stretch" aria-label={group.label}>
        <h3
          class="sticky top-0 z-20 flex items-center gap-2 bg-sidebar px-2 py-3 type-caption font-medium"
        >
          <span>{group.label}</span><span class="type-caption text-muted-foreground"
            >{formatInteger(items.length)}</span
          >
        </h3>
        <div class="flex flex-col gap-2 pb-2">
          {#each items as workspace (workspace.id)}
            <Button
              data-home-workspace={workspace.id}
              variant="outline"
              active={selectedId === workspace.id}
              aria-pressed={selectedId === workspace.id}
              wrapContent={false}
              class="h-auto w-full shrink-0 flex-col items-stretch whitespace-normal rounded-xl border-border/60 bg-muted/30 p-4 text-left"
              onclick={() => onselect(workspace.id)}
              aria-label={workspace.title}
            >
              <span class="flex items-start gap-2"
                ><WorkspaceStatusIcon status={resolveWorkspaceStatusState(workspace)} /><span
                  class="min-w-0 line-clamp-2 break-words font-medium"
                  title={workspace.title}>{workspace.title}</span
                ></span
              >
              {#if workspace.statusMessage}<span
                  class="mt-2 line-clamp-2 break-words type-caption text-muted-foreground"
                  >{workspace.statusMessage}</span
                >{/if}
              <span
                class="mt-3 flex items-center justify-between gap-2 type-caption text-muted-foreground"
                ><span class="truncate" title={workspace.branch}
                  >{workspace.branch || workspace.repositoryName}</span
                ><RelativeTime date={getWorkspaceActivityDisplayTime(workspace)} compact /></span
              >
            </Button>
          {:else}
            <p class="sr-only">
              {m.home_board_empty_column()}
            </p>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>
