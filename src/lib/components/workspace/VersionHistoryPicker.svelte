<script lang="ts">
  import type { NoteVersion } from '$shared/types';
  import { formatDistanceToNow } from 'date-fns';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { faClockRotateLeft, faUser } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';

  interface Props {
    versions: NoteVersion[];
    selectedVersionId?: string;
    onVersionSelect: (version: NoteVersion | null) => void;
  }

  let { versions, selectedVersionId, onVersionSelect }: Props = $props();

  let isOpen = $state(false);

  const sortedVersions = $derived(
    [...versions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );

  const latestVersion = $derived(sortedVersions[0]);
  const selectedVersion = $derived(
    selectedVersionId ? versions.find((v) => v.versionId === selectedVersionId) : null,
  );

  function formatRelativeTime(dateStr: string): string {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: false });
    } catch {
      return 'Unknown';
    }
  }

  function handleVersionClick(version: NoteVersion, close: () => void) {
    onVersionSelect(version);
    close();
  }

  function handleBackToCurrent(close: () => void) {
    onVersionSelect(null);
    close();
  }

  function getAuthorDisplay(version: NoteVersion): { isAgent: boolean; name: string } {
    if (!version.author) {
      return { isAgent: false, name: 'Unknown' };
    }
    return {
      isAgent: version.author.type === 'agent',
      name: version.author.name || (version.author.type === 'agent' ? 'Agent' : 'You'),
    };
  }

  function parseDiffStats(diff?: string): { added: number; removed: number } | null {
    if (!diff) return null;
    const added = (diff.match(/^\+[^+]/gm) || []).length;
    const removed = (diff.match(/^-[^-]/gm) || []).length;
    if (added === 0 && removed === 0) return null;
    return { added, removed };
  }

  /**
   * Get a preview of the version content
   * Shows the first meaningful line of content
   */
  function getContentPreview(version: NoteVersion, maxLength = 60): string {
    if (!version.content) return '';

    // Get first non-empty line that isn't just markdown headers or whitespace
    const lines = version.content.split('\n');
    const previewLine = lines.map((l) => l.trim()).find((l) => l.length > 0 && !l.match(/^#+\s*$/)); // Skip empty headers

    if (!previewLine) return '';

    // Remove markdown formatting for cleaner preview
    const cleanLine = previewLine
      .replace(/^#+\s*/, '') // Remove heading markers
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '') // Remove italic
      .replace(/`/g, '') // Remove code
      .trim();

    if (cleanLine.length <= maxLength) return cleanLine;
    return cleanLine.slice(0, maxLength) + '…';
  }
</script>

<DropdownMenu bind:open={isOpen} align="end" side="bottom">
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <Button variant="ghost-light" size="sm" onclick={toggle} title="Version history">
      <Fa icon={faClockRotateLeft} class="w-3.5 h-3.5" />
      {#if selectedVersion}
        <span class="whitespace-nowrap">
          {#if selectedVersion}
            Viewing {formatRelativeTime(selectedVersion.createdAt)}
          {:else if latestVersion}
            {formatRelativeTime(latestVersion.createdAt)}
          {/if}
        </span>
      {/if}
    </Button>
  {/snippet}

  {#snippet content({ close }: { close: () => void })}
    <div class="min-w-[320px] max-w-[400px] overflow-hidden">
      <div class="max-h-80 overflow-y-auto">
        <!-- Back to editing button -->
        {#if selectedVersionId}
          <button
            class="flex items-center gap-2 w-full px-3 py-2.5 text-left cursor-pointer transition-colors bg-accent/50 border-b border-border hover:bg-accent"
            onclick={() => handleBackToCurrent(close)}
          >
            <span class="text-primary text-sm">←</span>
            <span class="text-sm font-medium">Back to editing</span>
          </button>
        {/if}

        {#if sortedVersions.length === 0}
          <div class="flex flex-col items-center gap-1 py-6 px-4 text-muted-foreground text-sm">
            <span>No previous versions yet</span>
            <span class="text-xs opacity-70">Versions are created automatically as you edit</span>
          </div>
        {/if}

        {#each sortedVersions as version, index (version.versionId)}
          {@const author = getAuthorDisplay(version)}
          {@const diffStats = parseDiffStats(version.diff)}
          {@const preview = getContentPreview(version)}
          {@const isSelected = version.versionId === selectedVersionId}
          {@const isCurrent = index === 0}

          <button
            class="flex flex-col gap-0.5 w-full px-3 py-2 text-left cursor-pointer transition-colors border-l-2 border-l-transparent hover:bg-accent"
            class:bg-accent={isSelected}
            class:border-l-primary={isCurrent}
            onclick={() => handleVersionClick(version, close)}
          >
            <div class="flex items-center gap-2 w-full">
              <!-- Avatar -->
              <div class="shrink-0">
                {#if author.isAgent}
                  <AuggieAvatar size={16} />
                {:else}
                  <div class="w-4 h-4 rounded-full bg-muted flex items-center justify-center">
                    <Fa icon={faUser} class="w-2 h-2 text-muted-foreground/50" />
                  </div>
                {/if}
              </div>

              <!-- Time -->
              <span class="text-xs text-muted-foreground"
                >{formatRelativeTime(version.createdAt)}</span
              >

              <!-- Diff stats -->
              {#if diffStats}
                <div class="flex gap-1 ml-auto text-[10px] font-mono">
                  <span class="text-green-600 dark:text-green-400">+{diffStats.added}</span>
                  <span class="text-red-600 dark:text-red-400">-{diffStats.removed}</span>
                </div>
              {/if}
            </div>

            <!-- Content preview -->
            {#if preview}
              <div class="text-xs text-foreground/70 truncate pl-6">
                {preview}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/snippet}
</DropdownMenu>

<style>
  /* All styles now use Tailwind classes in the template */
</style>
