<script lang="ts">
  import type { NoteVersion } from '$shared/types';
  import { formatDistanceToNow } from '$lib/i18n/format';
  import DiffViewer from '$lib/components/ui/diff/DiffViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faRotateLeft } from '@fortawesome/free-solid-svg-icons';

  import { fetchNoteVersions } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { selectNoteVersions } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let {
    workspace,
    noteId,
    currentContent,
    visible = true,
    onRestore,
  }: {
    workspace: { id: string };
    noteId?: string;
    currentContent: string;
    visible?: boolean;
    onRestore?: (versionId: string) => void;
  } = $props();

  const noteVersionsState = selectNoteVersions(workspace.id);

  const versions = $derived(
    $noteVersionsState?.versions ? [...$noteVersionsState.versions].reverse().slice(0, 10) : [],
  );
  const loading = $derived($noteVersionsState?.loading ?? false);
  const error = $derived($noteVersionsState?.error ?? null);

  let selectedVersionIndex = $state<number | null>(null);

  // Fetch versions on mount and when visibility changes
  $effect(() => {
    if (visible && workspace?.id && noteId) {
      appStore.dispatch(fetchNoteVersions(workspace.id, noteId));
    }
  });

  // Get the content to display
  const displayContent = $derived.by(() => {
    if (selectedVersionIndex === null) {
      return currentContent;
    }
    return versions[selectedVersionIndex]?.content || '';
  });

  // Get the old content for diff view (previous version or empty)
  const oldContent = $derived.by(() => {
    if (selectedVersionIndex === null) {
      // Compare current with most recent version
      return versions[0]?.content || '';
    }
    // Compare selected version with the one before it
    const prevIndex = selectedVersionIndex + 1;
    if (prevIndex < versions.length) {
      return versions[prevIndex].content;
    }
    // If this is the oldest version, compare with empty
    return '';
  });

  // Get the new content for diff view
  const newContent = $derived.by(() => {
    return displayContent;
  });

  function formatRelativeTime(dateStr: string): string {
    return formatDistanceToNow(dateStr) || 'Unknown';
  }

  function normalizeForDiff(content: string): string {
    if (!content) return '';
    return content.replace(/\n*$/, '\n');
  }

  function getAuthorDotColor(version: NoteVersion): string {
    if (!version.author) return 'bg-zinc-400';
    switch (version.author.type) {
      case 'user':
        return 'bg-blue-500';
      case 'agent':
        return 'bg-violet-500';
      default:
        return 'bg-zinc-400';
    }
  }

  // Handle restore action
  function handleRestore() {
    if (selectedVersionIndex === null) return;

    const versionToRestore = versions[selectedVersionIndex];
    if (!versionToRestore) return;

    // Call the callback with the versionId to restore
    onRestore?.(versionToRestore.versionId);
  }
</script>

<div class="flex h-full overflow-hidden">
  <!-- Version list -->
  <div class="version-list">
    <button
      class="version-item"
      class:selected={selectedVersionIndex === null}
      onclick={() => (selectedVersionIndex = null)}
    >
      <span class="text-ui font-mono font-medium">{m.workspace_noteVersionHistory_current_label()}</span>
    </button>

    {#if loading}
      <div class="px-2.5 py-1.5 text-ui text-subtle">{m.workspace_noteVersionHistory_loading_label()}</div>
    {:else if error}
      <div class="px-2.5 py-1.5 text-ui text-destructive-foreground">{m.workspace_noteVersionHistory_error_label()}</div>
    {:else}
      {#each versions as version, index (version.versionId)}
        <button
          class="version-item"
          class:selected={selectedVersionIndex === index}
          onclick={() => (selectedVersionIndex = index)}
        >
          <span class="size-[5px] rounded-full shrink-0 {getAuthorDotColor(version)}"></span>
          <span class="text-ui font-mono font-medium">V{version.versionNumber}</span>
          <span class="text-ui text-subtle ml-auto">{formatRelativeTime(version.createdAt)}</span>
        </button>
      {/each}
    {/if}
  </div>

  <!-- Diff area -->
  <div class="flex flex-col flex-1 min-w-0">
    {#if selectedVersionIndex !== null}
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <div class="flex items-center gap-1.5 text-ui text-subtle min-w-0">
          <span class="font-medium text-foreground">V{versions[selectedVersionIndex].versionNumber}</span>
          <span>·</span>
          <span>{formatRelativeTime(versions[selectedVersionIndex].createdAt)}</span>
          {#if versions[selectedVersionIndex].author?.name}
            <span>·</span>
            <span class="truncate">{versions[selectedVersionIndex].author?.name}</span>
          {/if}
        </div>
        <Button variant="ghost-light" size="xs" onclick={handleRestore}>
          <Fa icon={faRotateLeft} class="text-ghost" size="10" />
          {m.workspace_noteVersionHistory_restore_label()}
        </Button>
      </div>
    {/if}

    <div class="flex-1 overflow-auto">
      {#key `${selectedVersionIndex}`}
        <DiffViewer
          oldContent={normalizeForDiff(oldContent)}
          newContent={normalizeForDiff(newContent)}
          fileName="note.md"
          viewMode="unified"
          showHeader={false}
          showStats={false}
          showLineNumbers
          expandUnchanged
        />
      {/key}
    </div>
  </div>
</div>

<style>
  .version-list {
    display: flex;
    flex-direction: column;
    width: 11rem;
    flex-shrink: 0;
    border-right: 1px solid hsl(var(--border));
    overflow-y: auto;
  }

  .version-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: hsl(var(--muted-foreground));
    transition: background 0.1s;
  }

  .version-item:hover {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  .version-item.selected {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }
</style>
