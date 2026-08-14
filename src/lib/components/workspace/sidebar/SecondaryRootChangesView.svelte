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
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { m } from '$shared/paraglide/messages.js';
  import { faArrowsRotate, faChevronDown, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';

  interface Props {
    workspaceId: string;
    entry: WorkspaceGitRootEntry;
  }

  let { workspaceId, entry }: Props = $props();

  const gitRootId = $derived(entry.gitRoot?.id ?? '');
  // The root's HEAD when first tracked (registration or sweep backfill);
  // absent while unknown — the boundary the commit list splits at.
  const registeredCommitSha = $derived(entry.gitRoot?.registeredCommitSha ?? '');

  let status = $state<GitStatus | null>(null);
  let commits = $state<CommitInfo[]>([]);
  let nextToken = $state<string | undefined>(undefined);
  let loading = $state(false);
  let loadingMore = $state(false);
  let olderExpanded = $state(false);
  let loadError = $state<string | null>(null);
  // Monotonic request epoch: only the most recent load may apply its results,
  // so an older in-flight response can't overwrite a newer refresh.
  let requestEpoch = 0;

  const COMMIT_LIMIT = 30;

  async function load(wsId: string, rootId: string) {
    const epoch = ++requestEpoch;
    loading = true;
    loadError = null;
    const [statusResult, historyResult] = await Promise.all([
      // eslint-disable-next-line intent/no-component-async-data-fetch -- interaction-gated read-only per-root browse (monorepo#2053); secondary-root git state is transient view data, not Redux domain state
      gitClient.getStatus(wsId as WorkspaceId, { gitRootId: rootId }),
      // eslint-disable-next-line intent/no-component-async-data-fetch -- same read-only per-root browse as above
      gitClient.getHistory(wsId as WorkspaceId, COMMIT_LIMIT, { gitRootId: rootId }),
    ]);
    // Ignore stale responses: superseded by a newer load, or the selected
    // root/workspace changed while this one was in flight.
    if (epoch !== requestEpoch) return;
    if (rootId !== gitRootId || wsId !== workspaceId) return;
    if (statusResult.ok) {
      status = statusResult.data;
    } else {
      status = null;
      loadError = statusResult.error;
    }
    if (historyResult.ok) {
      commits = historyResult.data.items;
      nextToken = historyResult.data.nextToken;
    } else {
      // A commits failure must surface as the error state, not a
      // plausible-but-wrong "No commits" empty state.
      commits = [];
      nextToken = undefined;
      loadError = loadError ?? historyResult.error;
    }
    loading = false;
  }

  // Next `git.commits` page (same gitRootId scope), appended to the loaded
  // list — used when the registration boundary is beyond the loaded page.
  async function loadMore(wsId: string, rootId: string) {
    const token = nextToken;
    if (!token || loadingMore) return;
    const epoch = requestEpoch;
    loadingMore = true;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- same read-only per-root browse as load()
    const result = await gitClient.getHistory(wsId as WorkspaceId, COMMIT_LIMIT, {
      gitRootId: rootId,
      nextToken: token,
    });
    // The request is settled either way; clear the flag before the stale
    // guards so a discarded response can't wedge the affordance.
    loadingMore = false;
    if (epoch !== requestEpoch) return;
    if (rootId !== gitRootId || wsId !== workspaceId) return;
    // A concurrent refresh may have replaced the page this token came from
    // (it bumps the epoch before loadMore captures it, so the epoch guard
    // alone can't catch that interleave).
    if (token !== nextToken) return;
    if (result.ok) {
      // De-dup on append: the daemon token is an offset skip token, so a
      // commit landing between pages shifts offsets and repeats the tail —
      // duplicate hashes would crash the keyed {#each}.
      const seen = new Set(commits.map((c) => c.hash));
      commits = [...commits, ...result.data.items.filter((c) => !seen.has(c.hash))];
      nextToken = result.data.nextToken;
    } else {
      loadError = result.error;
    }
  }

  // Refetch whenever the selected root (or workspace) changes
  $effect(() => {
    const wsId = workspaceId;
    const rootId = gitRootId;
    status = null;
    commits = [];
    nextToken = undefined;
    olderExpanded = false;
    loadingMore = false;
    if (wsId && rootId) load(wsId, rootId);
  });

  // Split at the registration boundary: commits strictly newer than
  // `registeredCommitSha` render normally; the boundary commit and everything
  // older render dimmed behind the expander. Fail-open (`boundaryIndex < 0`):
  // no registeredCommitSha, or the SHA is not in the loaded pages (rebased
  // away, or simply beyond the loaded window — "Show more" extends it).
  const boundaryIndex = $derived(
    registeredCommitSha ? commits.findIndex((c) => c.hash === registeredCommitSha) : -1,
  );
  const recentCommits = $derived(boundaryIndex >= 0 ? commits.slice(0, boundaryIndex) : commits);
  const olderCommits = $derived(boundaryIndex >= 0 ? commits.slice(boundaryIndex) : []);

  // Prefer the freshly loaded status over the cached git-root list entry so
  // a refresh after a branch checkout shows the new branch immediately.
  const branchName = $derived(status?.branch || entry.branch || '');
  const branchLabel = $derived(branchName || m.workspace_branchDisplay_noBranch_label());

  async function copyBranch() {
    if (!branchName) return;
    try {
      await writeTextToClipboard(branchName);
      toast.success(m.workspace_sidebarChanges_branchCopied_label());
    } catch {
      toast.error(m.workspace_sidebarChanges_copyBranchFailed_error());
    }
  }

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
    {#if branchName}
      <Button
        type="button"
        variant="plain"
        class="text-ui h-auto min-w-0 cursor-pointer justify-start truncate text-left font-inherit hover:text-foreground"
        onclick={copyBranch}
        title={m.workspace_sidebarChanges_copyBranch_tooltip()}
        aria-label={m.workspace_sidebarChanges_copyBranch_ariaLabel({ branch: branchName })}
        data-testid="secondary-root-branch-copy">{branchLabel}</Button
      >
    {:else}
      <span class="text-ui truncate min-w-0">{branchLabel}</span>
    {/if}
    <span
      class="shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs uppercase tracking-wide"
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
              <span class="truncate min-w-0 text-foreground" title={file.path}
                >{file.path}</span
              >
              {#if file.staged}
                <span
                  class="shrink-0 px-1 py-px rounded bg-muted text-muted-foreground text-xs"
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
        {#if recentCommits.length > 0}
          <ul class="flex flex-col">
            {#each recentCommits as commit (commit.hash)}
              {@render commitRow(commit)}
            {/each}
          </ul>
        {/if}

        {#if olderCommits.length > 0}
          <!-- Registration boundary divider + older-commits expander -->
          <button
            type="button"
            class="group/boundary relative w-full cursor-pointer text-left"
            data-testid="secondary-root-boundary-toggle"
            aria-expanded={olderExpanded}
            aria-label={m.workspace_sidebarChanges_rootShowOlder_ariaLabel()}
            onclick={() => (olderExpanded = !olderExpanded)}
          >
            <div
              class="relative flex items-center gap-2 pr-3 w-fit bg-sidebar mr-auto py-1.5 z-10 group-hover/boundary:opacity-100 {olderExpanded
                ? 'opacity-100'
                : 'opacity-60'}"
            >
              <span class="flex items-center gap-1.5 text-ui text-subtle bg-sidebar select-none">
                {m.workspace_sidebarChanges_rootRegistered_label()}
                <Fa
                  icon={faChevronDown}
                  size="xs"
                  class="opacity-50 transition-transform {olderExpanded ? 'rotate-180' : ''}"
                />
              </span>
            </div>
            <div class="absolute top-3.5 left-0 right-0 flex-1 border-t border-border/50"></div>
          </button>

          {#if olderExpanded}
            <!-- Older commits (dimmed, at/below the registration boundary) -->
            <ul
              class="flex flex-col opacity-60 hover:opacity-100 transition-opacity"
              data-testid="secondary-root-older-commits"
            >
              {#each olderCommits as commit (commit.hash)}
                {@render commitRow(commit)}
              {/each}
            </ul>
          {/if}
        {:else if registeredCommitSha && nextToken}
          <!-- Boundary not in the loaded pages: extend the window -->
          <button
            type="button"
            class="w-full text-ui text-ghost hover:text-muted-foreground py-1 transition-colors cursor-pointer"
            data-testid="secondary-root-show-more"
            disabled={loadingMore}
            onclick={() => loadMore(workspaceId, gitRootId)}
          >
            {#if loadingMore}
              <Fa icon={faSpinner} class="animate-spin mr-1" size="xs" />
            {/if}
            {m.workspace_sidebarChanges_rootShowMoreCommits_label()}
          </button>
        {/if}
      {:else}
        <p class="text-xs text-ghost">{m.workspace_sidebarChanges_rootNoCommits_label()}</p>
      {/if}
    </div>
  {/if}
</div>

{#snippet commitRow(commit: CommitInfo)}
  <li class="flex items-center gap-1.5 py-0.5 min-w-0 text-xs">
    <span class="shrink-0 font-mono text-ghost">{commit.sha || commit.hash.slice(0, 7)}</span>
    <span class="truncate min-w-0 text-foreground" title={commit.message}
      >{commit.message.split('\n')[0]}</span
    >
    <span class="shrink-0 ml-auto text-ghost">
      <RelativeTime date={commit.date} compact />
    </span>
  </li>
{/snippet}
