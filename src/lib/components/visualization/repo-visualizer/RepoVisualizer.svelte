<script lang="ts">
  /**
   * RepoVisualizer - Main entry component for codebase visualization
   * Loads file tree data and renders the Tree visualization
   */
  import { onMount } from 'svelte';
  import { invoke } from '$lib/electron-bridge';
  import type { FileType, ColorEncoding } from './types';
  import TreeCanvas from './TreeCanvas.svelte';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('RepoVisualizer');

  interface Props {
    workspacePath: string;
    workspaceId: string;
    repoName?: string;
    filesChanged?: string[]; // Local uncommitted changes
    filesCommitted?: string[]; // Files in unpushed commits
    filesPR?: string[]; // Files in open PRs
    maxDepth?: number;
    colorEncoding?: ColorEncoding;
    customFileColors?: Record<string, string>;
    width?: number;
    height?: number;
    class?: string;
  }

  let {
    workspacePath,
     
    workspaceId: _workspaceId,
    repoName: repoNameProp,
    filesChanged = [],
    filesCommitted = [],
    filesPR = [],
    maxDepth = 50,
    colorEncoding = 'type',
    customFileColors = {},
    width = 600,
    height = 600,
    class: className,
  }: Props = $props();

  // Use provided repo name or extract from workspace path
  const repoName = $derived(repoNameProp || workspacePath.split('/').pop() || 'Repository');

  let data: FileType | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);

  // Load file tree recursively
  async function loadFileTree(): Promise<void> {
    if (!workspacePath) {
      error = 'No space path provided';
      loading = false;
      return;
    }

    try {
      loading = true;
      error = null;

      const result = await invoke('file:getTreeWithSizes', {
        path: workspacePath,
        maxDepth: maxDepth + 1,
        excludePatterns: [
          'node_modules',
          '.git',
          '.next',
          '.svelte-kit',
          'dist',
          'build',
          '.cache',
          'coverage',
          '__pycache__',
          '.DS_Store',
        ],
      });

      const typedResult = result as { success: boolean; data?: FileType; error?: string } | null;
      if (typedResult && typedResult.success && typedResult.data) {
        data = typedResult.data;
        // Debug: count files vs folders
        function countNodes(node: FileType): { files: number; folders: number } {
          if (!node.children || node.children.length === 0) {
            return { files: 1, folders: 0 };
          }
          const counts = node.children.reduce(
            (acc, child) => {
              const childCounts = countNodes(child);
              return {
                files: acc.files + childCounts.files,
                folders: acc.folders + childCounts.folders,
              };
            },
            { files: 0, folders: 1 },
          );
          return counts;
        }
        const counts = countNodes(typedResult.data);
        logger.debug('Tree loaded:', counts);
      } else {
        error = typedResult?.error || 'Failed to load file tree';
      }
    } catch (err) {
      logger.error('Failed to load file tree', { error: err });
      error = err instanceof Error ? err.message : 'Failed to load file tree';
    } finally {
      loading = false;
    }
  }

  // Load on mount and when path changes
  onMount(() => {
    loadFileTree();
  });

  $effect(() => {
    if (workspacePath) {
      loadFileTree();
    }
  });
</script>

<div class={cn('relative', className)}>
  {#if loading}
    <!-- skeleton circles -->
    <svg {width} {height} class="opacity-30">
      <circle
        cx={width * 0.44}
        cy={height * 0.6}
        r={width * 0.16}
        fill="none"
        stroke="var(--color-border)"
        stroke-width="1"
      />
      <circle
        cx={width * 0.5}
        cy={height * 0.19}
        r={width * 0.03}
        fill="none"
        stroke="var(--color-border)"
        stroke-width="1"
      />
      <circle
        cx={width * 0.65}
        cy={height * 0.25}
        r={width * 0.1}
        fill="none"
        stroke="var(--color-border)"
        stroke-width="1"
      />
    </svg>
  {:else if error}
    <div class="flex items-center justify-center" style="width: {width}px; height: {height}px">
      <div class="text-subtle text-xs text-center px-4">
        <p class="mb-1">Unable to load visualization</p>
        <p class="opacity-60">{error}</p>
      </div>
    </div>
  {:else if data}
    <TreeCanvas
      {data}
      {filesChanged}
      {filesCommitted}
      {filesPR}
      {maxDepth}
      {colorEncoding}
      {customFileColors}
      {width}
      {height}
      {repoName}
    />
  {:else}
    <div class="flex items-center justify-center" style="width: {width}px; height: {height}px">
      <div class="text-subtle text-sm">No data available</div>
    </div>
  {/if}
</div>
