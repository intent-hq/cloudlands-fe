<script lang="ts">
  import type { TrackedChange } from '$features/file-tracking/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import TreeNode from './TreeNode.svelte';
  import {
  faFileCode,
  faPlus,
  faMinus,
  faRotateLeft,
  faFileAlt,
  faImage,
  faArchive,
  faCog,
  faFile,
} from '@fortawesome/free-solid-svg-icons';
  import {
  ListContainer,
  ListItem,
} from '$lib/components/ui/list';
  import { createLogger } from '$lib/utils/client-logger';
  import { ChangeStage } from '$features/file-tracking/types';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('FileChangesList');

  interface Props {
    changes: TrackedChange[];
    viewMode?: 'list' | 'tree';
    showStats?: boolean;
    showActions?: boolean;
    selectedChangeId?: string;
    onFileClick?: (change: TrackedChange) => void;
    onExpandClick?: (change: TrackedChange) => void;
    onStageClick?: (change: TrackedChange) => void;
    onUnstageClick?: (change: TrackedChange) => void;
    onRevertClick?: (change: TrackedChange) => void;
  }

  let {
    changes = [],
    viewMode = 'list',
    showStats = true,
    showActions = false,
    selectedChangeId,
    onFileClick,
    onExpandClick,
    onStageClick,
    onUnstageClick,
    onRevertClick,
  }: Props = $props();

  // Determine if we should show tree view
  const showTreeView = $derived(viewMode === 'tree');

  // Get file icon based on extension
  function getFileIcon(fileName = '') {
    return faFile;
    const ext = fileName.split('.').pop()?.toLowerCase();

    const codeExtensions = [
      'js',
      'ts',
      'jsx',
      'tsx',
      'svelte',
      'vue',
      'py',
      'rs',
      'go',
      'java',
      'cpp',
      'c',
      'h',
      'hpp',
    ];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'];
    const archiveExtensions = ['zip', 'tar', 'gz', 'rar', '7z'];
    const configExtensions = ['json', 'yaml', 'yml', 'toml', 'ini', 'env'];

    if (codeExtensions.includes(ext || '')) return faFileCode;
    if (imageExtensions.includes(ext || '')) return faImage;
    if (archiveExtensions.includes(ext || '')) return faArchive;
    if (configExtensions.includes(ext || '')) return faCog;

    return faFileAlt;
  }

  // Determine the type of change
  // Uses status field if available (set by git-integration.service), falls back to stats-based heuristic
  function getChangeType(change: TrackedChange): 'added' | 'deleted' | 'modified' {
    // Use explicit status if available
    if (change.status === 'added') return 'added';
    if (change.status === 'deleted') return 'deleted';
    if (change.status === 'modified' || change.status === 'renamed') return 'modified';

    // Fallback to stats-based heuristic (for backward compatibility)
    const { additions, deletions } = change.stats;
    if (additions > 0 && deletions === 0) return 'added';
    if (deletions > 0 && additions === 0) return 'deleted';
    return 'modified';
  }

  // Get the appropriate label for the revert/discard/restore action
  function getRevertLabel(change: TrackedChange): string {
    const type = getChangeType(change);
    switch (type) {
      case 'added':
        return m.fileTracking_changes_delete_label();
      case 'deleted':
        return m.fileTracking_changes_restore_label();
      default:
        return m.fileTracking_changes_discard_label();
    }
  }

  // Get the appropriate tooltip for the revert/discard/restore action
  function getRevertTooltip(change: TrackedChange): string {
    const type = getChangeType(change);
    switch (type) {
      case 'added':
        return m.fileTracking_changes_deleteNewFile_tooltip();
      case 'deleted':
        return m.fileTracking_changes_restoreDeletedFile_tooltip();
      default:
        return m.fileTracking_changes_discardChanges_tooltip();
    }
  }

  // Helper function to extract filename and directory from path
  function parseFilePath(path: string | undefined) {
    if (!path) {
      return { filename: '', directory: '' };
    }
    // Remove trailing slashes to handle directory-like paths
    const cleanPath = path.replace(/\/+$/, '');
    const lastSlashIndex = cleanPath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return { filename: cleanPath, directory: '' };
    }
    const result = {
      filename: cleanPath.substring(lastSlashIndex + 1),
      directory: cleanPath.substring(0, lastSlashIndex),
    };
    // Debug: log if filename is empty (indicates a path issue)
    if (!result.filename) {
      logger.warn('parseFilePath: empty filename detected', { path, cleanPath, result });
    }
    return result;
  }

  // Sort changes like file explorer: folders first (alphabetically), then files (alphabetically)
  function sortChangesExplorerStyle(changes: TrackedChange[]): TrackedChange[] {
    return [...changes].sort((a, b) => {
      // Use relativePath if available, otherwise fall back to file
      const pathA = parseFilePath(a.relativePath || a.file);
      const pathB = parseFilePath(b.relativePath || b.file);

      // First sort by directory
      if (pathA.directory !== pathB.directory) {
        return pathA.directory.localeCompare(pathB.directory);
      }

      // Then sort by filename within the same directory
      return pathA.filename.localeCompare(pathB.filename);
    });
  }

  // Build tree structure from flat list
  function buildTree(changes: TrackedChange[]) {
    const tree: any = {};

    // Sort changes first to ensure consistent tree structure
    const sorted = sortChangesExplorerStyle(changes);

    sorted.forEach((change) => {
      const path = change.relativePath || change.file;
      if (!path) return; // Skip if no path available

      // Filter out empty parts (e.g., from trailing slashes or malformed paths)
      const parts = path.split('/').filter((p) => p.length > 0);
      if (parts.length === 0) return; // Skip if no valid parts

      let current = tree;

      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // File node
          current[part] = {
            type: 'file',
            change,
            name: part,
          };
        } else {
          // Directory node
          if (!current[part]) {
            current[part] = {
              type: 'directory',
              name: part,
              children: {},
              expanded: true,
            };
          }
          current = current[part].children;
        }
      });
    });

    return tree;
  }

  // Helper to sort tree entries (directories first, then files, both alphabetically)
  function sortTreeEntries(entries: [string, any][]): [string, any][] {
    return entries.sort(([nameA, nodeA], [nameB, nodeB]) => {
      // Directories come before files
      if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
      if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
      // Within same type, sort alphabetically
      return nameA.localeCompare(nameB);
    });
  }

  const treeData = $derived(showTreeView ? buildTree(changes) : null);

  // PERF: Memoize sorted changes by comparing change IDs.
  // Only re-sort when the list of changes actually changes (different IDs or count).
  let lastChangesKey = '';
  let lastSortedChanges: TrackedChange[] = [];

  const sortedChanges = $derived.by(() => {
    // Create a key from change IDs to detect actual changes
    const changesKey = changes.map((c) => c.id).join('|');
    if (changesKey === lastChangesKey && lastSortedChanges.length > 0) {
      // No actual change in the list, return cached result
      return lastSortedChanges;
    }
    // Changes have actually changed, re-sort
    lastChangesKey = changesKey;
    lastSortedChanges = sortChangesExplorerStyle(changes);
    return lastSortedChanges;
  });
