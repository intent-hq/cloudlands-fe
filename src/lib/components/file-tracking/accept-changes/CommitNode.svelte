<script lang="ts">
  /**
   * CommitNode - A commit in the timeline with expandable files
   *
   * `accept-changes.getStatus` ships metadata-only commits (no `files`), so
   * when `workspaceId` is provided the per-file list is lazily fetched via
   * `git.commitDetails` (PROTOCOL §5.6) on first expand.
   */
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faCodeCommit,
  faExternalLink,
  faCopy,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { appClient } from '$lib/client';
  import type { LocalCommitInfo, CommitFile } from '$features/accept-changes/types';
  import FileRow from './FileRow.svelte';
  import type { UIFileChange } from './types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    commit: LocalCommitInfo;
    /** Enables lazy `git.commitDetails` fetch when `commit.files` is absent. */
    workspaceId?: string;
    nested?: boolean;
    noBorder?: boolean;
    defaultExpanded?: boolean;
    showViewAction?: boolean;
    onFileClick?: (path: string, commitHash?: string, staged?: boolean) => void;
    onView?: (hash: string) => void;
  }

  let {
    commit,
    workspaceId,
    nested = false,
    noBorder = false,
    defaultExpanded = false,
    showViewAction = false,
    onFileClick,
    onView,
  }: Props = $props();

  // Note: We intentionally capture defaultExpanded at initialization as the initial state.
  // This is a "default" value pattern - subsequent changes to the prop don't reset expansion.
  // svelte-ignore state_referenced_locally
  let expanded = $state(defaultExpanded);
  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  // Lazily-fetched per-file data for metadata-only commits.
  let fetchedFiles = $state<CommitFile[] | null>(null);
  let fetchedForHash: string | null = null;
  let destroyed = false;

  async function copyCommitHash() {
    await navigator.clipboard.writeText(commit.hash);
    copied = true;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copied = false;
    }, 2000);
  }

  onDestroy(() => {
    if (copyTimeout) clearTimeout(copyTimeout);
    destroyed = true;
  });

  function fetchFilesIfNeeded() {
    if (commit.files || !workspaceId || fetchedForHash === commit.hash) return;
    fetchedForHash = commit.hash;
    // `commitDetails` folds transport errors to `null`; the list simply stays
    // empty on failure and a re-expand won't refetch until the hash changes.
    // eslint-disable-next-line intent/no-component-async-data-fetch -- interaction-gated lazy detail fetch (PR #214); per-commit file lists are not Redux domain state
    appClient.git.commitDetails(workspaceId, commit.hash).then((result) => {
      if (result && !destroyed && fetchedForHash === commit.hash) {
        fetchedFiles = result.fileDetails.length > 0
          ? result.fileDetails
          : result.files.map((f) => ({ path: f, additions: 0, deletions: 0 }));
      }
    });
  }

  function toggleExpanded() {
    expanded = !expanded;
    if (expanded) fetchFilesIfNeeded();
  }

  if (defaultExpanded) fetchFilesIfNeeded();

  const commitFiles = $derived<CommitFile[]>(commit.files ?? fetchedFiles ?? []);

  const files = $derived<UIFileChange[]>(
    commitFiles.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      staged: false,
    })),
  );

  // Wrap onFileClick to include commit hash
  function handleFileClick(path: string) {
    onFileClick?.(path, commit.hash);
  }
</script>

<div
  class="{noBorder
    ? ''
    : 'border border-border rounded-md shadow-xs'} overflow-hidden py-1 pl-3 pr-1.5 {nested
    ? 'pl-4'
    : ''}"
>
  <!-- Commit header -->
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="group-commit flex items-center justify-between flex-1 text-left py-0.5 hover:text-foreground transition-colors min-w-0 cursor-pointer"
      onclick={toggleExpanded}
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <Fa icon={faCodeCommit} class="h-3 w-3 text-ghost shrink-0" />
        <div class="text-sm truncate flex-1">{commit.message}</div>
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="opacity-30 hover:opacity-100 transition-opacity"
          onclick={(e) => {
            e.stopPropagation();
            copyCommitHash();
          }}
          tooltip={copied
            ? m.fileTracking_commitNode_copied_tooltip()
            : m.fileTracking_commitNode_copyCommitId_tooltip({ hash: commit.hash.slice(0, 7) })}
        >
          <Fa icon={copied ? faCheck : faCopy} class="h-2.5 w-2.5" />
        </Button>

        {#if commitFiles.length > 0}
          <LineChangesBadge
            additions={commitFiles.reduce((sum, f) => sum + f.additions, 0)}
            deletions={commitFiles.reduce((sum, f) => sum + f.deletions, 0)}
            size="xs"
          />
        {/if}
      </div>
    </button>

    {#if showViewAction}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onView?.(commit.hash)}
        tooltip={m.fileTracking_commitNode_viewCommit_tooltip()}
      >
        <Fa icon={faExternalLink} class="h-2.5 w-2.5" />
      </Button>
    {/if}
  </div>

  <!-- Files list -->
  {#if expanded && files.length > 0}
    <div class="pl-4 pt-1" transition:slide={{ duration: 150 }}>
      {#each files as file (file.path)}
        <FileRow {file} onFileClick={handleFileClick} />
      {/each}
    </div>
  {/if}
</div>
