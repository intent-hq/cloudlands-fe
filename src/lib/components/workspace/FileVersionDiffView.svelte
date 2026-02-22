<script lang="ts">
  import type { CommitInfo, WorkspaceId } from '$shared/types';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { formatDistanceToNow } from 'date-fns';
  import DiffViewer from '$lib/components/ui/diff/DiffViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import { faXmark, faUser, faPencil } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { gitClient } from '$features/git/git.client';
  import { invoke } from '$lib/electron-bridge';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  interface Props {
    workspaceId: WorkspaceId;
    filePath: string;
    /** Git commit to show diff for */
    commit?: CommitInfo;
    previousCommitHash?: string; // Hash of the commit before this one
    /** Local tracked change to show diff for */
    localChange?: TrackedChange;
    /** Absolute path to the workspace folder (for reading files from disk) */
    workspaceFolderPath?: string;
    onClose: () => void;
  }

  let { workspaceId, filePath, commit, previousCommitHash, localChange, workspaceFolderPath, onClose }: Props = $props();

  let oldContent = $state('');
  let newContent = $state('');
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Determine change type and attribution
  const isAgentChange = $derived(localChange?.attribution?.agent != null);
  const authorName = $derived.by(() => {
    if (localChange) {
      return localChange.attribution?.agent?.agentName || 'You';
    }
    return commit?.author || 'Unknown';
  });

  // Load the file content
  $effect(() => {
    if (localChange) {
      loadLocalChangeContent();
    } else if (commit) {
      loadCommitContent();
    }
  });

  async function loadLocalChangeContent() {
    loading = true;
    error = null;

    try {
      // Check if TrackedChange has content already populated
      const hasOldContent = localChange?.content?.oldContent !== undefined && localChange.content.oldContent !== '';
      const hasNewContent = localChange?.content?.newContent !== undefined && localChange.content.newContent !== '';

      if (hasOldContent && hasNewContent) {
        // Use content from TrackedChange
        oldContent = localChange!.content!.oldContent!;
        newContent = localChange!.content!.newContent!;
      } else {
        // Fetch content: old from git HEAD, new from disk
        const oldResult = await gitClient.showFile(workspaceId, filePath, 'HEAD');
        if (oldResult.ok) {
          oldContent = oldResult.data;
        } else {
          // File might be newly added - no HEAD version
          oldContent = '';
        }

        // Get new content from disk (current working directory)
        const absolutePath = workspaceFolderPath ? `${workspaceFolderPath}/${filePath}` : filePath;
        const fileResult = await invoke<{
          success: boolean;
          data?: { content: string; isBinary?: boolean } | string;
          error?: { message: string };
        }>('file:read', { path: absolutePath });

        if (fileResult.success && fileResult.data) {
          newContent = typeof fileResult.data === 'string'
            ? fileResult.data
            : fileResult.data.content;
        } else if (localChange?.status === 'deleted') {
          // File was deleted - new content is empty
          newContent = '';
        } else {
          error = fileResult.error?.message || 'Failed to read file';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load content';
    } finally {
      loading = false;
    }
  }

  async function loadCommitContent() {
    if (!commit) return;

    loading = true;
    error = null;

    try {
      // Get content at this commit
      const newResult = await gitClient.showFile(workspaceId, filePath, commit.hash);
      if (!newResult.ok) {
        error = newResult.error;
        return;
      }
      newContent = newResult.data;

      // Get content at previous commit (or empty if first commit)
      if (previousCommitHash) {
        const oldResult = await gitClient.showFile(workspaceId, filePath, previousCommitHash);
        if (oldResult.ok) {
          oldContent = oldResult.data;
        } else {
          oldContent = '';
        }
      } else {
        // Try parent commit
        const parentResult = await gitClient.showFile(workspaceId, filePath, `${commit.hash}~1`);
        if (parentResult.ok) {
          oldContent = parentResult.data;
        } else {
          oldContent = '';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load content';
    } finally {
      loading = false;
    }
  }

  function formatRelativeTime(dateInput: string | number): string {
    try {
      const date = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
      return formatDistanceToNow(date, { addSuffix: false });
    } catch {
      return 'Unknown';
    }
  }

  // Get display info for local changes
  const localChangeLabel = $derived.by(() => {
    if (!localChange) return '';
    const stage = localChange.stage === 'staged' ? 'Staged' : 'Unstaged';
    const status = localChange.status === 'added' ? 'New' :
                   localChange.status === 'deleted' ? 'Deleted' : 'Modified';
    return `${status} • ${stage}`;
  });

  // Normalize content for diff comparison
  function normalizeForDiff(content: string): string {
    if (!content) return '';
    return content.replace(/\n*$/, '\n');
  }

  const normalizedOld = $derived(normalizeForDiff(oldContent));
  const normalizedNew = $derived(normalizeForDiff(newContent));
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Version Info Banner -->
  <div
    class="flex items-center justify-between gap-4 px-4 py-3 shrink-0 border-b {localChange ? 'bg-blue-500/10 border-blue-500' : 'bg-amber-500/10 border-amber-500'}"
  >
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <!-- Avatar -->
      <div class="shrink-0">
        {#if isAgentChange}
          <AuggieAvatar size={24} />
        {:else}
          <div class="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
            <Fa icon={localChange ? faPencil : faUser} class="w-3 h-3 text-muted-foreground" />
          </div>
        {/if}
      </div>

      <!-- Details -->
      <div class="flex items-center gap-1.5 text-sm flex-wrap min-w-0">
        {#if localChange}
          <span class="text-foreground">Local changes</span>
          <span class="text-muted-foreground">•</span>
          <span class="font-medium text-foreground">{formatRelativeTime(localChange.attribution.timestamp)} ago</span>
          <span class="text-muted-foreground">by {authorName}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">{localChangeLabel}</span>
        {:else if commit}
          <span class="text-foreground">Commit</span>
          <span class="text-muted-foreground">•</span>
          <span class="font-medium text-foreground">{formatRelativeTime(commit.date)} ago</span>
          <span class="text-muted-foreground">by {commit.author}</span>
          <span class="text-muted-foreground truncate">— {commit.message}</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <Button variant="ghost" size="sm" onclick={onClose}>
        <Fa icon={faXmark} class="mr-1" />
        Back to editing
      </Button>
    </div>
  </div>

  <!-- Diff Content -->
  <div class="flex-1 overflow-auto p-4">
    {#if loading}
      <div class="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading diff...
      </div>
    {:else if error}
      <div class="flex items-center justify-center h-full text-destructive-foreground text-sm">
        {error}
      </div>
    {:else}
      <DiffViewer
        oldContent={normalizedOld}
        newContent={normalizedNew}
        fileName={filePath.split('/').pop() || 'file'}
        viewMode="unified"
        showHeader={false}
        showStats
        showLineNumbers
        expandUnchanged
      />
    {/if}
  </div>
</div>

<style>
  /* All styles now use Tailwind classes in the template */
</style>
