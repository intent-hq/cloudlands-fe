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
  import type { CommitFile } from '$features/file-tracking/types';
  import type { WorkspaceGitRootEntry } from '$store/renderer/slices/git-roots/git-roots-selectors';
  import { openWorkspaceCommitChangeset } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { GitStatus, CommitInfo, WorkspaceId } from '$shared/types';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { appClient } from '$lib/client';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { logger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import {
    faArrowsRotate,
    faChevronDown,
    faCodeCommit,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
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
  // Per-commit expand state + lazily-fetched file lists, mirroring the
  // primary CommitsTimeline rows: the `git.commits` list payload is
  // metadata-only (PROTOCOL §5.6), so files are fetched via
  // `git.commitDetails` (gitRootId-scoped) on first expand. `null` marks an
  // in-flight fetch; it is cleared on failure so a later expand retries.
  let expandedCommits = $state<Set<string>>(new Set());
  let commitFileCache = $state<Record<string, CommitFile[] | null>>({});
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
    expandedCommits = new Set();
    commitFileCache = {};
    if (wsId && rootId) load(wsId, rootId);
  });

  // Open the commit's changeset in the changes tab, scoped to this root.
  function openCommitChangeset(commit: CommitInfo) {
    appStore.dispatch(
      openWorkspaceCommitChangeset(workspaceId, commit.hash, commit.message, { gitRootId }),
    );
  }

  function toggleCommitExpanded(commit: CommitInfo) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(commit.hash)) {
      newSet.delete(commit.hash);
    } else {
      newSet.add(commit.hash);
      fetchCommitFilesIfNeeded(commit);
    }
    expandedCommits = newSet;
  }

  function clearCommitFileMarker(hash: string) {
    if (commitFileCache[hash] === null) {
      const { [hash]: _, ...rest } = commitFileCache;
      commitFileCache = rest;
    }
  }

  // Lazy per-commit file fetch on first expand — `git.commitDetails`
  // (PROTOCOL §5.6) scoped by gitRootId. `commitDetails` folds transport
  // errors to `null`; the row simply shows no files on failure and a later
  // expand retries (the in-flight marker is cleared on both failure paths).
  async function fetchCommitFiles(wsId: string, rootId: string, hash: string) {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- same read-only per-root browse as load()
    const result = await appClient.git.commitDetails(wsId, hash, { gitRootId: rootId });
    // The root/workspace switch $effect resets the cache; drop a stale
    // response so it can't repopulate the new root's cache.
    if (rootId !== gitRootId || wsId !== workspaceId) return;
    if (!result) {
      clearCommitFileMarker(hash);
      return;
    }
    const files: CommitFile[] =
      result.fileDetails.length > 0
        ? result.fileDetails
        : result.files.map((f) => ({ path: f, additions: 0, deletions: 0 }));
    commitFileCache = { ...commitFileCache, [hash]: files };
  }

  function fetchCommitFilesIfNeeded(commit: CommitInfo) {
    if (commitFileCache[commit.hash] !== undefined || !workspaceId || !gitRootId) return;
    const wsId = workspaceId;
    const rootId = gitRootId;
    commitFileCache = { ...commitFileCache, [commit.hash]: null };
    fetchCommitFiles(wsId, rootId, commit.hash).catch((error) => {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- log call, not a data fetch ('client-logger' trips the import-source heuristic)
      logger.error('Failed to fetch commit details', { hash: commit.hash, error });
      if (rootId === gitRootId && wsId === workspaceId) clearCommitFileMarker(commit.hash);
    });
  }

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
  <!-- Root branch line + refresh -->
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
    <p class="text-xs text-error-foreground">
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
              <span class="truncate min-w-0 text-foreground" title={file.path}>{file.path}</span>
              {#if file.staged}
                <span class="shrink-0 px-1 py-px rounded bg-muted text-muted-foreground text-xs"
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
          <Button
            type="button"
            variant="plain"
            class="group/boundary relative h-auto w-full cursor-pointer justify-start text-left"
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
                  class="opacity-50 transition-transform {olderExpanded ? '' : 'rotate-90'}"
                />
              </span>
            </div>
            <div class="absolute top-3.5 left-0 right-0 flex-1 border-t border-border"></div>
          </Button>

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
          <Button
            type="button"
            variant="plain"
            class="h-auto w-full !py-1 text-ui text-ghost hover:text-muted-foreground"
            data-testid="secondary-root-show-more"
            disabled={loadingMore}
            onclick={() => loadMore(workspaceId, gitRootId)}
          >
            {#if loadingMore}
              <Fa icon={faSpinner} class="animate-spin mr-1" size="xs" />
            {/if}
            {m.workspace_sidebarChanges_rootShowMoreCommits_label()}
          </Button>
        {/if}
      {:else}
        <p class="text-xs text-ghost">{m.workspace_sidebarChanges_rootNoCommits_label()}</p>
      {/if}
    </div>
  {/if}
</div>

<!-- Read-only commit row matching the primary CommitsTimeline rows: expand
  chevron + line-changes badge, agent avatar / commit icon, clickable message
  opening the gitRootId-scoped changeset, relative time. NO push/undo/amend
  actions and no cloud/pushed indicators — secondary roots are read-only. -->
{#snippet commitRow(commit: CommitInfo)}
  {@const isExpanded = expandedCommits.has(commit.hash)}
  {@const commitFiles = commitFileCache[commit.hash] ?? []}
  {@const files = commitFiles.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    staged: false,
  })) as UIFileChange[]}
  <li class="min-w-0">
    <div class="relative flex items-center gap-1.5 py-0.5 group w-full rounded px-1 -mx-1">
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          toggleCommitExpanded(commit);
        }}
        title={m.workspace_prSection_toggleFileList_tooltip()}
        aria-expanded={isExpanded}
        aria-label={m.workspace_prSection_toggleFileList_tooltip()}
        data-testid="secondary-root-commit-toggle"
      >
        <Fa
          icon={faChevronDown}
          size={12}
          class="text-subtle shrink-0 transition-transform {isExpanded ? 'rotate-0' : 'rotate-90'}"
        />
        {#if commitFiles.length > 0}
          <LineChangesBadge
            additions={commitFiles.reduce((sum, f) => sum + (f.additions || 0), 0)}
            deletions={commitFiles.reduce((sum, f) => sum + (f.deletions || 0), 0)}
            size="xs"
          />
        {/if}
      </Button>

      <!-- Auggie avatar instead of commit icon when made by an agent - hides on hover to show chevron -->
      {#if commit.agentId}
        <span class="shrink-0 group-hover:opacity-0 transition-opacity pointer-events-none">
          <AgentAvatar agentId={commit.agentId} size={14} class="mr-[-2px]" />
        </span>
      {:else}
        <Fa icon={faCodeCommit} size="xs" class="text-ghost shrink-0" />
      {/if}
      <Button
        type="button"
        variant="plain"
        class="flex h-auto items-center gap-2 flex-1 min-w-0 cursor-pointer justify-start text-left font-inherit"
        onclick={() => openCommitChangeset(commit)}
        data-testid="secondary-root-commit-open"
      >
        <span class="text-ui text-subtle truncate flex-1" title={commit.message}
          >{commit.message.split('\n')[0]}</span
        >
      </Button>
      <span class="shrink-0 ml-auto text-ghost text-xs">
        <RelativeTime date={commit.date} compact />
      </span>
    </div>

    <!-- Expanded lazy file list (read-only; clicking a file opens the same changeset) -->
    {#if isExpanded}
      <div class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px" transition:slide={{ duration: 150 }}>
        {#each files as file (file.path)}
          <FileRow {file} muted={true} onFileClick={() => openCommitChangeset(commit)} />
        {/each}
      </div>
    {/if}
  </li>
{/snippet}
