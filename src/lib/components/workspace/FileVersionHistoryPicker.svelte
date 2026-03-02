<script lang="ts">
  import type { CommitInfo, WorkspaceId, Workspace } from '$shared/types';
  import { formatDistanceToNow } from '$lib/utils/date';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { faClockRotateLeft, faUser } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { gitClient } from '$features/git/git.client';
  import { createLogger } from '$lib/utils/client-logger';
  import Button from '../ui/button/button.svelte';

  const logger = createLogger('FileVersionHistoryPicker');

  interface Props {
    workspaceId: WorkspaceId;
    filePath: string;
    /** Optional workspace to get baseRef for filtering commits */
    workspace?: Workspace;
    selectedCommitHash?: string;
    /** Whether to show "Working copy" as an option (when there are local changes) */
    hasLocalChanges?: boolean;
    /** Called when a commit is selected. Provides the commit, all commits, the file content at that commit, and the content at the parent commit */
    onCommitSelect: (commit: CommitInfo | null, commits: CommitInfo[], fileContent?: string, parentContent?: string) => void;
  }

  let { workspaceId, filePath, workspace, selectedCommitHash, hasLocalChanges = false, onCommitSelect }: Props = $props();

  let isOpen = $state(false);
  let commits = $state<CommitInfo[]>([]);
  let loading = $state(false);
  let loadingContent = $state(false);
  let error = $state<string | null>(null);
  let hasLoadedOnce = $state(false);

  const latestCommit = $derived(commits[0]);
  const selectedCommit = $derived(
    selectedCommitHash ? commits.find((c) => c.hash === selectedCommitHash) : null,
  );

  async function loadHistory() {
    if (!workspaceId || !filePath || loading) return;

    loading = true;
    error = null;

    try {
      // Get file-specific commit history
      logger.info('Loading file history', { workspaceId, filePath });
      const result = await gitClient.getFileHistory(workspaceId, filePath, 20);
      if (result.ok) {
        commits = result.data;
        logger.info('Loaded file history', { commitCount: commits.length, commits: commits.map(c => ({ hash: c.hash, message: c.message })) });
      } else {
        error = result.error;
        logger.error('Failed to load file history', { error: result.error });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load history';
      logger.error('Exception loading file history', { error: err });
    } finally {
      loading = false;
      hasLoadedOnce = true;
    }
  }

  // Load history when dropdown opens (only once)
  $effect(() => {
    if (isOpen && !hasLoadedOnce && !loading) {
      loadHistory();
    }
  });

  async function selectCommit(commit: CommitInfo, close: () => void) {
    loadingContent = true;
    try {
      // Get the file content at this commit AND its parent
      // This allows showing what changed IN this commit (parent -> commit)
      logger.info('Selecting commit', { commitHash: commit.hash, filePath });

      // Fetch both the commit content and parent content in parallel
      const [commitResult, parentResult] = await Promise.all([
        gitClient.showFile(workspaceId, filePath, commit.hash),
        // Use commit^1 to get the parent commit's content
        gitClient.showFile(workspaceId, filePath, `${commit.hash}^1`),
      ]);

      if (commitResult.ok) {
        logger.info('Got file content at commit', {
          commitHash: commit.hash,
          contentLength: commitResult.data.length,
          contentPreview: commitResult.data.slice(0, 100),
          parentContentLength: parentResult.ok ? parentResult.data.length : 'failed',
        });
        // Pass both the commit content and the parent content
        onCommitSelect(commit, commits, commitResult.data, parentResult.ok ? parentResult.data : '');
      } else {
        logger.error('Failed to get file content at commit', { commitHash: commit.hash, error: commitResult.error });
        // Still select the commit even if we can't get the content
        onCommitSelect(commit, commits, undefined, undefined);
      }
    } catch (err) {
      logger.error('Exception getting file content at commit', { commitHash: commit.hash, error: err });
      // Still select the commit even if we can't get the content
      onCommitSelect(commit, commits, undefined, undefined);
    } finally {
      loadingContent = false;
      close();
    }
  }

  function formatRelativeTime(dateStr: string): string {
    try {
      return formatDistanceToNow(dateStr);
    } catch {
      return 'Unknown';
    }
  }

  function handleBackToCurrent(close: () => void) {
    onCommitSelect(null, commits, undefined);
    close();
  }

  async function handleViewLocalChanges(close: () => void) {
    // For local changes, we need to fetch HEAD content and compare to current
    loadingContent = true;
    try {
      // Get the file content at HEAD
      const result = await gitClient.showFile(workspaceId, filePath, 'HEAD');
      if (result.ok) {
        // Create a synthetic commit for "HEAD" to show the diff
        const headCommit: CommitInfo = {
          hash: 'HEAD',
          message: 'Last committed version',
          author: '',
          email: '',
          date: new Date().toISOString(),
          files: [],
        };
        onCommitSelect(headCommit, commits, result.data);
      } else {
        // If we can't get HEAD content, just go back to editing
        onCommitSelect(null, commits, undefined);
      }
    } catch {
      onCommitSelect(null, commits, undefined);
    } finally {
      loadingContent = false;
      close();
    }
  }

  function truncateMessage(message: string, maxLength = 40): string {
    if (message.length <= maxLength) return message;
    return message.slice(0, maxLength) + '…';
  }
</script>

<DropdownMenu bind:open={isOpen} align="end" side="bottom">
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <Button
      variant="ghost-light"
      size="xs"
      class=""
      onclick={toggle}
      title="File history"
    >
      <Fa icon={faClockRotateLeft} class="w-3.5 h-3.5" />
      {#if selectedCommit}
      <span class="whitespace-nowrap">
        {#if selectedCommit}
          {formatRelativeTime(selectedCommit.date)}
        {:else if latestCommit}
          {formatRelativeTime(latestCommit.date)}
        {/if}
        </span>
        {/if}
    </Button>
  {/snippet}

  {#snippet content({ close }: { close: () => void })}
    <div class="min-w-[320px] max-w-100 overflow-hidden">
      <div class="max-h-80 overflow-y-auto">
        <!-- Back to editing button -->
        {#if selectedCommitHash}
          <button
            class="flex items-center gap-2 w-full px-3 py-2.5 text-left cursor-pointer transition-colors bg-accent/50 border-b border-border hover:bg-accent"
            onclick={() => handleBackToCurrent(close)}
          >
            <span class="text-primary text-sm">←</span>
            <span class="text-sm font-medium">Back to editing</span>
          </button>
        {/if}

        <!-- Git Commits Section -->
        {#if loading}
          <div class="flex flex-col items-center gap-1 py-6 px-4 text-subtle text-sm">
            <span>Loading history...</span>
          </div>
        {:else if error}
          <div class="flex flex-col items-center gap-1 py-6 px-4 text-subtle text-sm">
            <span>Failed to load history</span>
            <span class="text-xs opacity-70">{error}</span>
          </div>
        {:else if commits.length === 0}
          <div class="flex flex-col items-center gap-1 py-6 px-4 text-subtle text-sm">
            <span>No history</span>
            <span class="text-xs opacity-70">File has no commits</span>
          </div>
        {:else}
          <!-- Working copy entry (if there are local changes) -->
          {#if hasLocalChanges}
            <div class="flex items-center gap-2 px-3 py-2 text-xs font-medium text-subtle border-b border-border bg-muted/30">
              <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
              <span>Working copy</span>
            </div>
            <button
              class="flex flex-col gap-1 w-full px-3 py-2.5 text-left cursor-pointer transition-colors border-l-2 border-l-yellow-500 hover:bg-accent"
              class:bg-accent={selectedCommitHash === 'HEAD'}
              disabled={loadingContent}
              onclick={() => handleViewLocalChanges(close)}
            >
              <div class="flex items-center gap-2 w-full">
                <span class="text-xs font-medium text-foreground">Uncommitted changes</span>
                <span class="text-ui px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 ml-auto">Modified</span>
              </div>
              <div class="text-xs text-subtle pl-0">
                View diff against last commit
              </div>
            </button>
          {/if}

          <div class="flex items-center gap-2 px-3 py-2 text-xs font-medium text-subtle border-b border-border bg-muted/30">
            <Fa icon={faClockRotateLeft} class="w-3 h-3" />
            <span>Git commits</span>
          </div>
          {#each commits as commit, index (commit.hash)}
            {@const isSelected = commit.hash === selectedCommitHash}
            {@const isCurrent = index === 0}

            <button
              class="flex flex-col gap-1 w-full px-3 py-2.5 text-left cursor-pointer transition-colors border-l-2 border-l-transparent hover:bg-accent"
              class:bg-accent={isSelected}
              class:border-l-primary={isCurrent}
              disabled={loadingContent}
              onclick={() => selectCommit(commit, close)}
            >
              <div class="flex items-center gap-2 w-full">
                <!-- Avatar -->
                <div class="shrink-0">
                  <div class="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                    <Fa icon={faUser} class="w-2.5 h-2.5 text-ghost" />
                  </div>
                </div>

                <!-- Author & Time -->
                <span class="text-xs font-medium text-foreground">{commit.author}</span>
                <span class="text-xs text-subtle">{formatRelativeTime(commit.date)}</span>

                {#if isCurrent}
                  <span class="text-ui px-1.5 py-0.5 rounded bg-primary/20 text-primary ml-auto">Latest</span>
                {/if}
              </div>

              <!-- Commit message -->
              <div class="text-xs text-subtle truncate pl-7">
                {truncateMessage(commit.message)}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/snippet}
</DropdownMenu>

<style>
  /* All styles now use Tailwind classes in the template */
</style>
