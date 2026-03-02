<script lang="ts">
  /**
   * WalkthroughSection
   *
   * A collapsible section that groups related files in the walkthrough.
   * Shows a title, description, and contains multiple diff viewers.
   */
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faChevronDown, faChevronRight, faFile } from '@fortawesome/free-solid-svg-icons';
  import type { WalkthroughSection as SectionType, WalkthroughAnnotation } from './types';
  import WalkthroughDiffViewer from './WalkthroughDiffViewer.svelte';

  interface Props {
    /** Section data */
    section: SectionType;
    /** Map of file paths to their diff content */
    fileDiffs: Map<string, string>;
    /** All annotations (will be filtered by file) */
    annotations: WalkthroughAnnotation[];
    /** Section index for display */
    index: number;
    /** Whether to start expanded */
    initialExpanded?: boolean;
    class?: string;
  }

  let {
    section,
    fileDiffs,
    annotations,
    index,
    initialExpanded = true,
    class: className = '',
  }: Props = $props();

  // Expanded state
  let expanded = $state(initialExpanded);

  // Get annotations for a specific file
  function getAnnotationsForFile(filePath: string): WalkthroughAnnotation[] {
    return annotations.filter((ann) => ann.file === filePath);
  }

  // Get diff for a file
  function getDiffForFile(filePath: string): string {
    return fileDiffs.get(filePath) || '';
  }

  // Count total annotations in this section
  const totalAnnotations = $derived(
    section.files.reduce((acc, file) => acc + getAnnotationsForFile(file).length, 0),
  );

  // Toggle expanded state
  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

<div class="walkthrough-section rounded-lg border border-border overflow-hidden {className}">
  <!-- Section header -->
  <button
    type="button"
    class="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
    onclick={toggleExpanded}
  >
    <Fa icon={expanded ? faChevronDown : faChevronRight} class="h-3.5 w-3.5 text-ghost" />

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-subtle">Section {index + 1}</span>
        <span class="text-sm font-medium truncate">{section.title}</span>
      </div>
      {#if section.description}
        <p class="text-xs text-subtle mt-0.5 truncate">{section.description}</p>
      {/if}
    </div>

    <div class="flex items-center gap-3 text-xs text-subtle shrink-0">
      <span class="flex items-center gap-1">
        <Fa icon={faFile} class="h-3 w-3" />
        {section.files.length}
      </span>
      <span>{totalAnnotations} annotation{totalAnnotations === 1 ? '' : 's'}</span>
    </div>
  </button>

  <!-- Section content -->
  {#if expanded}
    <div class="p-4 space-y-4" transition:slide={{ duration: 200 }}>
      {#each section.files as filePath (filePath)}
        {@const diff = getDiffForFile(filePath)}
        {@const fileAnnotations = getAnnotationsForFile(filePath)}

        {#if diff}
          <WalkthroughDiffViewer
            patch={diff}
            fileName={filePath}
            annotations={fileAnnotations}
            previewLines={20}
          />
        {:else}
          <!-- File without diff (maybe new or deleted) -->
          <div class="rounded-lg border border-border p-4 bg-muted/20">
            <div class="flex items-center gap-2 text-sm text-subtle">
              <Fa icon={faFile} class="h-4 w-4" />
              <span class="font-mono">{filePath}</span>
              <span class="text-xs">(no diff available)</span>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
