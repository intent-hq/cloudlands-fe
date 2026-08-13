<script lang="ts">
  /**
   * SecondaryRootChangesView - Read-only per-root changes browser
   * (multi git root tracking, monorepo#2053).
   *
   * Renders the working-tree file list and commit history of a registered
   * secondary git root via the `gitRootId`-scoped `git.status` / `git.commits`
   * reads (PROTOCOL §5.6, v6.15). Secondary roots are read-only: no staging,
   * commit, push, or PR affordances.
   */
  import { gitClient } from '$features/git/git.client';
  import type { WorkspaceGitRootEntry } from '$store/renderer/slices/git-roots/git-roots-selectors';
  import type { GitStatus, CommitInfo, WorkspaceId } from '$shared/types';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { m } from '$shared/paraglide/messages.js';
  import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    workspaceId: string;
    entry: WorkspaceGitRootEntry;
  }

  let { workspaceId, entry }: Props = $props();

  const gitRootId = $derived(entry.gitRoot?.id ?? '');

  let status = $state<GitStatus | null>(null);
  let commits = $state<CommitInfo[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const COMMIT_LIMIT = 30;

  async function load(wsId: string, rootId: string) {
    loading = true;
    loadError = null;
    const [statusResult, historyResult] = await Promise.all([
      // eslint-disable-next-line intent/no-component-async-data-fetch -- interaction-gated read-only per-root browse (monorepo#2053); secondary-root git state is transient view data, not Redux domain state
      gitClient.getStatus(wsId as WorkspaceId, { gitRootId: rootId }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- same read-only per-root browse as above
      gitClient.getHistory(wsId as WorkspaceId, COMMIT_LIMIT, { gitRootId: rootId }),
    ]);
    // Ignore stale responses after a root/workspace switch
    if (rootId !== gitRootId || wsId !== workspaceId) return;
    if (statusResult.ok) {
      status = statusResult.data;
    } else {
      status = null;
      loadError = statusResult.error;
    }
    commits = historyResult.ok ? historyResult.data : [];
    loading = false;
  }

  // Refetch whenever the selected root (or workspace) changes
  $effect(() => {
    const wsId = workspaceId;
    const rootId = gitRootId;
    status = null;
    commits = [];
    if (wsId && rootId) load(wsId, rootId);
  });

  const branchLabel = $derived(
    entry.branch || status?.branch || m.workspace_branchDisplay_noBranch_label(),
  );

  // Porcelain status char → display color (GitFileStatus wire values)
  function statusColor(statusChar: string): string {
    switch (statusChar) {
      case 'A':
      case '?':
        return 'text-green-600 dark:text-green-400';
      case 'D':
        return 'text-red-600 dark:text-red-400';
      case 'R':
      case 'C':
        return 'text-blue-600 dark:text-blue-400';
      default:
        return 'text-amber-600 dark:text-amber-400';
    }
  }
</script>

<div class="flex flex-col gap-3" data-testid="secondary-root-changes-view">
  <!-- Root branch line + read-only badge + refresh -->
  <div class="flex items-center gap-1.5 text-subtle text-xs -ml-0.5">
    <GitBranchIcon size={12} class="shrink-0 text-ghost" />
    <span class="text-ui truncate min-w-0">{branchLabel}</span>
    <span
      class="shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] uppercase tracking-wide"
      title={m.workspace_sidebarChanges_rootReadOnly_tooltip()}
      >{m.workspace_sidebarChanges_rootReadOnly_label()}</span
    >
    <button
      type="button"
      class="ml-auto p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
      onclick={() => load(workspaceId, gitRootId)}
      disabled={loading}
      title={m.workspace_sidebarChanges_refreshGitStatus_tooltip()}
    >
      <Fa icon={faArrowsRotate} class="text-subtle {loading ? 'animate-spin' : ''}" size={10} />
    </button>
  </div>

  {#if loading && !status}
    <div class="flex flex-col gap-1.5">
      <Skeleton class="h-4 w-24" />
      <Skeleton class="h-5 w-full rounded" />
      <Skeleton class="h-5 w-3/4 rounded" />
    </div>
  {:else if loadError}
    <p class="text-xs text-destructive-foreground">
      {m.workspace_sidebarChanges_rootLoadFailed_error()}
    </p>
  {:else}
    <!-- Changed files (read-only) -->
    <div>
      <p class="text-ui text-subtle mb-1">
        {m.workspace_sidebarChanges_rootChangedFiles_label()}
      </p>
      {#if status && status.files.length > 0}
        <ul class="flex flex-col">
          {#each status.files as file (`${file.staged}:${file.path}`)}
            <li class="flex items-center gap-1.5 py-0.5 min-w-0 text-xs">
              <span class="shrink-0 w-3 text-center font-mono {statusColor(file.status)}"
                >{file.status}</span
              >
              <span class="truncate min-w-0 text-foreground/90" title={file.path}
                >{file.path}</span
              >
              {#if file.staged}
                <span
                  class="shrink-0 px-1 py-px rounded bg-muted text-muted-foreground text-[10px]"
                  >{m.workspace_fileChanges_staged_label()}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-ghost">{m.workspace_sidebarChanges_rootNoChanges_label()}</p>
      {/if}
    </div>

    <!-- Commit history (read-only) -->
    <div>
      <p class="text-ui text-subtle mb-1">{m.workspace_commitsTimeline_commits_label()}</p>
      {#if commits.length > 0}
        <ul class="flex flex-col">
          {#each commits as commit (commit.hash)}
            <li class="flex items-center gap-1.5 py-0.5 min-w-0 text-xs">
              <span class="shrink-0 font-mono text-ghost">{commit.sha || commit.hash.slice(0, 7)}</span>
              <span class="truncate min-w-0 text-foreground/90" title={commit.message}
                >{commit.message.split('\n')[0]}</span
              >
              <span class="shrink-0 ml-auto text-ghost">
                <RelativeTime date={commit.date} compact />
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-ghost">{m.workspace_sidebarChanges_rootNoCommits_label()}</p>
      {/if}
    </div>
  {/if}
</div>
