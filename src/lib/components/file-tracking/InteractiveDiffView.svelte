<script lang="ts">
  /**
   * InteractiveDiffView - Main diff view for the Changes panel
   *
   * Uses the pure DiffViewer component for rendering diffs with staging controls.
   * This is the primary component for viewing file changes in the sidebar.
   */
  import type { TrackedChange } from '$features/file-tracking/types';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faFileCode,
    faRobot,
    faPlus,
    faMinus,
    faExternalLinkAlt,
    faFolderOpen,
  } from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';
  import { invoke } from '$lib/electron-bridge';
  import { DiffViewer } from '$lib/components/ui/diff';
  import { editorSettings } from '$lib/stores/editor-settings.store.svelte';
  import { LOCKED_TOOLTIP } from '$lib/utils/agent-lock-utils';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';

  const logger = createLogger('InteractiveDiffView');

  interface Props {
    change: TrackedChange;
    showStagingControls?: boolean;
    showAttribution?: boolean;
    /** Whether this file is locked (agent auto-commit pending) */
    locked?: boolean;
    onStage?: (change: TrackedChange) => void;
    onUnstage?: (change: TrackedChange) => void;
    workspaceId?: string;
  }

  let {
    change,
    showStagingControls = false,
    showAttribution = false,
    locked = false,
    onStage,
    onUnstage,
    workspaceId,
  }: Props = $props();

  // Open file in VS Code
  async function openInVSCode() {
    const filePath = change.relativePath || change.file;

    if (!filePath) {
      logger.error('Cannot open file: missing file path');
      return;
    }

    let absolutePath: string;
    if (filePath.startsWith('/')) {
      // Already absolute
      absolutePath = filePath;
    } else {
      // Need to resolve relative path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) {
        logger.error('Cannot open file: missing workspace path for relative file path');
        return;
      }
      absolutePath = `${workspacePath}/${filePath}`;
    }

    try {
      await invoke('vscode:openFile', { file: absolutePath });
    } catch (err) {
      logger.error('Failed to open file in VS Code:', err);
    }
  }

  // Reveal file in Finder
  async function revealInFolder() {
    const filePath = change.relativePath || change.file;

    if (!filePath) {
      logger.error('Cannot reveal file: missing file path');
      return;
    }

    let absolutePath: string;
    if (filePath.startsWith('/')) {
      // Already absolute
      absolutePath = filePath;
    } else {
      // Need to resolve relative path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) {
        logger.error('Cannot reveal file: missing workspace path for relative file path');
        return;
      }
      absolutePath = `${workspacePath}/${filePath}`;
    }

    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch (err) {
      logger.error('Failed to reveal file:', err);
    }
  }

  // Helper function to extract filename and directory from path
  function parseFilePath(path: string | undefined) {
    if (!path) {
      path = change.file || '';
    }
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return { filename: path, directory: '' };
    }
    return {
      filename: path.substring(lastSlashIndex + 1),
      directory: path.substring(0, lastSlashIndex),
    };
  }

  const pathInfo = $derived(parseFilePath(change.relativePath || change.file));

  // Check if we have actual content to display
  const hasContent = $derived(
    change.content?.oldContent !== undefined || change.content?.newContent !== undefined,
  );

  // Check if we only have a diff/patch string
  const hasOnlyDiff = $derived(
    !hasContent && !!change.content?.diff && change.content.diff.trim().length > 0,
  );

  // Check if this is a placeholder message for unavailable content
  const isContentUnavailable = $derived(
    change.content?.diff?.includes('Content not available for this historical change'),
  );

  // Log the state for debugging
  $effect(() => {
    logger.info('InteractiveDiffView state', {
      file: change.file,
      hasContent,
      hasOnlyDiff,
      isContentUnavailable,
      stats: change.stats,
    });
  });
</script>

