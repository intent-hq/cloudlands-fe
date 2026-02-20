<script lang="ts">
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { LocalCommitInfo } from '$features/accept-changes/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import FileChangesList from '$lib/components/file-tracking/FileChangesList.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Fa from 'svelte-fa';
  import {
    faCodeCommit,
    faCodePullRequest,
    faExternalLink,
    faArrowRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';

  interface Props {
    unstagedChanges?: TrackedChange[];
    stagedChanges?: TrackedChange[];
    selectedChangeId?: string | null;
    onOpenChange?: (change: TrackedChange) => void;
    onStageChange?: (change: TrackedChange) => void;
    onUnstageChange?: (change: TrackedChange) => void;
    onRevertChange?: (change: TrackedChange) => void;
    onAcceptChanges?: () => void;
    commits?: LocalCommitInfo[];
    unpushedCount?: number;
    pullRequests?: PRInfo[];
    onOpenCommit?: (hash: string) => void;
    onOpenPR?: (url: string) => void;
    /** View mode for file changes list (controlled by parent) */
    viewMode?: 'list' | 'tree';
    /** Loading state - show skeleton when true */
    isLoading?: boolean;
  }

  let {
    unstagedChanges = [],
    stagedChanges = [],
    selectedChangeId = null,
    onOpenChange,
    onStageChange,
    onUnstageChange,
    onRevertChange,
    onAcceptChanges,
    commits = [],
    unpushedCount = 0,
    pullRequests = [],
    onOpenCommit,
    onOpenPR,
    viewMode = 'list',
    isLoading = false,
  }: Props = $props();

  // Track which commits are expanded
  let expandedCommits = $state<Set<string>>(new Set());

  // Determine if we should show skeleton (loading and no data yet)
  // Only show skeleton on first load - not when refreshing with existing data
  const hasAnyData = $derived(
    unstagedChanges.length > 0 ||
      stagedChanges.length > 0 ||
      commits.length > 0 ||
      unpushedCount > 0 ||
      pullRequests.length > 0,
  );
  const showSkeleton = $derived(isLoading && !hasAnyData);

  // Computed values
  const localCommits = $derived(commits.filter((c) => !c.isPushed));
  const pushedCommits = $derived(commits.filter((c) => c.isPushed));
  const effectiveUnpushedCount = $derived(
    localCommits.length > 0 ? localCommits.length : unpushedCount,
  );
  const hasPRs = $derived(pullRequests.length > 0);

  function toggleCommitExpanded(hash: string) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(hash)) {
      newSet.delete(hash);
    } else {
      newSet.add(hash);
    }
    expandedCommits = newSet;
  }

  function makeCommitFileClickHandler(commitHash: string) {
    return (_filePath: string, _commitHash?: string, _staged?: boolean) => {
      onOpenCommit?.(commitHash);
    };
  }
</script>

