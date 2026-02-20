<script lang="ts">
  import type { NoteVersion } from '$shared/types';
  import { formatDistanceToNow } from 'date-fns';
  import DiffViewer from '$lib/components/ui/diff/DiffViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import { faRotateLeft, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    version: NoteVersion;
    previousVersionContent?: string;
    onRestore: () => void;
    onClose: () => void;
  }

  let { version, previousVersionContent = '', onRestore, onClose }: Props = $props();

  const isAgent = $derived(version.author?.type === 'agent');
  const authorName = $derived(version.author?.name || (isAgent ? 'Agent' : 'You'));

  function normalizeForDiff(content: string): string {
    if (!content) return '';
    return content.replace(/\n*$/, '\n');
  }

  const normalizedOld = $derived(normalizeForDiff(previousVersionContent));
  const normalizedNew = $derived(normalizeForDiff(version.content));

  function formatRelativeTime(dateStr: string): string {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Version Info Banner -->
  <div class="flex items-center justify-between gap-3 px-3 py-2 bg-sidebar border-b border-border shrink-0">
    <div class="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
      <span class="text-muted-foreground">Viewing version from</span>
      <span class="font-medium text-foreground">{formatRelativeTime(version.createdAt)}</span>
      <span class="text-muted-foreground">by {authorName}</span>
      {#if version.changeSummary}
        <span class="text-muted-foreground truncate">— {version.changeSummary}</span>
      {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <Button variant="ghost-light" size="xs" onclick={onRestore}>
        <Fa icon={faRotateLeft} class="text-muted-foreground/50" size="10" />
        Restore
      </Button>
      <Button variant="ghost-light" size="icon-xs" onclick={onClose}>
        <Fa icon={faXmark} />
      </Button>
    </div>
  </div>

  <!-- Diff Content -->
  <div class="flex-1 overflow-auto p-4">
    <DiffViewer
      oldContent={normalizedOld}
      newContent={normalizedNew}
      fileName="note.md"
      viewMode="unified"
      showHeader={false}
      showStats
      showLineNumbers
      expandUnchanged
    />
  </div>
</div>