<div class="flex flex-col h-full">
  <!-- Toolbar -->
  <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
    <div class="flex items-center gap-3">
      <Fa icon={faFileCode} size="sm" class="text-ghost" />
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">{pathInfo.filename}</span>
        {#if pathInfo.directory}
          <span class="text-xs text-subtle">• {pathInfo.directory}</span>
        {/if}
      </div>

      {#if showAttribution && change.attribution.agent}
        <div class="flex items-center gap-2 px-2 py-1 bg-primary/10 rounded text-xs">
          <Fa icon={faRobot} class="text-primary" size="sm" />
          <span>{change.attribution.agent.agentName}</span>
          {#if change.attribution.agent.turnNumber}
            <span class="text-subtle">Turn {change.attribution.agent.turnNumber}</span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if showStagingControls}
        {#if change.stage === 'unstaged' && onStage}
          <Button
            variant="secondary"
            size="sm"
            onclick={() => onStage(change)}
            disabled={locked}
            tooltip={locked ? LOCKED_TOOLTIP : 'Stage this file'}
            class="gap-2"
          >
            <Fa icon={faPlus} size="xs" />
            <span>Stage File</span>
          </Button>
        {:else if change.stage === 'staged' && onUnstage}
          <Button
            variant="secondary"
            size="sm"
            onclick={() => onUnstage(change)}
            disabled={locked}
            tooltip={locked ? LOCKED_TOOLTIP : 'Unstage this file'}
            class="gap-2"
          >
            <Fa icon={faMinus} size="xs" />
            <span>Unstage File</span>
          </Button>
        {/if}
      {/if}

      <Button variant="ghost" size="sm" onclick={openInVSCode} title="Open in VS Code">
        <Fa icon={faExternalLinkAlt} size="xs" />
      </Button>
      <Button variant="ghost" size="sm" onclick={revealInFolder} title="Reveal in Finder">
        <Fa icon={faFolderOpen} size="xs" />
      </Button>

      <div class="flex items-center gap-2 text-xs">
        <span class="text-green-600">+{change.stats?.additions || 0}</span>
        <span class="text-red-600">-{change.stats?.deletions || 0}</span>
      </div>
    </div>
  </div>

  <!-- Diff Content -->
  {#if isContentUnavailable}
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center space-y-4 max-w-md">
        <div class="text-subtle">
          <svg
            class="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 class="text-lg font-medium mb-2">Content Not Available</h3>
          <p class="text-sm">
            The file content for this historical change is not available. The file may have been
            modified or deleted since this event was recorded.
          </p>
          {#if change.stats && (change.stats.additions > 0 || change.stats.deletions > 0)}
            <div class="mt-4 flex items-center justify-center gap-4 text-sm">
              <span class="text-green-600">+{change.stats.additions || 0} additions</span>
              <span class="text-red-600">-{change.stats.deletions || 0} deletions</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else if hasOnlyDiff}
    <!-- Use DiffViewer when we only have a patch string (common for historical events) -->
    <div class="flex-1 overflow-auto">
      <DiffViewer
        patch={change.content?.diff || ''}
        fileName={change.relativePath || change.file}
        showHeader={false}
        viewMode={editorSettings.diffSideBySide ? 'split' : 'unified'}
      />
    </div>
  {:else if hasContent}
    <!-- Use DiffViewer with content comparison -->
    <div class="flex-1 overflow-auto">
      <DiffViewer
        oldContent={change.content?.oldContent || ''}
        newContent={change.content?.newContent || ''}
        fileName={change.relativePath || change.file}
        showHeader={false}
        viewMode={editorSettings.diffSideBySide ? 'split' : 'unified'}
      />
    </div>
  {:else}
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center space-y-4 max-w-md">
        <div class="text-subtle">
          <svg
            class="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 class="text-lg font-medium mb-2">No Changes to Display</h3>
          <p class="text-sm">This file has no content changes to display.</p>
        </div>
      </div>
    </div>
  {/if}
</div>
