<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import {
  onMount,
  tick,
} from 'svelte';
  import { writable } from 'svelte/store';

  import { invoke } from '$lib/electron-bridge';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { getFileTypeIconSvg } from '$lib/utils/file-type-icons';
  import type { EnvironmentConfig } from '$shared/types';
  import {
  ListContainer,
  ListItem,
} from '$lib/components/ui/list';
  import {
  selectCurrentStagedWorkingChanges,
  selectCurrentUnstagedWorkingChanges,
} from '$lib/store/slices/changes/changes-selectors';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import { selectGitStatus } from '$lib/store/slices/git/git-selectors';


  import {
  initializeFileExplorer,
  setWorkspacePathRequested,
  toggleDirectoryRequested,
  expandToPathRequested,
  expandAllRequested,
  refreshFileExplorer,
  clearExpandedPathsExceptRoot,
  syncGitStatusFromStoresRequested,
} from '$lib/store/slices/file-explorer/file-explorer-slice';
  import {
  selectFileExplorerRootNode,
  selectFileExplorerIsLoading,
  selectFileExplorerIsInitialized,
  selectFileExplorerError,
  selectFileExplorerGitStatus,
  selectFlattenedNodes,
  selectHasExpandedDirectories,
  selectFileExplorerWorkspacePath,
} from '$lib/store/slices/file-explorer/file-explorer-selectors';
  import VirtualizedFileTree from './VirtualizedFileTree.svelte';
  import { store as appStore } from '$lib/store/store';

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

  const ftStagedChanges$ = selectCurrentStagedWorkingChanges();
  const ftUnstagedChanges$ = selectCurrentUnstagedWorkingChanges();

  // Writable store for workspace ID, used as reactive arg for selectors
  const wsIdStore = writable(workspaceId || workspacePath || '');

  // Selector subscriptions at component init time
  const rootNode$ = selectFileExplorerRootNode(wsIdStore);
  const feIsLoading$ = selectFileExplorerIsLoading(wsIdStore);
  const feIsInitialized$ = selectFileExplorerIsInitialized(wsIdStore);
  const feError$ = selectFileExplorerError(wsIdStore);
  const gitStatusRecord$ = selectFileExplorerGitStatus(wsIdStore);
  const flattenedNodes$ = selectFlattenedNodes(wsIdStore);
  const feWorkspacePath$ = selectFileExplorerWorkspacePath(wsIdStore);

  // Ref to VirtualizedFileTree for delegating method calls
  let virtualizedTreeRef: VirtualizedFileTree | null = $state(null);

  // Capture dispatch at component init time (store.dispatch reads the configured app store,
  // which is only valid during component initialization).

  // Keep wsIdStore in sync with prop — drives reactive selector subscriptions.
  $effect(() => {
    wsIdStore.set(workspaceId || workspacePath || '');
  });

  // Effective workspace id used for dispatches. Derived so it reacts to prop
  // changes without requiring a separate mutable ref.
  const effectiveWsId = $derived(workspaceId || workspacePath || '');

  // Track the last workspaceId we initialized for, to handle workspace switches
  let lastInitializedWorkspaceId: string | undefined = undefined;

  let modifiedFiles = $state<Set<string>>(new Set());

  // Search state - for querying all files when filtering
  let searchResults = $state<SearchResult[]>([]);
  let isSearching = $state(false);
  let searchAbortController: AbortController | null = null;

  // Search keyboard navigation state
  let searchSelectedIndex = $state(-1);
  let searchResultsContainerRef: HTMLElement | null = $state(null);

  // Reset selected index when search results change — auto-select first item
  $effect(() => {
    searchSelectedIndex = searchResults.length > 0 ? 0 : -1;
  });

  function scrollSearchSelectedIntoView() {
    if (!searchResultsContainerRef || searchSelectedIndex < 0) return;
    const items = searchResultsContainerRef.querySelectorAll('[data-search-result-index]');
    const selectedItem = items[searchSelectedIndex] as HTMLElement | undefined;
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Handle keyboard navigation from the search input.
   * When there are search results, navigates the results list.
   * When search is empty, forwards navigation keys to the file tree.
   */
  export function handleSearchKeyDown(e: KeyboardEvent) {
    const hasQuery = searchQuery && searchQuery.trim();

    // When search is active and has results, navigate the search results
    if (hasQuery && searchResults.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          searchSelectedIndex = Math.min(searchSelectedIndex + 1, searchResults.length - 1);
          tick().then(scrollSearchSelectedIntoView);
          return;
        case 'ArrowUp':
          e.preventDefault();
          searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0);
          tick().then(scrollSearchSelectedIntoView);
          return;
        case 'Enter':
          e.preventDefault();
          if (searchSelectedIndex >= 0 && searchResults[searchSelectedIndex]) {
            const result = searchResults[searchSelectedIndex];
            selectedFile = result.path;
            onFileSelect?.(result.path);
          }
          return;
      }
    }

    // When search is empty, forward vertical navigation to the file tree.
    // Only ArrowUp/ArrowDown/Enter are safe to intercept — other keys like
    // ArrowLeft/Right, Home, End, Space have standard text-input roles
    // (cursor movement, typing) and must not be captured.
    if (!hasQuery && virtualizedTreeRef) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        virtualizedTreeRef.handleKeydown(e);
        return;
      }
      if (e.key === 'Enter') {
        // VirtualizedFileTree's Enter triggers rename; we want open/toggle instead,
        // which matches its Space-key behaviour.
        e.preventDefault();
        const spaceEvent = new KeyboardEvent('keydown', {
          key: ' ',
          bubbles: true,
          cancelable: true,
        });
        virtualizedTreeRef.handleKeydown(spaceEvent);
        return;
      }
    }
  }

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
        const gitStatusRec = $gitStatusRecord$;
        if (filterOnlyChanged && gitStatusRec) {
          files = files.filter((file) => {
            // Check if the file has git status (is changed)
            return file.relativePath in gitStatusRec;
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

  // Get file tooltip

  // Handle file selection

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

  // Filtered flattened nodes - applies showOnlyChanged filter
  const filteredFlattenedNodes = $derived.by(() => {
    const nodes = $flattenedNodes$;
    if (!showOnlyChanged) return nodes;
    // Git-change signals are derived onto each FlattenedFileNode by
    // selectFlattenedNodes, so a single field check covers files and
    // directories at any depth (including lazily loaded ones).
    return nodes.filter((flatNode) =>
      flatNode.node.type === 'file'
        ? flatNode.gitStatus !== undefined
        : flatNode.directoryHasChanges === true,
    );
  });

  // Filter nodes by search query and changed files filter
  // isRoot parameter indicates if we're filtering the root level (for adding missing git files)

  let initialized = false;
  let isInitializing = false; // Guard against concurrent initialization
  let lastSyncTime = 0;

  // Watch for changes in the stores and sync local git status display
  // This ensures we stay in sync with CodeChangesPanel WITHOUT triggering cascading refreshes
  $effect(() => {
    if (initialized && workspaceId) {
      // Watch for changes in file tracking store
      const changeCount = ($ftUnstagedChanges$?.length || 0) + ($ftStagedChanges$?.length || 0);

      // Also watch git store status (read from Redux)
      const gitStatus = workspaceId ? selectGitStatus.select(appStore.state, workspaceId) : null;

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
        appStore.dispatch(syncGitStatusFromStoresRequested(workspaceId));
      }
    }
  });

  // Helper function to initialize the file explorer for a workspace.
  // IPC/window listeners and workspace lifecycle are now owned by the saga, so
  // this function only needs to dispatch the initialize action.
  function initializeForWorkspace(wsPath: string, wsId: string | undefined) {
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

    const targetWsId = wsId || wsPath;
    isInitializing = true;
    logger.info('[FileTreeView] Initializing for workspace', {
      workspacePath: wsPath,
      workspaceId: wsId,
      hasPath: !!wsPath,
      pathLength: wsPath?.length,
    });

    try {
      // Load git status if we have a workspace ID.
      // Don't dispatch initWorkspace here - the workspace page is the
      // authority for that. Calling it with a potentially stale workspace ID can hijack
      // the state and cause other components to get stuck on loading skeleton.
      if (wsId) {
        try {
          appStore.dispatch(loadGitStatus(wsId));
        } catch (storeError) {
          logger.warn('[FileTreeView] Failed to load git status:', storeError);
          // Continue with file tree initialization even if store fails
        }
      }

      appStore.dispatch(
        initializeFileExplorer(targetWsId, {
          workspacePath: wsPath,
          workspaceId: wsId,
          environmentConfig,
        }),
      );
      initialized = true;
      lastInitializedWorkspaceId = wsId;
      logger.info('[FileTreeView] Initialization dispatched');
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
      Promise.resolve().then(() => initializeForWorkspace(workspacePath, workspaceId));
    } else {
      logger.warn('[FileTreeView] No workspace path provided, skipping initialization');
    }

  });

  // Effect to handle workspace ID changes (workspace switch without component remount)
  $effect(() => {
    // Read workspaceId and workspacePath to create reactive dependencies
    const currentWsId = workspaceId;
    const currentWsPath = workspacePath;

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

      // Reset initialized flag since we're switching workspaces. The saga
      // handles deactivate/reactivate via workspaceMounted/Unmounted.
      initialized = false;

      // Initialize the new workspace
      initializeForWorkspace(currentWsPath, currentWsId);
    }
  });

  // Export refresh function for parent components
  export function refresh() {
    appStore.dispatch(refreshFileExplorer(effectiveWsId));
  }

  // Export expand/collapse all functions for parent components
  export function expandAll() {
    appStore.dispatch(expandAllRequested(effectiveWsId));
  }

  export function collapseAll() {
    appStore.dispatch(clearExpandedPathsExceptRoot(effectiveWsId));
  }

  // Export getter to check if any directories are expanded
  export function getHasExpandedDirectories(): boolean {
    return selectHasExpandedDirectories.select(appStore.state, workspaceId || workspacePath || '');
  }

  // Export startCreatingFile for parent components to trigger inline creation
  export function startCreatingFile(dirPath?: string) {
    virtualizedTreeRef?.startCreatingFile(dirPath);
  }

  // React to workspace path changes
  $effect(() => {
    if (workspacePath && workspacePath !== $feWorkspacePath$) {
      // Saga owns the path-change handling (clear cache, reinitialize, set up
      // listeners); we just dispatch and mark the component as initialized.
      appStore.dispatch(setWorkspacePathRequested(effectiveWsId, workspacePath));
      initialized = true;
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
      $feIsInitialized$ &&
      !$feIsLoading$ &&
      !currentQuery &&
      selectedFile &&
      (lastExpandedToFile === null || searchWasCleared || selectedFileChanged);

    if (shouldExpandAndScroll) {
      lastExpandedToFile = selectedFile;

      // Use a small delay to ensure any pending refreshes have completed
      // This prevents the race condition where expandToPath runs before a refresh
      // and the expanded state is lost when the refresh replaces the tree
      const targetWsId = effectiveWsId;
      const targetFile = selectedFile;
      setTimeout(() => {
        // Expand to the selected file via the saga (fire-and-forget).
        appStore.dispatch(expandToPathRequested(targetWsId, targetFile));
        // Wait for the expansion + DOM update, then scroll to the element.
        // We cannot synchronously know whether expansion succeeded, so we
        // best-effort scroll on the next animation frame after a short delay.
        setTimeout(() => {
          requestAnimationFrame(() => {
            // Try both absolute and relative path selectors
            let fileElement = document.querySelector(
              `[data-file-path="${CSS.escape(targetFile)}"]`,
            );
            // If not found and path is relative, try with workspace prefix
            if (!fileElement && !targetFile.startsWith('/') && workspacePath) {
              const absolutePath = `${workspacePath}/${targetFile}`;
              fileElement = document.querySelector(
                `[data-file-path="${CSS.escape(absolutePath)}"]`,
              );
            }
            if (fileElement) {
              fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
        }, 50);
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
        class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle"
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
    {#if $feIsLoading$ || externalLoading || !$feIsInitialized$}
      <!-- Skeleton loaders for file tree -->
      <ScrollArea class="h-full">
        <div class="space-y-1 py-2 px-2">
          {#each Array(6) as { }}
            <div class="flex items-center gap-2 py-1">
              <Skeleton class="h-3 w-3 rounded shrink-0" />
              <Skeleton class="h-3 w-24 flex-1" />
            </div>
          {/each}
        </div>
      </ScrollArea>
    {:else if $feError$}
      <div class="text-xs text-destructive-foreground py-2">
        {$feError$}
      </div>
    {:else if searchQuery && searchQuery.trim()}
      <!-- Search results - flat list -->
      {#if isSearching}
        <div class="space-y-1 py-2 px-2">
          {#each Array(4) as { }}
            <div class="flex items-center gap-2 py-1">
              <Skeleton class="h-3 w-3 rounded shrink-0" />
              <Skeleton class="h-3 w-32 flex-1" />
            </div>
          {/each}
        </div>
      {:else if searchResults.length === 0}
        <div class="text-xs text-subtle py-4 text-center">No files found</div>
      {:else}
        <ScrollArea class="h-full">
          <div bind:this={searchResultsContainerRef}>
            <ListContainer spacing="compact">
              {#each searchResults as result, i (result.path)}
                <div data-file-path={result.path} data-search-result-index={i}>
                  <ListItem
                    active={selectedFile === result.path}
                    selected={searchSelectedIndex === i}
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
          </div>
        </ScrollArea>
      {/if}
    {:else if $rootNode$}
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
        onToggleDirectory={(node) => appStore.dispatch(toggleDirectoryRequested(effectiveWsId, node.path))}
        {onCreateFile}
        {onRenameFile}
        {onSelectAgent}
        {getGitStatusColor}
        {isFileModified}
        {onExternalFilesDrop}
      />
    {:else}
      <!-- <div class="text-xs text-subtle py-2 text-center">No files found</div> -->
    {/if}
  </div>
</div>
