<script lang="ts">
  /**
   * WalkthroughCategorySection
   *
   * Displays a category of related file changes with a vertical timeline
   * connecting the files. Each file can be expanded to show its diff.
   */
  import type { WalkthroughCategory, WalkthroughAnnotation } from './types';
  import WalkthroughFileDiff from './WalkthroughFileDiff.svelte';

  interface FileWithPatch {
    path: string;
    summary?: string;
    annotations: WalkthroughAnnotation[];
    patch?: string;
    additions?: number;
    deletions?: number;
  }

  interface Props {
    /** Category data */
    category: WalkthroughCategory;
    /** Index for styling */
    categoryIndex: number;
    /** Map of file paths to their patches */
    filePatchMap: Map<string, { patch: string; additions: number; deletions: number }>;
    /** Whether this is the last category (no timeline extension) */
    isLast?: boolean;
    /** Callback when sending a message */
    onSendMessage?: (message: string, lineNumber: number, fileName: string) => void;
    /** Whether a message is being sent */
    isSending?: boolean;
    class?: string;
  }

  let {
    category,
    categoryIndex,
    filePatchMap,
    isLast = false,
    onSendMessage,
    isSending = false,
    class: className = '',
  }: Props = $props();

  // Get color for timeline dot
  function getTimelineColor(index: number): string {
    const colors = [
      'bg-blue-500',
      'bg-purple-500',
      'bg-emerald-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-cyan-500',
    ];
    return colors[index % colors.length];
  }

  // Get files with their patches
  const filesWithPatches = $derived.by(() => {
    return category.files.map((file): FileWithPatch => {
      const patchData = filePatchMap.get(file.path);
      return {
        ...file,
        patch: patchData?.patch,
        additions: patchData?.additions ?? 0,
        deletions: patchData?.deletions ?? 0,
      };
    });
  });
</script>

<div class="walkthrough-category-section {className}" id="category-{categoryIndex}">
  <!-- Category header -->
  <div class="flex items-start gap-4 mb-4">
    <!-- Timeline dot -->
    <div class="relative flex flex-col items-center">
      <div class="w-3 h-3 rounded-full {getTimelineColor(categoryIndex)} ring-4 ring-background shrink-0"></div>
      {#if !isLast || filesWithPatches.length > 0}
        <div class="w-0.5 flex-1 bg-border/50 min-h-5"></div>
      {/if}
    </div>

    <!-- Category info -->
    <div class="flex-1 min-w-0 -mt-0.5">
      <h3 class="text-base font-semibold text-foreground">{category.title}</h3>
      <p class="text-sm text-subtle mt-1">{category.description}</p>
    </div>
  </div>

  <!-- Files in this category -->
  <div class="relative">
    {#each filesWithPatches as file, fileIndex (`${categoryIndex}-${fileIndex}`)}
      <div class="flex gap-4">
        <!-- Timeline line -->
        <div class="relative flex flex-col items-center w-3">
          <!-- Connecting line -->
          <div class="w-0.5 flex-1 bg-border/50 {fileIndex === filesWithPatches.length - 1 && isLast ? 'h-1/2' : ''}"></div>
          <!-- File dot -->
          <div class="absolute top-4 w-2 h-2 rounded-full bg-muted-foreground/30 ring-2 ring-background"></div>
        </div>

        <!-- File diff -->
        <div class="flex-1 min-w-0 pb-4">
          {#if file.patch}
            <WalkthroughFileDiff
              fileName={file.path}
              patch={file.patch}
              annotations={file.annotations}
              additions={file.additions}
              deletions={file.deletions}
              fileDescription={file.summary}
              {onSendMessage}
              {isSending}
              class="rounded-lg border border-border/50 overflow-hidden"
            />
          {:else}
            <!-- File without patch (just show name) -->
            <div class="rounded-lg border border-border/50 bg-card p-4">
              <div class="flex items-center gap-2">
                <svg class="h-4 w-4 text-ghost" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.5 1.5A1.5 1.5 0 0 1 5 0h6a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 11 15H5a1.5 1.5 0 0 1-1.5-1.5v-12z"/>
                </svg>
                <span class="text-sm font-medium text-foreground">{file.path}</span>
              </div>
              {#if file.summary}
                <p class="text-sm text-subtle mt-2">{file.summary}</p>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
