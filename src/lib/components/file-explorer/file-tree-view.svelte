<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount, onDestroy } from 'svelte';

  // Constants
  const GIT_STATUS_REFRESH_DELAY = 300; // ms to wait for git to detect changes
  import { listenSync, invoke } from '$lib/electron-bridge';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { getFileTypeIconSvg } from '$lib/utils/file-type-icons';
  import type { FileNode, EnvironmentConfig } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import {
    getFileExplorerStore,
    deactivateFileExplorerStore,
    reactivateFileExplorerStore,
  } from './file-explorer-store.svelte';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { gitStore } from '$features/git/git.store.svelte';
  import VirtualizedFileTree from './VirtualizedFileTree.svelte';

  // Search result type from workspace:list-files
  interface SearchResult {
    name: string;
    path: string;
    relativePath: string;
    type: 'file' | 'directory';
  }

  interface Props {
    workspacePath: string;
    workspaceId?: string;
    environmentConfig?: EnvironmentConfig;
    onFileSelect?: (path: string) => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onRenameFile?: (oldPath: string, newPath: string) => void;
    onSelectAgent?: (agentId: string) => void;
    /** Callback when external files are dropped onto the tree */
    onExternalFilesDrop?: (files: File[], targetPath: string | null) => void;
    selectedFile?: string;
    isLoading?: boolean; // External loading state (e.g., from parent workspace page)
    showOnlyChanged?: boolean; // Filter to show only files with git changes
    searchQuery?: string; // External search query for filtering files
  }

  let {
    workspacePath,
    workspaceId,
    environmentConfig,
    onFileSelect,
    onCreateFile,
    onRenameFile,
    onSelectAgent,
    onExternalFilesDrop,
    selectedFile = $bindable(''),
    isLoading: externalLoading = false,
    showOnlyChanged = false,
    searchQuery = '',
  }: Props = $props();

  // Ref to VirtualizedFileTree for delegating method calls
  let virtualizedTreeRef: VirtualizedFileTree | null = $state(null);

  // Mutable reference to current workspace ID for use in event listener closures
  // This allows event callbacks to check the CURRENT workspace ID, not the captured one
  // Note: This is intentionally initialized from prop and then synced via effect below
  // svelte-ignore state_referenced_locally
  let currentWorkspaceIdRef = workspaceId;

  // Keep the mutable reference in sync with the prop
  $effect(() => {
    currentWorkspaceIdRef = workspaceId;
  });

  // Use singleton store - cached per workspace for sharing with cmd+k etc.
  // Initial store retrieval is side-effect free (just creates or returns cached store)
  // State updates are deferred inside getFileExplorerStore using queueMicrotask
  const store = $derived(getFileExplorerStore(workspacePath || '', workspaceId, environmentConfig));

  // Track the last workspaceId we initialized for, to handle workspace switches
  let lastInitializedWorkspaceId: string | undefined = undefined;

  let fileWatcher: any = null;
  let customFileChangeHandler: ((event: CustomEvent) => void) | null = null;
  let modifiedFiles = $state<Set<string>>(new Set());

  // Search state - for querying all files when filtering
  let searchResults = $state<SearchResult[]>([]);
  let isSearching = $state(false);
  let searchAbortController: AbortController | null = null;

  // Debounced search effect - queries all files when there's a search query
  $effect(() => {
    const query = searchQuery?.trim() || '';
    // Track showOnlyChanged to re-run when it changes (used in filter below)
    const filterOnlyChanged = showOnlyChanged;

    // Cancel any pending search
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }

    if (!query) {
      // Clear search results when query is empty
      searchResults = [];
      isSearching = false;
      return;
    }

    if (!workspaceId) {
      searchResults = [];
      isSearching = false;
      return;
    }

    // Don't show loader immediately - only after 500ms if still searching
    let showLoaderTimeoutId: ReturnType<typeof setTimeout> | null = null;
    searchAbortController = new AbortController();

    // Small debounce for snappy feel without too many requests
    const timeoutId = setTimeout(async () => {
      // Start loader timer - only show if search takes > 500ms
      showLoaderTimeoutId = setTimeout(() => {
        isSearching = true;
      }, 500);

      try {
        const resp = (await invoke('workspace:list-files', {
          workspaceId,
          pattern: query,
          limit: 100,
        })) as { files?: SearchResult[]; folders?: SearchResult[] } | SearchResult[];

        // Handle response format
        let files = Array.isArray(resp) ? resp : resp?.files || [];

        // Filter to only changed files if showOnlyChanged is enabled
        if (filterOnlyChanged && store.gitStatus) {
          files = files.filter((file) => {
            // Check if the file has git status (is changed)
            return store.gitStatus.has(file.relativePath);
          });
        }

        searchResults = files;
      } catch (err) {
        logger.error('Search failed:', err);
        searchResults = [];
      } finally {
        // Clear loader timer and hide loader
        if (showLoaderTimeoutId) {
          clearTimeout(showLoaderTimeoutId);
        }
        isSearching = false;
      }
    }, 50); // 50ms debounce for snappiness

    return () => {
      clearTimeout(timeoutId);
      if (showLoaderTimeoutId) {
        clearTimeout(showLoaderTimeoutId);
      }
    };
  });

  // Get Git status color based on status code
  function getGitStatusColor(status?: string): string {
    if (!status) return '';

    // First character is index status, second is working tree status
    const indexStatus = status[0];
    const workingStatus = status[1];

    if (status === '??') return 'text-gray-500'; // Untracked
    if (indexStatus === 'A' || workingStatus === 'A') return 'text-green-700 dark:text-green-400'; // Added
    if (indexStatus === 'M' || workingStatus === 'M') return 'text-yellow-700 dark:text-yellow-400'; // Modified
    if (indexStatus === 'D' || workingStatus === 'D') return 'text-red-700 dark:text-red-400'; // Deleted
    if (indexStatus === 'R' || workingStatus === 'R') return 'text-blue-700 dark:text-blue-400'; // Renamed
    if (indexStatus === 'C' || workingStatus === 'C') return 'text-cyan-700 dark:text-cyan-400'; // Copied

    return 'text-orange-500'; // Other changes
  }

  // Get Git status symbol
  function getGitStatusSymbol(status?: string): string {
    if (!status) return '';

    if (status === '??') return '?'; // Untracked
    if (status.includes('A')) return '+'; // Added
    if (status.includes('M')) return 'M'; // Modified
    if (status.includes('D')) return 'D'; // Deleted
    if (status.includes('R')) return 'R'; // Renamed
    if (status.includes('C')) return 'C'; // Copied

    return '•'; // Other changes
  }

  // Get file tooltip
  function getFileTooltip(node: FileNode): string {
    let tooltip = node.name;

    if (node.gitStatus) {
      const { status, additions, deletions } = node.gitStatus;

      if (status === '??') tooltip += ' (Untracked)';
      else if (status.includes('A')) tooltip += ' (Added)';
      else if (status.includes('M')) tooltip += ' (Modified)';
      else if (status.includes('D')) tooltip += ' (Deleted)';
      else if (status.includes('R')) tooltip += ' (Renamed)';

      if (additions || deletions) {
        tooltip += ` [+${additions || 0}, -${deletions || 0}]`;
      }
    }

    return tooltip;
  }

  // Handle file selection
  function selectFile(node: FileNode) {
    if (node.type === 'file') {
      selectedFile = node.path;
      onFileSelect?.(node.path);
    } else {
      store.toggleDirectory(node);
    }
  }

  // Mark a file as modified (called from parent component)
  export function markFileModified(filePath: string) {
    modifiedFiles.add(filePath);
    // Force re-render
    modifiedFiles = new Set(modifiedFiles);
  }

  // Mark a file as unmodified (called from parent component)
  export function markFileUnmodified(filePath: string) {
    modifiedFiles.delete(filePath);
    // Force re-render
    modifiedFiles = new Set(modifiedFiles);
  }

  // Check if a file is modified
  function isFileModified(filePath: string): boolean {
    return modifiedFiles.has(filePath);
  }

  // Check if a node or any of its children have git changes
  function hasGitChanges(node: FileNode): boolean {
    // Check if this node has git status with changes (from node property)
    if (node.gitStatus?.status) return true;
    // Check if this node has line changes
    if ((node.gitStatus?.additions ?? 0) > 0) return true;
    if ((node.gitStatus?.deletions ?? 0) > 0) return true;

    // Also check the store's git status map directly (more reliable for root-level files)
    if (node.type === 'file' && store.gitStatus) {
      const relativePath = node.path.replace(`${workspacePath}/`, '');
      if (store.gitStatus.has(relativePath)) return true;
    }

    // For directories, check children recursively
    if (node.children) {
      return node.children.some((child) => hasGitChanges(child));
    }

    // For directories without loaded children, check if any git status paths start with this dir
    if (node.type === 'directory' && store.gitStatus) {
      const relativePath = node.path.replace(`${workspacePath}/`, '');
      for (const [filePath] of store.gitStatus.entries()) {
        if (filePath.startsWith(`${relativePath}/`)) {
          return true;
        }
      }
    }

    return false;
  }

  // Filtered flattened nodes - applies showOnlyChanged filter
  const filteredFlattenedNodes = $derived.by(() => {
    const nodes = store.flattenedNodes;
    if (!showOnlyChanged) return nodes;
    // Filter to only show nodes that have git changes
    return nodes.filter((flatNode) => hasGitChanges(flatNode.node));
  });

  // Filter nodes by search query and changed files filter
  // isRoot parameter indicates if we're filtering the root level (for adding missing git files)
  function filterNodes(nodes: FileNode[], query: string, isRoot = false): FileNode[] {
    let result = nodes;

    // Filter by git changes if showOnlyChanged is enabled
    if (showOnlyChanged) {
      // Filter existing nodes for those with git changes
      result = result.filter((node) => hasGitChanges(node));

      // Only add missing root-level files from gitStatus when we're at the root level
      // This handles the case where files might not be loaded in the tree yet
      if (isRoot && store.gitStatus) {
        const existingNames = new Set(result.map((n) => n.name));
        for (const [relativePath, gitStatus] of store.gitStatus.entries()) {
          // Only handle root-level files (no "/" in path)
          if (!relativePath.includes('/') && !existingNames.has(relativePath)) {
            result.push({
              name: relativePath,
              path: `${workspacePath}/${relativePath}`,
              type: 'file',
              gitStatus,
            });
          }
        }
      }
    }

    // Filter by search query
    if (query) {
      const lowerQuery = query.toLowerCase();
      result = result.filter((node) => {
        const matches = node.name.toLowerCase().includes(lowerQuery);
        if (matches) return true;

        // Also check children for directories
        if (node.children) {
          const childMatches = filterNodes(node.children, query, false);
          return childMatches.length > 0;
        }

        return false;
      });
    }

    return result;
  }

  // Watch for file changes
  // Use listenSync for synchronous cleanup - no race conditions on unmount
  function setupFileWatcher() {
    // Listen for IPC file:changed events
    fileWatcher = listenSync('file:changed', (event: any) => {
      logger.debug('[FileTreeView] Received file:changed event', event);
      // Reload the tree when files change
      store.refresh();
    });

    // Also listen for custom file:changed events from the workspace content manager
    customFileChangeHandler = (event: CustomEvent) => {
      logger.debug('[FileTreeView] Received custom file:changed event', event.detail);
      // Check if the event is for our workspace using the mutable reference
      // to get the CURRENT workspace ID, not the one captured at listener creation
      if (event.detail?.workspaceId === currentWorkspaceIdRef) {
        const changeType = event.detail?.type;
        logger.info('[FileTreeView] File changed, refreshing', { type: changeType });

        // If this is a file creation or deletion, refresh the whole tree
        // Otherwise just refresh git status
        if (changeType === 'create' || changeType === 'add' || changeType === 'delete') {
          setTimeout(() => {
            store.refresh().catch((error) => {
              logger.error('[FileTreeView] Failed to refresh file tree after file creation', error);
            });
          }, GIT_STATUS_REFRESH_DELAY);
        } else {
          // Immediately refresh git status for file saves
          // Add a small delay to ensure git has detected the changes
          setTimeout(() => {
            store.refreshGitStatus().catch((error) => {
              logger.error(
                '[FileTreeView] Failed to refresh git status after file save',
                error as Error,
              );
            });
          }, GIT_STATUS_REFRESH_DELAY);
        }
      }
    };

    window.addEventListener('file:changed', customFileChangeHandler as EventListener);
  }

  // Watch for workspace changes (line changes updates)
  let workspaceChangesWatcher: (() => void) | null = null;
  function setupWorkspaceChangesWatcher() {
    workspaceChangesWatcher = listenSync('workspace-changes', (event: any) => {
      logger.debug('[FileTreeView] Received workspace-changes event', event);
      // Extract workspaceId from event (handle both wrapped and unwrapped formats)
      const eventWorkspaceId = event?.payload?.workspaceId || event?.workspaceId;

      // Check if the event is for our workspace using the mutable reference
      // to get the CURRENT workspace ID, not the one captured at listener creation
      if (eventWorkspaceId && eventWorkspaceId === currentWorkspaceIdRef) {
        logger.info('[FileTreeView] Syncing git status from stores due to workspace changes', {
          workspaceId: currentWorkspaceIdRef,
          eventWorkspaceId,
        });
        // Use syncGitStatusFromStores to avoid triggering network calls that would
        // cause an infinite loop (refreshGitStatus -> syncWithGit -> changes-tracked -> repeat)
        store.syncGitStatusFromStores();
      }
      // Note: We don't refresh if there's no workspace ID to avoid unnecessary updates
    });
  }

  // Watch for file tracking changes (same as CodeChangesPanel)
  let fileTrackingWatcher: (() => void) | null = null;
  let fileTrackingRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  function setupFileTrackingWatcher() {
    fileTrackingWatcher = listenSync('file-tracking:changes-updated', (event: any) => {
      logger.debug('[FileTreeView] Received file-tracking:changes-updated event', event);
      const eventWorkspaceId = event?.payload?.workspaceId || event?.workspaceId;

      // Check using the mutable reference to get the CURRENT workspace ID
      if (!eventWorkspaceId || eventWorkspaceId === currentWorkspaceIdRef) {
        // Debounce rapid file tracking events - clear existing timeout before scheduling new one
        if (fileTrackingRefreshTimeout) {
          clearTimeout(fileTrackingRefreshTimeout);
        }
        // Use a debounced timeout to batch rapid file tracking updates
        fileTrackingRefreshTimeout = setTimeout(() => {
          fileTrackingRefreshTimeout = null;
          logger.debug(
            '[FileTreeView] File tracking changes detected, syncing git status from stores',
          );
          // Use syncGitStatusFromStores to avoid triggering network calls that would
          // cause an infinite loop (refreshGitStatus -> syncWithGit -> changes-tracked -> repeat)
          store.syncGitStatusFromStores();
        }, 300); // 300ms debounce to batch rapid updates
      }
    });
  }

  let initialized = false;
  let isInitializing = false; // Guard against concurrent initialization
  let lastSyncTime = 0;

  // Watch for changes in the stores and sync local git status display
  // This ensures we stay in sync with CodeChangesPanel WITHOUT triggering cascading refreshes
  $effect(() => {
    if (initialized && workspaceId) {
      // Watch for changes in file tracking store
      const changes = fileTrackingStore.workingChanges;
      const changeCount = (changes?.unstaged?.length || 0) + (changes?.staged?.length || 0);

      // Also watch git store status
      const gitStatus = gitStore.status;

      // Debounce syncs to avoid too many updates
      const now = Date.now();
      if (now - lastSyncTime > 500) {
        lastSyncTime = now;
        logger.debug('[FileTreeView] Store changes detected, syncing local git status display', {
          changeCount,
          hasGitStatus: !!gitStatus,
        });
        // Just update local display from stores - DON'T trigger a refresh which causes cascade
        // The stores are already updated by event listeners or other components
        store.syncGitStatusFromStores().catch((error) => {
          logger.error('[FileTreeView] Failed to sync git status from stores', error as Error);
        });
      }
    }
  });

  // Helper function to initialize the file explorer for a workspace
  async function initializeForWorkspace(
    wsPath: string,
    wsId: string | undefined,
    currentStore: ReturnType<typeof getFileExplorerStore>,
  ) {
    // Prevent concurrent initialization
    if (isInitializing) {
      logger.debug('[FileTreeView] Initialization already in progress, skipping', { wsId });
      return;
    }

    // Skip if already initialized for this workspace
    if (initialized && lastInitializedWorkspaceId === wsId) {
      logger.debug('[FileTreeView] Already initialized for this workspace, skipping', { wsId });
      return;
    }

    isInitializing = true;
    logger.info('[FileTreeView] Initializing for workspace', {
      workspacePath: wsPath,
      workspaceId: wsId,
      hasPath: !!wsPath,
      pathLength: wsPath?.length,
    });

    try {
      // Initialize the file tracking and git stores first if we have a workspace ID
      // The stores handle duplicate initialization internally
      if (wsId) {
        try {
          await Promise.all([
            fileTrackingStore.setWorkspace(WorkspaceId(wsId)),
            gitStore.loadStatus(WorkspaceId(wsId)),
          ]);
        } catch (storeError) {
          logger.warn('[FileTreeView] Failed to initialize stores:', storeError);
          // Continue with file tree initialization even if stores fail
        }
      }

      await currentStore.initialize();
      initialized = true;
      lastInitializedWorkspaceId = wsId;
      await setupFileWatcher();
      await setupWorkspaceChangesWatcher();
      await setupFileTrackingWatcher();
      logger.info('[FileTreeView] Initialization complete');
    } catch (error) {
      logger.error('[FileTreeView] Failed to initialize:', error);
    } finally {
      isInitializing = false;
    }
  }

  onMount(() => {
    logger.info('[FileTreeView] onMount called', {
      workspacePath,
      workspaceId,
      hasPath: !!workspacePath,
      pathLength: workspacePath?.length,
    });

    // Only initialize if we have a workspace path
    if (workspacePath) {
      // Initialize asynchronously to prevent UI blocking
      Promise.resolve().then(() => initializeForWorkspace(workspacePath, workspaceId, store));
    } else {
      logger.warn('[FileTreeView] No workspace path provided, skipping initialization');
    }

  });

  // Effect to handle workspace ID changes (workspace switch without component remount)
  $effect(() => {
    // Read workspaceId and workspacePath to create reactive dependencies
    const currentWsId = workspaceId;
    const currentWsPath = workspacePath;
    const currentStore = store;

    // If workspace ID changed and we have a valid path, reinitialize
    if (
      currentWsId &&
      currentWsPath &&
      currentWsId !== lastInitializedWorkspaceId &&
      lastInitializedWorkspaceId !== undefined
    ) {
      logger.info('[FileTreeView] Workspace ID changed, reinitializing', {
        previousWorkspaceId: lastInitializedWorkspaceId,
        newWorkspaceId: currentWsId,
        workspacePath: currentWsPath,
      });

      // Deactivate the previous workspace's store to abort any pending async operations
      // This prevents the old store from querying/updating for the wrong workspace
      deactivateFileExplorerStore(lastInitializedWorkspaceId);

      // Reactivate the new store (in case it was previously deactivated)
      reactivateFileExplorerStore(currentWsId);

      // Reset initialized flag since we're switching workspaces
      initialized = false;

      // Initialize the new workspace
      initializeForWorkspace(currentWsPath, currentWsId, currentStore);
    }
  });

  onDestroy(() => {
    // Clean up IPC listeners
    if (fileWatcher) {
      fileWatcher();
    }
    if (workspaceChangesWatcher) {
      workspaceChangesWatcher();
    }
    if (fileTrackingWatcher) {
      fileTrackingWatcher();
    }

    // Clean up debounce timeouts
    if (fileTrackingRefreshTimeout) {
      clearTimeout(fileTrackingRefreshTimeout);
    }

    // Clean up custom event listener
    if (customFileChangeHandler) {
      window.removeEventListener('file:changed', customFileChangeHandler as EventListener);
    }

    store.cleanup();
  });

  // Export refresh function for parent components
  export function refresh() {
    store.refresh();
  }

  // Export expand/collapse all functions for parent components
  export async function expandAll() {
    await store.expandAll();
  }

  export function collapseAll() {
    store.collapseAll();
  }

  // Export getter to check if any directories are expanded
  export function getHasExpandedDirectories(): boolean {
    return store.hasExpandedDirectories;
  }

  // Export startCreatingFile for parent components to trigger inline creation
  export function startCreatingFile(dirPath?: string) {
    virtualizedTreeRef?.startCreatingFile(dirPath);
  }

  // React to workspace path changes
  $effect(() => {
    if (workspacePath && workspacePath !== store.workspacePath) {
      // setWorkspacePath is now async and handles initialization
      store
        .setWorkspacePath(workspacePath)
        .then(() => {
          initialized = true;
          if (!fileWatcher) {
            setupFileWatcher();
          }
          if (!workspaceChangesWatcher) {
            setupWorkspaceChangesWatcher();
          }
        })
        .catch((error) => {
          logger.error('[file-tree-view] Failed to set workspace path:', error);
        });
    }
  });

  // React to workspace ID changes
  $effect(() => {
    if (workspaceId) {
      store.setWorkspaceId(workspaceId);
    }
  });

  // Track the file we've already expanded to (to avoid re-expanding on every effect run)
  let lastExpandedToFile = $state<string | null>(null);
  // Track previous search query to detect when search is cleared
  // Note: We intentionally capture the initial searchQuery value; it's synced in the effect below
  // svelte-ignore state_referenced_locally
  let previousSearchQuery = $state(searchQuery);

  // On mount, when search is cleared, or when selected file changes, expand folders to reveal it and scroll to it
  $effect(() => {
    const currentQuery = searchQuery?.trim() || '';
    const prevQuery = previousSearchQuery?.trim() || '';
    const searchWasCleared = prevQuery && !currentQuery;
    const selectedFileChanged = selectedFile && lastExpandedToFile !== selectedFile;

    // Update previous query for next run
    previousSearchQuery = searchQuery;

    // Expand and scroll to selected file when:
    // 1. Store is ready (initialized and not loading), AND
    // 2. Not currently searching (no search query), AND
    // 3. We have a selected file, AND
    // 4. One of:
    //    a. Initial load (lastExpandedToFile is null), OR
    //    b. Search was just cleared, OR
    //    c. Selected file changed to a different file
    const shouldExpandAndScroll =
      store.isInitialized &&
      !store.isLoading &&
      !currentQuery &&
      selectedFile &&
      (lastExpandedToFile === null || searchWasCleared || selectedFileChanged);

    if (shouldExpandAndScroll) {
      lastExpandedToFile = selectedFile;

      // Use a small delay to ensure any pending refreshes have completed
      // This prevents the race condition where expandToPath runs before a refresh
      // and the expanded state is lost when the refresh replaces the tree
      setTimeout(() => {
        // Expand to the selected file
        store.expandToPath(selectedFile).then((success) => {
          if (success) {
            // Wait for the DOM to update, then scroll to the element
            requestAnimationFrame(() => {
              // Try both absolute and relative path selectors
              let fileElement = document.querySelector(
                `[data-file-path="${CSS.escape(selectedFile)}"]`,
              );
              // If not found and path is relative, try with workspace prefix
              if (!fileElement && !selectedFile.startsWith('/') && workspacePath) {
                const absolutePath = `${workspacePath}/${selectedFile}`;
                fileElement = document.querySelector(
                  `[data-file-path="${CSS.escape(absolutePath)}"]`,
                );
              }
              if (fileElement) {
                fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            });
          }
        });
      }, 100);
    }
  });
</script>

<div class="flex flex-col h-full">
  <!-- Search bar -->
  <!-- <div class="flex items-center gap-2 mb-2">
    <div class="relative flex-1">
      <Fa
        icon={faSearch}
        class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground"
      />
      <Input
        bind:value={searchQuery}
        placeholder="Search files..."
        class="h-7 pl-7 text-xs bg-none! border-0! [background:none_!important] empty:opacity-50"
      />
    </div>
  </div> -->

  <!-- File tree -->
  <!-- Note: VirtualizedFileTree handles its own scrolling internally.
       Using ScrollArea here would create a conflicting second scroll context
       (bits-ui ScrollArea adds overflow-y:scroll on its Viewport) which breaks
       virtualization by giving the inner scroll container an unconstrained height. -->
  <div class="flex-1 min-h-0 overflow-hidden">
    {#if store.isLoading || externalLoading || !store.isInitialized}
      <!-- Skeleton loaders for file tree -->
      <ScrollArea class="h-full">
        <div class="space-y-1 py-2 px-2">
          {#each Array(6) as _}
            <div class="flex items-center gap-2 py-1">
              <Skeleton class="h-3 w-3 rounded shrink-0" />
              <Skeleton class="h-3 w-24 flex-1" />
            </div>
          {/each}
        </div>
      </ScrollArea>
    {:else if store.error}
      <div class="text-xs text-destructive py-2">
        {store.error}
      </div>
    {:else if searchQuery && searchQuery.trim()}
      <!-- Search results - flat list -->
      {#if isSearching}
        <div class="space-y-1 py-2 px-2">
          {#each Array(4) as _}
            <div class="flex items-center gap-2 py-1">
              <Skeleton class="h-3 w-3 rounded shrink-0" />
              <Skeleton class="h-3 w-32 flex-1" />
            </div>
          {/each}
        </div>
      {:else if searchResults.length === 0}
        <div class="text-xs text-muted-foreground py-4 text-center">No files found</div>
      {:else}
        <ScrollArea class="h-full">
          <ListContainer spacing="compact">
            {#each searchResults as result (result.path)}
              <div data-file-path={result.path}>
                <ListItem
                  active={selectedFile === result.path}
                  title={result.name}
                  subtitle={result.relativePath}
                  onclick={() => {
                    selectedFile = result.path;
                    onFileSelect?.(result.path);
                  }}
                  size="sm"
                >
                  {#snippet iconSnippet()}
                    <span class="w-4 h-4 [&>svg]:w-full [&>svg]:h-full">
                      {@html getFileTypeIconSvg(result.name)}
                    </span>
                  {/snippet}
                </ListItem>
              </div>
            {/each}
          </ListContainer>
        </ScrollArea>
      {/if}
    {:else if store.rootNode}
      <!-- Virtualized file tree for performance with large repos -->
      <VirtualizedFileTree
        bind:this={virtualizedTreeRef}
        flattenedNodes={filteredFlattenedNodes}
        {selectedFile}
        {workspacePath}
        {workspaceId}
        onFileSelect={(path) => {
          selectedFile = path;
          onFileSelect?.(path);
        }}
        onToggleDirectory={(node) => store.toggleDirectory(node)}
        {onCreateFile}
        {onRenameFile}
        {onSelectAgent}
        {getGitStatusColor}
        {isFileModified}
        {onExternalFilesDrop}
      />
    {:else}
      <!-- <div class="text-xs text-muted-foreground py-2 text-center">No files found</div> -->
    {/if}
  </div>
</div>