<div class="px-3 pb-2" transition:slide={{ duration: 150 }}>
  {#if showSkeleton}
    <!-- Skeleton loader for changes list -->
    <div class="space-y-1 py-2">
      {#each Array(4) as _}
        <div class="flex items-center gap-2 py-1">
          <Skeleton class="h-3 w-3 rounded flex-shrink-0" />
          <Skeleton class="h-3 flex-1" />
          <Skeleton class="h-3 w-8" />
        </div>
      {/each}
    </div>
  {:else}
    <!-- Unstaged Changes -->
    {#if unstagedChanges.length > 0}
      <FileChangesList
        changes={unstagedChanges}
        {viewMode}
        showStats={true}
        showActions={true}
        selectedChangeId={selectedChangeId ?? undefined}
        onFileClick={onOpenChange}
        onStageClick={onStageChange}
        onRevertClick={onRevertChange}
      />
    {/if}

    <!-- Staged Changes -->
    {#if stagedChanges.length > 0}
      <div class="mt-2">
        <p class="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1">Staged</p>
        <FileChangesList
          changes={stagedChanges}
          {viewMode}
          showStats={true}
          showActions={true}
          selectedChangeId={selectedChangeId ?? undefined}
          onFileClick={onOpenChange}
          onUnstageClick={onUnstageChange}
        />
      </div>
    {/if}

    <!-- Local Commits -->
    {#if effectiveUnpushedCount > 0}
      {#if localCommits.length > 0}
        <div class="space-y-0.5 px-1">
          {#each localCommits as commit (commit.hash)}
            {@const isExpanded = expandedCommits.has(commit.hash)}
            {@const files = (commit.files ?? []).map((f) => ({
              path: f.path,
              additions: f.additions,
              deletions: f.deletions,
              staged: false,
            })) as UIFileChange[]}
            <div class="rounded-md border border-border overflow-hidden">
              <!-- Commit header -->
              <button
                type="button"
                class="group flex items-center gap-2 w-full text-left py-1.5 px-2 hover:bg-muted/50 transition-colors cursor-pointer"
                onclick={() => toggleCommitExpanded(commit.hash)}
              >
                <Fa
                  icon={faCodeCommit}
                  size="xs"
                  class="text-muted-foreground/50 shrink-0 opacity-50"
                />
                <span class="text-xs truncate flex-1">{commit.message}</span>
                {#if commit.files && commit.files.length > 0}
                  <LineChangesBadge
                    additions={commit.files.reduce((sum, f) => sum + f.additions, 0)}
                    deletions={commit.files.reduce((sum, f) => sum + f.deletions, 0)}
                    size="xs"
                  />
                {/if}
              </button>

              <!-- Files list -->
              {#if isExpanded && files.length > 0}
                <div
                  class="pl-2 pr-1.5 pb-1 pt-0.5 bg-muted/20 space-y-px"
                  transition:slide={{ duration: 150 }}
                >
                  {#each files as file (file.path)}
                    <FileRow
                      {file}
                      muted={true}
                      onFileClick={makeCommitFileClickHandler(commit.hash)}
                    />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="px-3 py-2">
          <button
            type="button"
            class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onclick={() => onAcceptChanges?.()}
          >
            <Fa icon={faCodeCommit} size="xs" class="opacity-50" />
            <span
              >{effectiveUnpushedCount} commit{effectiveUnpushedCount === 1 ? '' : 's'} ready to push</span
            >
          </button>
        </div>
      {/if}
    {/if}

    <!-- Pushed Commits -->
    {#if pushedCommits.length > 0 && !hasPRs}
      <div class="space-y-0.5 px-1">
        {#each pushedCommits as commit (commit.hash)}
          {@const isExpanded = expandedCommits.has(commit.hash)}
          {@const files = (commit.files ?? []).map((f) => ({
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            staged: false,
          })) as UIFileChange[]}
          <div class="rounded-md border border-border overflow-hidden">
            <!-- Commit header -->
            <button
              type="button"
              class="group flex items-center gap-2 w-full text-left py-1.5 px-2 hover:bg-muted/50 transition-colors cursor-pointer"
              onclick={() => toggleCommitExpanded(commit.hash)}
            >
              <Fa icon={faCodeCommit} size="xs" class="text-green-500/50 shrink-0 opacity-50" />
              <span class="text-xs truncate flex-1">{commit.message}</span>
              {#if commit.files && commit.files.length > 0}
                <LineChangesBadge
                  additions={commit.files.reduce((sum, f) => sum + f.additions, 0)}
                  deletions={commit.files.reduce((sum, f) => sum + f.deletions, 0)}
                  size="xs"
                />
              {/if}
              <Fa
                icon={faArrowRight}
                size="xs"
                class="text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>

            <!-- Files list -->
            {#if isExpanded && files.length > 0}
              <div
                class="pl-2 pr-1.5 pb-1 pt-0.5 bg-muted/20 space-y-px"
                transition:slide={{ duration: 150 }}
              >
                {#each files as file (file.path)}
                  <FileRow
                    {file}
                    muted={true}
                    onFileClick={makeCommitFileClickHandler(commit.hash)}
                  />
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Pull Requests -->
    {#if pullRequests.length > 0}
      <div class="space-y-0.5 px-1">
        {#each pullRequests as pr (pr.number)}
          {@const statusColor =
            pr.status === 'open'
              ? 'text-green-500'
              : pr.status === 'merged'
                ? 'text-purple-500'
                : 'text-muted-foreground'}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="group flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
            onclick={() => onAcceptChanges?.()}
          >
            <Fa icon={faCodePullRequest} size="xs" class="shrink-0 opacity-50 {statusColor}" />
            <span class="text-xs truncate flex-1">{pr.title}</span>
            <span class="text-[10px] text-muted-foreground/60">#{pr.number}</span>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-30 transition-opacity hover:opacity-100 cursor-pointer"
              onclick={(e) => {
                e.stopPropagation();
                onOpenPR?.(pr.htmlUrl);
              }}
            >
              <Fa icon={faExternalLink} size="xs" class="text-muted-foreground" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
