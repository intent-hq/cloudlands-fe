<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faWandMagicSparkles,
  faSpinner,
  faRotateRight,
  faChevronDown,
  faChevronRight,
  faFolderOpen,
} from '@fortawesome/free-solid-svg-icons';
  import {
  fly,
  slide,
} from 'svelte/transition';
  import { batchedGitDiff } from '$lib/components/ui/diff/diff-ipc-batcher';
  import WalkthroughFileDiff from './WalkthroughFileDiff.svelte';
  import WalkthroughCategoriesGrid from './WalkthroughCategoriesGrid.svelte';
  import WalkthroughCategorySection from './WalkthroughCategorySection.svelte';
  import type {
    CodeWalkthrough,
    WalkthroughStatus,
    WalkthroughAnnotation,
    WalkthroughCategory,
  } from './types';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
  import * as m from '$shared/paraglide/messages.js';

  const activeWorkspace = selectActiveWorkspace();

  interface Props {
    walkthrough: CodeWalkthrough | null;
    status: WalkthroughStatus;
    error?: string;
    /** Path to the workspace for loading file contents */
    workspacePath?: string;
    /** All tracked changes to show misc/other files */
    changes?: TrackedChange[];
    /** Callback to send a message to the agent */
    onSendMessage?: (message: string, lineNumber: number, fileName: string) => void;
    /** Whether a message is being sent */
    isSending?: boolean;
    onRegenerate?: () => void;
    /** Whether to show the categories grid overview */
    showCategoriesGrid?: boolean;
  }

  let {
    walkthrough,
    status,
    error = '',
    workspacePath,
    changes = [],
    onSendMessage,
    isSending = false,
    onRegenerate,
    showCategoriesGrid = true,
  }: Props = $props();

  // Derived state
  const isRunning = $derived(status === 'running');
  const isComplete = $derived(status === 'complete');
  const hasError = $derived(!!error);

  // Expand/collapse state
  let isExpanded = $state(true);
  let isOtherFilesExpanded = $state(false);

  // Cache for file diffs with stats
  let fileDiffsCache = $state<Map<string, { patch: string; additions: number; deletions: number }>>(
    new Map(),
  );

  // Get categories from walkthrough (or create default from annotations)
  const categories = $derived.by((): WalkthroughCategory[] => {
    if (walkthrough?.categories && walkthrough.categories.length > 0) {
      return walkthrough.categories;
    }
    // Fallback: create a single category from annotations
    if (walkthrough?.annotations && walkthrough.annotations.length > 0) {
      const fileMap = new Map<string, WalkthroughAnnotation[]>();
      for (const ann of walkthrough.annotations) {
        const existing = fileMap.get(ann.file) || [];
        existing.push(ann);
        fileMap.set(ann.file, existing);
      }
      return [
        {
          title: walkthrough.title,
          description: walkthrough.overview,
          files: Array.from(fileMap.entries()).map(([path, anns]) => ({
            path,
            annotations: anns.sort((a, b) => a.line - b.line),
          })),
        },
      ];
    }
    return [];
  });

  // Group annotations by file (for backwards compat)
  const annotationsByFile = $derived.by(() => {
    if (!walkthrough?.annotations) return new Map<string, WalkthroughAnnotation[]>();

    const grouped = new Map<string, WalkthroughAnnotation[]>();
    for (const ann of walkthrough.annotations) {
      const existing = grouped.get(ann.file) || [];
      existing.push(ann);
      grouped.set(ann.file, existing);
    }
    // Sort annotations within each file by line
    for (const [file, anns] of grouped) {
      grouped.set(
        file,
        anns.sort((a, b) => a.line - b.line),
      );
    }
    return grouped;
  });

  // Files mentioned in walkthrough (from categories or annotations)
  const mentionedFiles = $derived.by(() => {
    const files = new Set<string>();
    for (const cat of categories) {
      for (const file of cat.files) {
        files.add(file.path);
      }
    }
    // Also include from flat annotations
    for (const file of annotationsByFile.keys()) {
      files.add(file);
    }
    return files;
  });

  // Other files not mentioned in walkthrough
  const otherFiles = $derived.by(() => {
    return changes.filter((c) => !mentionedFiles.has(c.relativePath));
  });

  // Load diffs for all files
  $effect(() => {
    if (!walkthrough || !workspacePath) return;

    const workspace = $activeWorkspace;
    if (!workspace?.id) return;

    // Get all unique file paths
    const allFiles = new Set([...mentionedFiles, ...otherFiles.map((c) => c.relativePath)]);

    const promises: Promise<void>[] = [];

    for (const filePath of allFiles) {
      if (fileDiffsCache.has(filePath)) continue;

      // Staged diff via the daemon `git.diffs` batcher (PROTOCOL §5.6); the
      // enriched chunk carries the full old/new file sides, from which the
      // unified patch is generated (the legacy `git:diff` IPC is retired).
      const promise = batchedGitDiff(workspace.id, true, filePath)
        .then((diffChunk) => {
          if (
            diffChunk &&
            diffChunk.oldContent !== undefined &&
            diffChunk.newContent !== undefined
          ) {
            const diffString = generateUnifiedDiff(
              filePath,
              diffChunk.oldContent,
              diffChunk.newContent,
            );
            if (diffString) {
              // Get stats from changes if available
              const change = changes.find((c) => c.relativePath === filePath);
              fileDiffsCache.set(filePath, {
                patch: diffString,
                additions: change?.stats?.additions ?? 0,
                deletions: change?.stats?.deletions ?? 0,
              });
              fileDiffsCache = new Map(fileDiffsCache);
            }
          }
        })
        .catch((err) => {
          console.warn(`Failed to load diff for ${filePath}:`, err);
        });

      promises.push(promise);
    }
  });

  // Simple unified diff generator from old/new content
  function generateUnifiedDiff(fileName: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diff = `--- a/${fileName}\n+++ b/${fileName}\n`;

    // Simple line-by-line diff (not optimal but functional)
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunkStart = -1;
    let hunkLines: string[] = [];

    for (let i = 0; i < maxLen; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;

      if (oldLine === newLine) {
        if (hunkStart >= 0) {
          hunkLines.push(` ${oldLine ?? ''}`);
        }
      } else {
        if (hunkStart < 0) {
          hunkStart = Math.max(0, i - 3);
          // Add context before
          for (let j = hunkStart; j < i; j++) {
            if (j < oldLines.length) {
              hunkLines.push(` ${oldLines[j]}`);
            }
          }
        }
        if (oldLine !== undefined && (newLine === undefined || oldLine !== newLine)) {
          hunkLines.push(`-${oldLine}`);
        }
        if (newLine !== undefined && (oldLine === undefined || oldLine !== newLine)) {
          hunkLines.push(`+${newLine}`);
        }
      }
    }

    if (hunkLines.length > 0) {
      diff += `@@ -${hunkStart + 1},${oldLines.length} +${hunkStart + 1},${newLines.length} @@\n`;
      diff += hunkLines.join('\n');
    }

    return diff;
  }
