<script lang="ts">
  /**
   * CommitNode - A commit in the timeline with expandable files
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
  import type { LocalCommitInfo } from '$features/accept-changes/types';
  import FileRow from './FileRow.svelte';
  import type { UIFileChange } from './types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';

  interface Props {
    commit: LocalCommitInfo;
    nested?: boolean;
    noBorder?: boolean;
    defaultExpanded?: boolean;
    showViewAction?: boolean;
    onFileClick?: (path: string, commitHash?: string, staged?: boolean) => void;
    onView?: (hash: string) => void;
  }

  let {
    commit,
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
  });

  const files = $derived<UIFileChange[]>(
    (commit.files ?? []).map((f) => ({
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
      onclick={() => (expanded = !expanded)}
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
          tooltip={copied ? 'Copied!' : `Copy commit ID: ${commit.hash.slice(0, 7)}`}
        >
          <Fa icon={copied ? faCheck : faCopy} class="h-2.5 w-2.5" />
        </Button>

        {#if commit.files && commit.files.length > 0}
          <LineChangesBadge
            additions={commit.files.reduce((sum, f) => sum + f.additions, 0)}
            deletions={commit.files.reduce((sum, f) => sum + f.deletions, 0)}
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
        tooltip="View commit"
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
