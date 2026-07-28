<script lang="ts">
  /**
   * CodeWalkthrough
   *
   * Main component for displaying a narrated code walkthrough.
   * Shows a summary, sections with grouped files, and inline annotations.
   */
  import Fa from 'svelte-fa';
  import {
  faBook,
  faSpinner,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
  import type { WalkthroughData, WalkthroughAnnotation } from './types';
  import WalkthroughSection from './WalkthroughSection.svelte';
  import { splitDiffByFile } from './patch-utils';
  import * as m from '$shared/paraglide/messages.js';

  interface Props {
    /** The walkthrough data from the agent */
    walkthrough: WalkthroughData | null;
    /** The combined diff string */
    combinedDiff: string;
    /** Loading state */
    loading?: boolean;
    /** Error message */
    error?: string | null;
    class?: string;
  }

  let {
    walkthrough,
    combinedDiff,
    loading = false,
    error = null,
    class: className = '',
  }: Props = $props();

  // Parse the combined diff into individual file diffs
  const fileDiffs = $derived(splitDiffByFile(combinedDiff));

  // Add unique IDs to annotations if not present
  const annotationsWithIds = $derived.by((): WalkthroughAnnotation[] => {
    if (!walkthrough?.annotations) return [];
    return walkthrough.annotations.map((ann: WalkthroughAnnotation, idx: number) => ({
      ...ann,
      id: ann.id || `ann-${idx}`,
    }));
  });
</script>

<div class="code-walkthrough {className}">
  {#if loading}
    <!-- Loading state -->
    <div class="flex items-center justify-center py-12 text-subtle">
      <Fa icon={faSpinner} class="h-5 w-5 animate-spin mr-2" />
      <span>{m.codeWalkthrough_main_generating_label()}</span>
    </div>
  {:else if error}
    <!-- Error state -->
    <div class="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive-foreground">
      <Fa icon={faExclamationTriangle} class="h-5 w-5 shrink-0" />
      <div>
        <p class="font-medium">{m.codeWalkthrough_main_generateFailed_error()}</p>
        <p class="text-sm opacity-80">{error}</p>
      </div>
    </div>
  {:else if walkthrough}
    <!-- Walkthrough content -->
    <div class="space-y-6">
      <!-- Header with summary -->
      <div class="flex items-start gap-3">
        <div class="p-2 rounded-lg bg-primary/10">
          <Fa icon={faBook} class="h-5 w-5 text-primary" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">{m.codeWalkthrough_main_title()}</h2>
          {#if walkthrough.summary}
            <p class="text-sm text-subtle mt-1">{walkthrough.summary}</p>
          {/if}
        </div>
      </div>

      <!-- Stats bar -->
      <div class="flex items-center gap-4 text-xs text-subtle px-1">
        <span>{m.codeWalkthrough_main_sectionCount_label({ count: walkthrough.sections?.length || 0 })}</span>
        <span>•</span>
        <span>{m.codeWalkthrough_main_fileCount_label({ count: fileDiffs.size })}</span>
        <span>•</span>
        <span>{m.codeWalkthrough_main_annotationCount_label({ count: annotationsWithIds.length })}</span>
      </div>

      <!-- Sections -->
      {#if walkthrough.sections && walkthrough.sections.length > 0}
        <div class="space-y-4">
          {#each walkthrough.sections as section, index (section.title)}
            <WalkthroughSection
              {section}
              {fileDiffs}
              annotations={annotationsWithIds}
              {index}
              initialExpanded={index === 0}
            />
          {/each}
        </div>
      {:else}
        <!-- No sections - show all files -->
        <div class="space-y-4">
          {#each [...fileDiffs.entries()] as [filePath, diff] (filePath)}
            {@const fileAnnotations = annotationsWithIds.filter((a) => a.file === filePath)}
            <WalkthroughSection
              section={{ title: filePath, description: '', files: [filePath] }}
              fileDiffs={new Map([[filePath, diff]])}
              annotations={fileAnnotations}
              index={0}
              initialExpanded={true}
            />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Empty state -->
    <div class="flex flex-col items-center justify-center py-12 text-subtle">
      <Fa icon={faBook} class="h-8 w-8 mb-3 opacity-50" />
      <p class="text-sm">{m.codeWalkthrough_main_empty_title()}</p>
      <p class="text-xs mt-1">{m.codeWalkthrough_main_empty_description()}</p>
    </div>
  {/if}
</div>