</script>

<div class="border-t border-border">
  <!-- Header -->
  <button
    class="flex items-center gap-2 w-full px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
    onclick={() => (isExpanded = !isExpanded)}
  >
    <Fa icon={isExpanded ? faChevronDown : faChevronRight} class="h-3 w-3 text-subtle" />
    <Fa icon={faWandMagicSparkles} class="h-4 w-4 text-purple-500" />
    <span class="text-sm font-medium">{m.codeReview_walkthroughSection_title()}</span>
    {#if isRunning}
      <Fa icon={faSpinner} class="h-3 w-3 animate-spin text-ghost ml-auto" />
    {/if}
  </button>

  {#if isExpanded}
    <div class="px-4 pb-4" transition:slide={{ duration: 200 }}>
      <!-- Running state: Show loading -->
      {#if isRunning}
        <div class="flex items-center gap-2 text-sm text-subtle py-2">
          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
          <span>{m.codeReview_walkthroughSection_generating_label()}</span>
        </div>
      {/if}

      <!-- Error state -->
      {#if hasError}
        <div class="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
          <p class="text-sm text-destructive-foreground">{error}</p>
          {#if onRegenerate}
            <Button variant="ghost" size="xs" class="mt-2" onclick={onRegenerate}>
              <Fa icon={faRotateRight} class="h-3 w-3 mr-1" />
              {m.codeReview_walkthroughSection_tryAgain_label()}
            </Button>
          {/if}
        </div>
      {/if}

      <!-- Complete state: Show walkthrough -->
      {#if isComplete && walkthrough}
        <div class="space-y-6">
          <!-- Title -->
          {#if walkthrough.title}
            <h2
              class="text-lg font-semibold text-foreground"
              transition:fly={{ y: 4, duration: 200 }}
            >
              {walkthrough.title}
            </h2>
          {/if}

          <!-- Overview - simple italic text -->
          {#if walkthrough.overview}
            <p class="text-sm text-subtle italic" transition:fly={{ y: 4, duration: 200 }}>
              {walkthrough.overview}
            </p>
          {/if}

          <!-- Categories grid overview -->
          {#if showCategoriesGrid && categories.length > 1}
            <WalkthroughCategoriesGrid
              {categories}
              onCategoryClick={(index) => {
                const el = document.getElementById(`category-${index}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              class="pt-2"
            />
          {/if}

          <!-- Category sections with timeline -->
          {#if categories.length > 0}
            <div class="space-y-8 pt-4">
              {#each categories as category, i (i)}
                <div transition:fly={{ y: 8, duration: 200, delay: i * 100 }}>
                  <WalkthroughCategorySection
                    {category}
                    categoryIndex={i}
                    filePatchMap={fileDiffsCache}
                    isLast={i === categories.length - 1 && otherFiles.length === 0}
                    {onSendMessage}
                    {isSending}
                  />
                </div>
              {/each}
            </div>
          {/if}

          <!-- Other files not mentioned in walkthrough -->
          {#if otherFiles.length > 0}
            <div class="pt-4 border-t border-border">
              <button
                type="button"
                class="flex items-center gap-2 w-full text-left py-2 hover:bg-muted/30 rounded transition-colors"
                onclick={() => (isOtherFilesExpanded = !isOtherFilesExpanded)}
              >
                <Fa
                  icon={isOtherFilesExpanded ? faChevronDown : faChevronRight}
                  class="h-3 w-3 text-subtle"
                />
                <Fa icon={faFolderOpen} class="h-3 w-3 text-ghost" />
                <span class="text-sm font-medium text-subtle">
                  {m.codeReview_walkthroughSection_otherChanges_label({ count: otherFiles.length })}
                </span>
              </button>

              {#if isOtherFilesExpanded}
                <div class="space-y-3 pt-2" transition:slide={{ duration: 200 }}>
                  {#each otherFiles as change, i (change.id)}
                    {@const patchData = fileDiffsCache.get(change.relativePath)}
                    <div transition:fly={{ y: 8, duration: 200, delay: i * 30 }}>
                      <WalkthroughFileDiff
                        fileName={change.relativePath}
                        patch={patchData?.patch ?? ''}
                        annotations={[]}
                        initialCollapsed={true}
                        {onSendMessage}
                        {isSending}
                        additions={patchData?.additions ?? change.stats?.additions ?? 0}
                        deletions={patchData?.deletions ?? change.stats?.deletions ?? 0}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Regenerate button -->
          {#if onRegenerate}
            <div class="flex justify-end pt-2">
              <Button variant="ghost" size="xs" onclick={onRegenerate}>
                <Fa icon={faRotateRight} class="h-3 w-3 mr-1" />
                {m.codeReview_walkthroughSection_regenerate_label()}
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