</script>

<!-- File list -->
<div class="flex flex-col">
  {#if changes.length === 0}
    <!-- No changes message -->
    <div class="p-8 text-center text-subtle">
      <p class="text-sm">{m.fileTracking_changes_noChanges_label()}</p>
    </div>
  {:else if showTreeView && treeData}
    <!-- Tree view -->
    <div class="space-y-0.5">
      {#each sortTreeEntries(Object.entries(treeData)) as [name, node] (name)}
        <TreeNode
          {node}
          level={0}
          {showStats}
          {showActions}
          {selectedChangeId}
          {onFileClick}
          {onExpandClick}
          {onStageClick}
          {onUnstageClick}
          {onRevertClick}
        />
      {/each}
    </div>
  {:else}
    <!-- Flat view -->
    <ListContainer spacing="compact">
      {#each sortedChanges as change (change.id)}
        {@const pathInfo = parseFilePath(change.relativePath || change.file)}
        <ListItem
          icon={getFileIcon(change.relativePath || change.file)}
          iconClass="text-ghost"
          title={pathInfo.filename}
          titleClass="max-w-[calc(100%_-_2rem)]"
          subtitle={pathInfo.directory}
          subtitleClass="text-xs opacity-60"
          active={selectedChangeId === change.id}
          onclick={() => onFileClick?.(change)}
          class="relative group/row"
          size="sm"
          actionsClass="absolute right-1.5"
          actions={showActions
            ? ([
                // Revert/Discard/Restore action for unstaged files
                change.stage === ChangeStage.Unstaged && onRevertClick
                  ? {
                      icon: faRotateLeft,
                      label: getRevertLabel(change),
                      tooltip: getRevertTooltip(change),
                      onClick: (e: MouseEvent) => {
                        e.stopPropagation();
                        onRevertClick(change);
                      },
                      className: 'text-subtle',
                    }
                  : null,
                // Stage/Unstage action
                change.stage === ChangeStage.Unstaged && onStageClick
                  ? {
                      icon: faPlus,
                      label: 'Stage',
                      onClick: (e: MouseEvent) => {
                        e.stopPropagation();
                        onStageClick(change);
                      },
                      className: 'text-subtle',
                    }
                  : change.stage === ChangeStage.Staged && onUnstageClick
                    ? {
                        icon: faMinus,
                        label: 'Unstage',
                        onClick: (e: MouseEvent) => {
                          e.stopPropagation();
                          onUnstageClick(change);
                        },
                        className: 'text-subtle',
                      }
                    : null,
              ].filter(Boolean) as any[])
            : []}
          actionsVisible="hover"
        >
          {#if showStats}
            <div class="ml-auto shrink-0 group-hover/row:opacity-0">
              <LineChangesBadge
                additions={change.stats.additions}
                deletions={change.stats.deletions}
                size="xs"
              />
            </div>
          {/if}
        </ListItem>
      {/each}
    </ListContainer>
  {/if}
</div>
