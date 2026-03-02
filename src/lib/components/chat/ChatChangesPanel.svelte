<script lang="ts">
  /**
   * Chat Changes Panel
   *
   * Displays file changes extracted from chat messages in the main panel.
   * Shows inline collapsible diffs for each file.
   *
   * Also used for local changes view when showStagingControls is enabled.
   */

  import { createLogger } from '$lib/utils/client-logger';
  import Fa from 'svelte-fa';

  const logger = createLogger('ChatChangesPanel');
  import {
    faChevronDown,
    faChevronRight,
    faCodeCompare,
    faPencil,
    faArrowUpRightFromSquare,
    faPlus,
    faMinus,
    faRotateLeft,
    faSpinner,
    faFilter,
    faCompressAlt,
    faExpandAlt,
    faCopy,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import InlineDiffItem from './InlineDiffItem.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Dropdown } from '$lib/components/ui/dropdown';
  import ViewSettingsDropdown from '$lib/components/ui/ViewSettingsDropdown.svelte';
  import { slide } from 'svelte/transition';
  import { tick, untrack, onMount, onDestroy } from 'svelte';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { editorSettings } from '$lib/stores/editor-settings.store.svelte';
  import {
    ChangeSetVisualization,
    type VisualizationLine,
  } from '$lib/components/file-tracking/change-set-visualization';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { getTransientUIStore } from '$features/workspace/transient-ui-state.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { gitStore } from '$features/git/git.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { toast } from '$lib/components/ui/toast';
  import { NoteId, type WorkspaceId } from '$shared/types/branded-ids';
  import { notesStore } from '$features/notes/notes.store.svelte';
  import CombinedInlineDiffItem from './CombinedInlineDiffItem.svelte';
  import { LOCKED_TOOLTIP } from '$lib/utils/agent-lock-utils';

  // Re-export types from types.ts for backward compatibility
  export type { ChangeCategory, LocalFileChange, DiffHunk } from './types';
  import type { ChangeCategory, LocalFileChange, DiffHunk } from './types';
  import { getDirectoryPath, getFileName, stripWorkspacePrefix, pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import { formatRelativeTime } from '$lib/utils/timeFormatting';
  import { sessionStore } from '$features/agent/browser';

  /**
   * Get the category for a change, with consistent fallback logic.
   * Prioritizes explicit category, then derives from staged boolean.
   */
  function getChangeCategory(change: LocalFileChange): ChangeCategory {
    if (change.category) return change.category;
    if (change.staged === true) return 'staged';
    return 'unstaged';
  }

  /**
   * Get the expand/collapse key for a change entry.
   * In combined mode (groupByCommit=false): uses filePath (one entry per file)
   * In by-commit mode (groupByCommit=true): uses filePath + commitHash (unique per file per commit)
   */
  function getExpandKey(change: LocalFileChange): string {
    if (groupByCommit && change.commitHash) {
      return `${change.filePath}-${change.commitHash}`;
    }
    return change.filePath;
  }

  interface Props {
    /** Initial changes passed when panel was opened */
    changes: LocalFileChange[];
    /** Agent ID for linking back */
    agentId?: string | null;
    /** Whether this is showing aggregate changes */
    isAggregate?: boolean;
    /** Open agent handler */
    onOpenAgent?: (agentId: string, event?: MouseEvent) => void;
    /** Whether to show staging controls (for local changes view) */
    showStagingControls?: boolean;
    /** Whether to show category filter toggles (unstaged/staged/committed) */
    showCategoryFilter?: boolean;
    /** Set of file paths that are locked (agent auto-commit pending) */
    lockedFilePaths?: Set<string>;
    /** Stage a file */
    onStage?: (path: string) => void;
    /** Unstage a file */
    onUnstage?: (path: string) => void;
    /** Revert a file */
    onRevert?: (path: string) => void;
    /** Stage all files */
    onStageAll?: () => void;
    /** Unstage all files */
    onUnstageAll?: () => void;
    /** Whether parent data is still loading (shows blank instead of "No changes") */
    isLoading?: boolean;
    /** Commit details for commit changeset view */
    commitInfo?: {
      hash?: string;
      message?: string;
      author?: string;
      authorEmail?: string;
      date?: string;
      agentId?: string;
      linkedNoteId?: string;
    } | null;
    /** Handler for opening a note */
    onOpenNote?: (noteId: string, event?: MouseEvent) => void;
    /** Initial group-by-commit mode (default: false = combined view) */
    groupByCommit?: boolean;
  }

  let {
    changes,
    agentId = null,
    isAggregate = false,
    onOpenAgent,
    showStagingControls = false,
    showCategoryFilter = false,
    lockedFilePaths = new Set<string>(),
    onStage,
    onUnstage,
    onRevert,
    onStageAll: _onStageAll,
    onUnstageAll: _onUnstageAll,
    isLoading = false,
    commitInfo = null,
    onOpenNote,
    groupByCommit: initialGroupByCommit = false,
  }: Props = $props();

  // Group-by-commit toggle state (default: combined view)
  let groupByCommit = $state(initialGroupByCommit);

  // Helper to check if a file is locked
  function isFileLocked(filePath: string): boolean {
    return lockedFilePaths.has(filePath);
  }

  // Instance ID for debugging
  const instanceId = Math.random().toString(36).substring(2, 8);

  // Get transient UI store lazily without creating $state during effect flush.
  // getTransientUIStore creates a new store with $state if one doesn't exist,
  // so we defer creation to a microtask after the effect flush completes.
  let cachedTransientStore = $state<ReturnType<typeof getTransientUIStore> | null>(null);
  let cachedTransientWorkspaceId: string | null = null;
  $effect(() => {
    const currentWorkspaceId = workspaceStore.current?.id ?? null;
    if (!currentWorkspaceId) {
      cachedTransientWorkspaceId = null;
      cachedTransientStore = null;
      return;
    }
    if (currentWorkspaceId === cachedTransientWorkspaceId && cachedTransientStore) return;

    cachedTransientWorkspaceId = currentWorkspaceId;
    queueMicrotask(() => {
      if (cachedTransientWorkspaceId !== currentWorkspaceId) return;
      cachedTransientStore = getTransientUIStore(currentWorkspaceId);
    });
  });

  /**
   * Get a commit fingerprint for a file path.
   * Returns a string derived from the sorted commit hashes that touch this file.
   * Used for invalidation: if the fingerprint changes, the file has new commits.
   *
   * Uses reactiveChanges (pre-merge) instead of mergedChanges because in combined
   * mode, merging can collapse multiple committed entries into one, losing individual
   * commit hashes needed for accurate invalidation.
   */
  function getCommitFingerprint(filePath: string): string {
    const hashes = reactiveChanges
      .filter((c) => c.filePath === filePath && c.commitHash)
      .map((c) => c.commitHash!)
      .sort();
    return hashes.join(',');
  }

  // Track whether we've already restored viewed files from the transient store
  let hasRestoredViewedFiles = false;

  // Restore viewed files from transient store when mergedChanges first loads
  $effect(() => {
    // Depend on mergedChanges and cachedTransientStore
    const currentMergedChanges = mergedChanges;
    const store = cachedTransientStore;

    if (!store || currentMergedChanges.length === 0) return;
    if (hasRestoredViewedFiles) return;

    const stored = store.viewedFiles || {};
    if (Object.keys(stored).length === 0) {
      hasRestoredViewedFiles = true;
      return;
    }

    const restoredViewed = new Set<string>();
    for (const [filePath, storedFingerprint] of Object.entries(stored)) {
      const currentFingerprint = getCommitFingerprint(filePath);
      if (currentFingerprint === storedFingerprint) {
        restoredViewed.add(filePath);
      }
      // else: fingerprint changed → new commits → don't restore
    }

    hasRestoredViewedFiles = true;

    if (restoredViewed.size > 0) {
      viewedFiles = restoredViewed;
      // Also collapse viewed files — remove all expand keys that match viewed file paths
      const newExpanded = new Set(expandedFiles);
      for (const change of mergedChanges) {
        if (restoredViewed.has(change.filePath)) {
          newExpanded.delete(getExpandKey(change));
        }
      }
      expandedFiles = newExpanded;
    }
  });

  // Track if we've ever shown content - once shown, don't go back to loading state
  // This prevents flashing when stores refresh during streaming
  let hasEverLoaded = $state(false);

  // Track internal loading state for when we're enriching changes
  // (declared here before first use in the $effect below)
  let isEnrichingChanges = $state(false);

  // Track which files are currently being refreshed (for loading indicator)
  let refreshingFiles = $state<Set<string>>(new Set());
  $effect(() => {
    // Early return if already loaded - no need to check anything
    if (hasEverLoaded) return;

    // Track isEnrichingChanges to re-run when enriching completes
    const currentlyEnriching = isEnrichingChanges;
    // Use untrack for mergedChanges to avoid creating a dependency that causes re-runs
    const hasMergedChanges = untrack(() => mergedChanges.length > 0);
    if (!isLoading && !currentlyEnriching && hasMergedChanges) {
      hasEverLoaded = true;
    }
  });

  // Listen for agent file changes and refresh the affected diff in-place
  // Track files recently saved by the diff editor (to skip refreshing/re-rendering them)
  // This prevents scroll jump when editing in the diff viewer
  // This is module-level so it persists across effect re-runs and is shared across all instances
  const diffEditorSavedFiles = new Map<string, number>();
  const DIFF_EDITOR_SAVE_COOLDOWN = 1000; // 1 second cooldown

  // Helper to check if a path was recently saved by the diff editor
  // Handles both absolute and relative path comparisons
  const wasRecentlySavedByDiffEditor = (pathToCheck: string): boolean => {
    const now = Date.now();
    for (const [savedPath, savedTime] of diffEditorSavedFiles) {
      if (now - savedTime >= DIFF_EDITOR_SAVE_COOLDOWN) continue;
      if (filePathsMatch(savedPath, pathToCheck)) {
        return true;
      }
    }
    return false;
  };

  // Listen for diff editor saves - this must run for ALL views (not just staging controls)
  // to prevent scroll jump when editing in any diff viewer
  // Using onMount/onDestroy instead of $effect for more reliable event listener setup
  let diffEditorSaveHandler: ((event: Event) => void) | null = null;

  onMount(() => {
    logger.debug('ChatChangesPanel: Setting up diff-editor:file-saved listener (onMount)', {
      instanceId,
      showStagingControls,
      workspaceId: workspaceStore.current?.id,
    });

    // Handler for diff editor saves - track these to skip refreshing
    // We listen for ALL events and filter by workspace ID inside the handler
    // This ensures we don't miss events due to effect timing issues
    diffEditorSaveHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        filePath: string;
        relativePath: string;
        workspaceId: string;
      }>;
      const { filePath, relativePath, workspaceId } = customEvent.detail;
      const wsId = workspaceStore.current?.id;
      logger.debug('ChatChangesPanel: Received diff-editor:file-saved event', {
        filePath,
        relativePath,
        eventWorkspaceId: workspaceId,
        ourWorkspaceId: wsId,
        match: workspaceId === wsId,
      });
      // If no workspace ID, still track the file (it might match later)
      // Or if workspace IDs match
      if (wsId && workspaceId !== wsId) return;

      // Track both absolute and relative paths
      const now = Date.now();
      diffEditorSavedFiles.set(filePath, now);
      diffEditorSavedFiles.set(relativePath, now);
      logger.debug('ChatChangesPanel: Diff editor saved file, will skip refresh', {
        filePath,
        relativePath,
      });
    };

    window.addEventListener('diff-editor:file-saved', diffEditorSaveHandler);
  });

  onDestroy(() => {
    if (diffEditorSaveHandler) {
      window.removeEventListener('diff-editor:file-saved', diffEditorSaveHandler);
    }
    if (summaryBarHoverTimeout) {
      clearTimeout(summaryBarHoverTimeout);
    }
  });

  // This ensures the diff updates when a file is edited externally (e.g., in another panel)
  // We handle this at the ChatChangesPanel level because MonacoDiffViewer instances may be
  // destroyed/recreated during re-renders, losing their individual debounce timers.
  $effect(() => {
    // Only listen when we have staging controls enabled (local changes view)
    // For agent changes, the content comes from tool calls, not git
    if (!showStagingControls) return;

    const wsId = workspaceStore.current?.id;
    if (!wsId) return;

    // Debounce timer per file path
    const fileDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // Handler for agent file changes (emitted when file:write is called)
    const handleAgentFileChange = (data: {
      workspaceId?: string;
      filePath?: string;
      path?: string;
    }) => {
      if (data.workspaceId !== wsId) return;
      const changedPath = data.filePath || data.path;
      if (!changedPath) return;

      // Check if this file was recently saved by the diff editor - skip refresh if so
      if (wasRecentlySavedByDiffEditor(changedPath)) {
        logger.debug('ChatChangesPanel: Skipping refresh - file was saved by diff editor', {
          changedPath,
        });
        return;
      }

      // Check if this file is in our changes list and get the matching change
      const matchingChange = untrack(() =>
        enrichedChanges.find((c) => filePathsMatch(changedPath, c.filePath)),
      );
      if (!matchingChange) return;

      // Also check if the matching change's path was recently saved by diff editor
      if (wasRecentlySavedByDiffEditor(matchingChange.filePath)) {
        logger.debug(
          'ChatChangesPanel: Skipping refresh - matching file was saved by diff editor',
          {
            changedPath,
            matchingFilePath: matchingChange.filePath,
          },
        );
        return;
      }

      logger.debug('ChatChangesPanel: Agent file change detected', {
        changedPath,
        matchingFilePath: matchingChange.filePath,
      });

      // IMMEDIATELY mark this file as recently refreshed to prevent the main effect
      // from overwriting our data when the parent updates the changes prop
      recentlyRefreshedFiles.set(matchingChange.filePath, Date.now());

      // Clear any existing debounce for this file
      const existingTimer = fileDebounceTimers.get(changedPath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Schedule a refresh for this file with debounce
      const timer = setTimeout(() => {
        fileDebounceTimers.delete(changedPath);
        logger.info('ChatChangesPanel: Refreshing diff for changed file', { changedPath });
        // Refresh the cooldown timestamp again
        recentlyRefreshedFiles.set(matchingChange.filePath, Date.now());
        void refreshFileDiff(matchingChange.filePath);
      }, 300);
      fileDebounceTimers.set(changedPath, timer);
    };

    // Subscribe to agent file changes
    const cleanup = listenSync('file-tracking:agent-file-changed', ({ payload }) => {
      handleAgentFileChange(payload as { workspaceId?: string; filePath?: string; path?: string });
    });

    // Cleanup on effect disposal
    return () => {
      cleanup?.();
      // Clear all pending timers
      for (const timer of fileDebounceTimers.values()) {
        clearTimeout(timer);
      }
      fileDebounceTimers.clear();
    };
  });

  // Only show loading state on initial load or during enrichment, not during refreshes
  // Show skeleton when: external loading, or enriching changes (before we have content)
  const showLoadingState = $derived((isLoading || isEnrichingChanges) && !hasEverLoaded);

  // Category filter state
  let enabledCategories = $state<Set<ChangeCategory>>(new Set(['unstaged', 'staged', 'committed']));

  // Count changes by category - memoized to avoid recalculating when changes array reference changes
  // These use mergedChanges (memoized) to avoid triggering on every prop update
  let memoizedCounts = $state({ unstaged: 0, staged: 0, committed: 0 });
  $effect(() => {
    // Count from the memoized mergedChanges - need to count parts, not merged entries
    let unstaged = 0;
    let staged = 0;
    let committed = 0;

    for (const change of mergedChanges) {
      if (change.isMerged && change.allParts) {
        // Merged entry - count individual parts
        for (const part of change.allParts) {
          if (part.category === 'unstaged') unstaged++;
          else if (part.category === 'staged') staged++;
          else if (part.category === 'committed') committed++;
        }
      } else {
        // Single entry
        const cat = change.category || (change.staged ? 'staged' : 'unstaged');
        if (cat === 'unstaged') unstaged++;
        else if (cat === 'staged') staged++;
        else if (cat === 'committed') committed++;
      }
    }

    // Only update if counts actually changed
    if (
      unstaged !== memoizedCounts.unstaged ||
      staged !== memoizedCounts.staged ||
      committed !== memoizedCounts.committed
    ) {
      memoizedCounts = { unstaged, staged, committed };
    }
  });

  const unstagedCount = $derived(memoizedCounts.unstaged);
  const stagedCount = $derived(memoizedCounts.staged);
  const committedCount = $derived(memoizedCounts.committed);

  // Get display path - convert absolute paths to relative by extracting just the relevant portion
  function getDisplayPath(filePath: string): string {
    // If it's a workspace-relative absolute path, extract the relative part
    // e.g., /Users/foo/intent/uuid/repo/src/file.ts -> src/file.ts
    const workspace = workspaceStore.current;
    const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

    if (workspacePath) {
      const relative = stripWorkspacePrefix(filePath, workspacePath);
      if (relative !== filePath) return relative || filePath;
    }

    // For other absolute paths, try to find a sensible relative portion
    if (filePath.startsWith('/')) {
      // Look for common patterns like /src/, /lib/, etc.
      const patterns = ['/src/', '/lib/', '/app/', '/components/', '/features/', '/routes/'];
      for (const pattern of patterns) {
        const idx = filePath.indexOf(pattern);
        if (idx !== -1) {
          return filePath.slice(idx + 1); // Include the folder name (e.g., src/...)
        }
      }
      // Fallback: just use the filename
      return filePath.split('/').pop() || filePath;
    }

    return filePath;
  }

  // Fetch actual diff content for visualization
  // This content is shared between the visualization and the DiffViewer components
  let enrichedChanges = $state<LocalFileChange[]>([]);

  // Track the current fetch version to avoid race conditions
  // Using a regular variable (not $state) to avoid triggering effect re-runs
  let fetchVersion = 0;

  // Track recently refreshed files to prevent re-fetching during staging transitions
  // This prevents the flicker when staging/unstaging hunks causes the parent to refresh
  let recentlyRefreshedFiles = new Map<string, number>();
  const REFRESH_COOLDOWN_MS = 2000; // Don't re-fetch files refreshed within this window

  // Track the last processed changes to avoid re-fetching when changes haven't actually changed
  // This prevents refreshes when the agent is running but hasn't made code changes
  let lastChangesKey = '';

  /**
   * Maximum number of files to fetch content for upfront.
   * Files beyond this limit will have their content fetched on-demand by TrackedChangeDiffViewer
   * when they become visible. This prevents OOM when there are many file changes.
   */
  const MAX_UPFRONT_FETCH_COUNT = 20;

  /**
   * Generate a stable key for a set of changes to detect actual changes vs. array regeneration.
   *
   * IMPORTANT: We intentionally EXCLUDE line counts (additions/deletions) from the key.
   * Line counts change when file content changes, but:
   * - For agent changes: content is provided directly via tool calls, no re-fetch needed
   * - For staging controls: we fetch diff content via git:diff, which handles content changes
   *
   * By excluding line counts, we avoid re-fetching all content when a single file is edited.
   * The key should only change when:
   * - Files are added/removed from the list
   * - File staging status changes (staged → unstaged or vice versa)
   * - File category changes (uncommitted → committed)
   */
  function generateChangesKey(changes: LocalFileChange[]): string {
    return changes
      .map((c) => {
        // Use filePath + staging info as the stable key
        // category is 'staged' | 'unstaged' | 'committed', or fall back to staged boolean
        return `${c.filePath}|${c.category || c.staged}`;
      })
      .sort()
      .join(';;');
  }

  // Fetch diff content for all changes (both local and agent changes)
  $effect(() => {
    // Capture dependencies at the start
    const currentChanges = changes;
    const currentShowStagingControls = showStagingControls;
    const workspaceId = workspaceStore.current?.id;

    if (!workspaceId || currentChanges.length === 0) {
      // Only update if enrichedChanges is not already empty (avoid unnecessary reactivity)
      const currentEnrichedLength = untrack(() => enrichedChanges.length);
      if (currentEnrichedLength > 0) {
        enrichedChanges = [];
      }
      lastChangesKey = '';
      isEnrichingChanges = false;
      return;
    }

    // Check if changes have actually changed by comparing keys
    // Line counts are excluded from the key to avoid re-fetching when content is edited
    const newChangesKey = generateChangesKey(currentChanges);
    // Use untrack to read current length without creating a dependency (prevents infinite loop)
    const currentEnrichedLength = untrack(() => enrichedChanges.length);
    if (newChangesKey === lastChangesKey && currentEnrichedLength > 0) {
      // Changes haven't actually changed, skip re-fetching
      isEnrichingChanges = false;
      return;
    }
    // Debug: Log when keys differ to diagnose re-render issue
    if (lastChangesKey && newChangesKey !== lastChangesKey) {
      // Find the difference between old and new keys
      const oldParts = lastChangesKey.split(';;');
      const newParts = newChangesKey.split(';;');
      const added = newParts.filter((p) => !oldParts.includes(p));
      const removed = oldParts.filter((p) => !newParts.includes(p));
      logger.info(`[ChatChangesPanel:${instanceId}] Key changed, re-fetching`, {
        showStagingControls: currentShowStagingControls,
        oldKeyLength: lastChangesKey.length,
        newKeyLength: newChangesKey.length,
        oldPartsCount: oldParts.length,
        newPartsCount: newParts.length,
        added: added.slice(0, 5),
        removed: removed.slice(0, 5),
        hasEverLoaded: untrack(() => hasEverLoaded),
      });
    }
    lastChangesKey = newChangesKey;

    // Increment version to cancel any in-flight fetches
    const thisVersion = ++fetchVersion;

    // Clean up expired entries from recentlyRefreshedFiles
    const now = Date.now();
    for (const [filePath, timestamp] of recentlyRefreshedFiles) {
      if (now - timestamp > REFRESH_COOLDOWN_MS) {
        recentlyRefreshedFiles.delete(filePath);
      }
    }

    // Identify files that were recently refreshed via refreshFileDiff
    // We'll skip these from the parent's changes and preserve their current enrichedChanges entries
    // This prevents stale parent data from overwriting fresh data from refreshFileDiff
    const recentlyRefreshedFilePaths = new Set<string>();
    for (const [filePath, timestamp] of recentlyRefreshedFiles) {
      if (now - timestamp < REFRESH_COOLDOWN_MS) {
        recentlyRefreshedFilePaths.add(filePath);
      }
    }

    // Capture entries for recently refreshed files from enrichedChanges
    // Use untrack to avoid creating a dependency - we only want to run when `changes` prop updates
    // When refreshFileDiff updates enrichedChanges, the UI updates directly without re-running this effect
    const localEntriesForRefreshedFiles = untrack(() =>
      enrichedChanges.filter((e) => recentlyRefreshedFilePaths.has(e.filePath)),
    );

    // Only set loading state on INITIAL load (before we've ever shown content)
    // Once hasEverLoaded is true, we never show the skeleton again - we update in place
    // This prevents the jarring re-render when files are edited
    const hasAlreadyLoaded = untrack(() => hasEverLoaded);
    if (!hasAlreadyLoaded) {
      logger.debug(
        `[ChatChangesPanel:${instanceId}] Setting isEnrichingChanges=true (initial load)`,
        {
          showStagingControls: currentShowStagingControls,
        },
      );
      isEnrichingChanges = true;
    } else {
      logger.debug(
        `[ChatChangesPanel:${instanceId}] Refreshing content in-place (hasEverLoaded=true)`,
        {
          showStagingControls: currentShowStagingControls,
        },
      );
    }

    // Fetch content for each file (limited to MAX_UPFRONT_FETCH_COUNT to prevent OOM)
    // Files beyond this limit will have their content fetched by TrackedChangeDiffViewer when rendered
    const fetchContent = async () => {
      const enriched: LocalFileChange[] = [];
      let fetchedCount = 0;

      for (const change of currentChanges) {
        // Check if we've been superseded by a newer fetch
        if (thisVersion !== fetchVersion) return;

        // Limit upfront fetching to prevent OOM with many files
        // Files beyond this limit will be fetched on-demand when they become visible
        const shouldFetchContent = fetchedCount < MAX_UPFRONT_FETCH_COUNT;

        try {
          if (currentShowStagingControls) {
            // Skip files that were recently refreshed via refreshFileDiff
            // We'll add our local entries for these files at the end
            if (recentlyRefreshedFilePaths.has(change.filePath)) {
              continue;
            }

            // Skip committed changes - git:diff only works for working directory changes.
            // Committed changes will have their content loaded by TrackedChangeDiffViewer
            // using git:show-file with the commit hash.
            const category = 'category' in change ? change.category : undefined;
            const commitHash = 'commitHash' in change ? change.commitHash : undefined;
            logger.debug('[fetchContent] Processing change', {
              filePath: change.filePath,
              category,
              hasCommitHash: !!commitHash,
              commitHash: commitHash ? String(commitHash).substring(0, 8) : undefined,
              staged: change.staged,
              shouldFetchContent,
              fetchedCount,
            });

            // If we've hit the limit, add the change without content (will be fetched on-demand)
            if (!shouldFetchContent) {
              enriched.push(change);
              continue;
            }

            if (category === 'committed' && commitHash) {
              // Fetch content for committed changes using git:show-file
              // This is needed for the visualization hover cards
              logger.debug('[fetchContent] Fetching committed change content', {
                filePath: change.filePath,
                commitHash: String(commitHash).substring(0, 8),
              });

              try {
                // Fetch new content at the commit and old content from parent
                const [newContentResult, oldContentResult] = await Promise.all([
                  window.electronAPI?.invoke('git:show-file', {
                    workspaceId,
                    filePath: change.filePath,
                    ref: commitHash,
                  }) as Promise<{ success: boolean; data?: string; error?: string }>,
                  window.electronAPI?.invoke('git:show-file', {
                    workspaceId,
                    filePath: change.filePath,
                    ref: `${commitHash}^`,
                  }) as Promise<{ success: boolean; data?: string; error?: string }>,
                ]);

                // Check again after async operation
                if (thisVersion !== fetchVersion) return;

                const newContent = newContentResult?.success ? newContentResult.data || '' : '';
                const oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';

                logger.debug('[fetchContent] Committed content fetched', {
                  filePath: change.filePath,
                  oldContentLength: oldContent.length,
                  newContentLength: newContent.length,
                });

                enriched.push({
                  ...change,
                  oldContent,
                  newContent,
                  // Mark as full file content so MonacoDiffViewer knows it can use git:show-file to refresh
                  isFullFileContent: true,
                });
                fetchedCount++;
              } catch (error) {
                logger.warn('[fetchContent] Failed to fetch committed content', {
                  filePath: change.filePath,
                  error,
                });
                enriched.push(change);
              }
              continue;
            }

            // For local changes, fetch diff from git (always needed for chunks)
            // Skip if we already have chunks from a previous fetch
            if (change.chunks && change.chunks.length > 0) {
              enriched.push(change);
              fetchedCount++;
              continue;
            }

            logger.debug('[fetchContent] Fetching git:diff', {
              filePath: change.filePath,
              staged: change.staged === true,
            });

            const diffResult = (await window.electronAPI?.invoke('git:diff', {
              workspaceId,
              paths: [change.filePath],
              staged: change.staged === true,
            })) as
              | {
                  success: boolean;
                  data?: Array<{
                    file: string;
                    oldContent?: string;
                    newContent?: string;
                    chunks?: DiffHunk[];
                  }>;
                }
              | undefined;

            // Check again after async operation
            if (thisVersion !== fetchVersion) return;

            if (diffResult?.success && diffResult.data && diffResult.data.length > 0) {
              const diffData = diffResult.data[0];
              logger.debug('[fetchContent] git:diff returned content', {
                filePath: change.filePath,
                oldContentLength: diffData.oldContent?.length || 0,
                newContentLength: diffData.newContent?.length || 0,
              });
              enriched.push({
                ...change,
                oldContent: diffData.oldContent || '',
                newContent: diffData.newContent || '',
                chunks: diffData.chunks,
                // Mark as full file content so MonacoDiffViewer knows it can use git:diff to refresh
                isFullFileContent: true,
              });
              fetchedCount++;
            } else {
              logger.debug('[fetchContent] git:diff returned NO content', {
                filePath: change.filePath,
                success: diffResult?.success,
                dataLength: diffResult?.data?.length,
              });
              enriched.push(change);
            }
          } else {
            // For agent changes:
            // - Per-turn views (isAggregate=false): use snippet content directly
            //   The snippet oldContent/newContent accurately represents what this turn changed
            // - Aggregate views: handled separately by the gitDiffChanges effect
            //   which fetches git:diff to get the cumulative changes
            //
            // We do NOT fetch fullFileContent for per-turn views because:
            // 1. The current file reflects ALL changes from ALL turns
            // 2. We only want to show what THIS turn changed
            enriched.push(change);
          }
        } catch (error) {
          logger.warn('Failed to fetch content', { filePath: change.filePath, error });
          enriched.push(change);
        }
      }

      // Add back the locally refreshed entries that we captured at the start of the effect
      // This ensures we use our local data for recently refreshed files instead of stale parent data
      enriched.push(...localEntriesForRefreshedFiles);

      // Only update if this is still the current fetch
      if (thisVersion === fetchVersion) {
        enrichedChanges = enriched;
        isEnrichingChanges = false;
      }
    };

    fetchContent();
  });

  // Filter by enabled categories first
  // Note: Content for files beyond MAX_UPFRONT_FETCH_COUNT is NOT fetched here.
  // TrackedChangeDiffViewer handles fetching content on-demand when rendered.
  // The visualization uses synthetic lines (based on additions/deletions counts) for unfetched files.
  let categoryFilteredChanges = $derived(
    showCategoryFilter
      ? enrichedChanges.filter((c) => enabledCategories.has(getChangeCategory(c)))
      : enrichedChanges,
  );

  // Helper function to extract filename and directory from path for filetree sorting
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
    return {
      filename: cleanPath.substring(lastSlashIndex + 1),
      directory: cleanPath.substring(0, lastSlashIndex),
    };
  }

  // Sort changes like file explorer: folders first (alphabetically), then files (alphabetically)
  function sortChangesExplorerStyle(changes: LocalFileChange[]): LocalFileChange[] {
    return [...changes].sort((a, b) => {
      const pathA = parseFilePath(a.filePath);
      const pathB = parseFilePath(b.filePath);

      // First sort by directory
      if (pathA.directory !== pathB.directory) {
        return pathA.directory.localeCompare(pathB.directory);
      }

      // Then sort by filename within the same directory
      return pathA.filename.localeCompare(pathB.filename);
    });
  }

  // Whether any committed changes exist (for showing the group-by-commit toggle)
  let hasCommittedChanges = $derived(
    changes.some((c) => getChangeCategory(c) === 'committed'),
  );

  // Count unique commits for the header bar
  let commitCount = $derived.by(() => {
    const hashes = new Set<string>();
    for (const c of changes) {
      if (c.commitHash) hashes.add(c.commitHash);
    }
    return hashes.size;
  });

  // Use enriched changes for display - no category sorting needed since we merge staged/unstaged
  let reactiveChanges = $derived(categoryFilteredChanges);

  // Merge changes by file path - combine staged, unstaged, and committed into a single entry
  function mergeChangesByFilePath(changes: LocalFileChange[]): LocalFileChange[] {
    const byPath = new Map<
      string,
      { unstaged?: LocalFileChange; staged?: LocalFileChange; committed?: LocalFileChange[] }
    >();

    for (const change of changes) {
      const category = getChangeCategory(change);
      const existing = byPath.get(change.filePath) || {};

      if (category === 'committed') {
        // Keep committed changes separate (can have multiple commits for same file)
        if (!existing.committed) existing.committed = [];
        existing.committed.push(change);
      } else if (category === 'staged') {
        existing.staged = change;
      } else {
        existing.unstaged = change;
      }

      byPath.set(change.filePath, existing);
    }

    const merged: LocalFileChange[] = [];

    for (const [filePath, parts] of byPath) {
      // Collect all parts for this file
      const allParts: Array<{ change: LocalFileChange; category: ChangeCategory }> = [];

      if (parts.staged) {
        allParts.push({ change: parts.staged, category: 'staged' });
      }
      if (parts.unstaged) {
        allParts.push({ change: parts.unstaged, category: 'unstaged' });
      }
      if (parts.committed) {
        for (const commit of parts.committed) {
          allParts.push({ change: commit, category: 'committed' });
        }
      }

      // Calculate combined stats
      let totalAdditions = 0;
      let totalDeletions = 0;
      for (const part of allParts) {
        totalAdditions += part.change.additions || 0;
        totalDeletions += part.change.deletions || 0;
      }

      // Check if we have any non-committed parts (staged or unstaged)
      const hasNonCommittedParts = parts.staged || parts.unstaged;

      // If we have non-committed parts, merge them together (and include committed)
      // If we ONLY have committed parts, show each commit separately
      if (hasNonCommittedParts && allParts.length > 1) {
        // Merge staged/unstaged together, include committed parts
        const basePart = parts.unstaged || parts.staged || parts.committed?.[0];
        if (basePart) {
          merged.push({
            ...basePart,
            filePath,
            isMerged: true,
            stagedPart: parts.staged,
            unstagedPart: parts.unstaged,
            allParts,
            additions: totalAdditions,
            deletions: totalDeletions,
            category: undefined,
            staged: undefined,
          });
        }
      } else if (allParts.length === 1) {
        // Single part - just add it directly
        merged.push(allParts[0].change);
      } else if (!hasNonCommittedParts && parts.committed && parts.committed.length > 0) {
        if (groupByCommit) {
          // By-commit mode: show each commit separately
          for (const commit of parts.committed) {
            merged.push(commit);
          }
        } else if (parts.committed.length === 1) {
          // Single committed change - add directly
          merged.push(parts.committed[0]);
        } else {
          // Combined mode: merge all committed changes into a single entry
          const basePart = parts.committed[0];
          merged.push({
            ...basePart,
            filePath,
            isMerged: true,
            allParts,
            additions: totalAdditions,
            deletions: totalDeletions,
            category: undefined,
            staged: undefined,
          });
        }
      }
    }

    return merged;
  }

  // Apply merging to combine staged/unstaged for same file, then sort by filetree
  // Memoize using $effect to prevent re-renders when the underlying data hasn't changed
  let lastMergedChangesKey = '';
  let mergedChanges = $state<LocalFileChange[]>([]);

  $effect(() => {
    const sorted = sortChangesExplorerStyle(
      showStagingControls ? mergeChangesByFilePath(reactiveChanges) : reactiveChanges,
    );

    // Generate key to detect actual changes
    // Include additions/deletions because these change when hunks are staged/unstaged
    // For merged changes, also include the staged/unstaged part stats to detect changes
    // Include groupByCommit in key to ensure recalculation on toggle
    const newKey = `gbc:${groupByCommit}::` + sorted
      .map((c) => {
        const baseKey = `${c.filePath}|${c.category || c.staged}|${c.isMerged || false}|${c.additions || 0}|${c.deletions || 0}`;
        // For merged changes, also include the individual part stats
        if (c.isMerged) {
          const stagedStats = c.stagedPart
            ? `${c.stagedPart.additions || 0}:${c.stagedPart.deletions || 0}`
            : 'none';
          const unstagedStats = c.unstagedPart
            ? `${c.unstagedPart.additions || 0}:${c.unstagedPart.deletions || 0}`
            : 'none';
          return `${baseKey}|s:${stagedStats}|u:${unstagedStats}`;
        }
        return baseKey;
      })
      .join(';;');

    if (newKey === lastMergedChangesKey) {
      return; // Skip update - data hasn't changed
    }
    lastMergedChangesKey = newKey;
    mergedChanges = sorted;
  });

  // For aggregate views, we need to fetch git:diff to get correct content
  // The snippet-based content has wrong line numbers when aggregated
  let gitDiffChanges = $state<LocalFileChange[]>([]);

  // Track the last processed aggregate changes to avoid re-fetching
  let lastAggregateChangesKey = '';

  $effect(() => {
    if (!isAggregate) {
      // Only update if not already empty
      const currentLength = untrack(() => gitDiffChanges.length);
      if (currentLength > 0) {
        gitDiffChanges = [];
      }
      lastAggregateChangesKey = '';
      return;
    }

    const workspaceId = workspaceStore.current?.id;
    if (!workspaceId || reactiveChanges.length === 0) {
      // Only update if not already matching
      const currentLength = untrack(() => gitDiffChanges.length);
      if (currentLength !== reactiveChanges.length) {
        gitDiffChanges = reactiveChanges;
      }
      lastAggregateChangesKey = '';
      return;
    }

    // Check if changes have actually changed
    const newAggregateKey = generateChangesKey(reactiveChanges);
    // Use untrack to read current length without creating a dependency
    const currentLength = untrack(() => gitDiffChanges.length);
    if (newAggregateKey === lastAggregateChangesKey && currentLength > 0) {
      // Changes haven't actually changed, skip re-fetching
      return;
    }
    lastAggregateChangesKey = newAggregateKey;

    // Fetch git diff for each file
    const fetchGitDiffs = async () => {
      const results: LocalFileChange[] = [];

      for (const change of reactiveChanges) {
        try {
          const diffResult = (await invoke('git:diff', {
            workspaceId,
            paths: [change.filePath],
            staged: false,
          })) as {
            success: boolean;
            data?: Array<{
              file: string;
              oldContent?: string;
              newContent?: string;
              chunks?: any[];
            }>;
          };

          if (diffResult?.success && diffResult?.data && diffResult.data.length > 0) {
            const diffChunk = diffResult.data[0];
            if (diffChunk.oldContent !== undefined && diffChunk.newContent !== undefined) {
              // Use git diff content with proper full file content
              results.push({
                ...change,
                oldContent: diffChunk.oldContent,
                newContent: diffChunk.newContent,
                // Pass chunks for proper line-by-line diff visualization
                chunks: diffChunk.chunks,
                // Mark as full file content so MonacoDiffViewer knows it can use git:diff to refresh
                isFullFileContent: true,
              } as LocalFileChange);
            } else {
              results.push(change);
            }
          } else {
            results.push(change);
          }
        } catch (error) {
          logger.warn('Failed to fetch git diff', { filePath: change.filePath, error });
          results.push(change);
        }
      }

      gitDiffChanges = results;
    };

    fetchGitDiffs();
  });

  // Use git diff changes for visualization when aggregate, otherwise use merged changes
  let visualizationChanges = $derived(isAggregate ? gitDiffChanges : mergedChanges);

  let totalAdditions = $derived(mergedChanges.reduce((sum, c) => sum + c.additions, 0));
  let totalDeletions = $derived(mergedChanges.reduce((sum, c) => sum + c.deletions, 0));

  // Track expanded state for each file - start EXPANDED by default for better UX
  // Performance is handled by lazy-loading DiffViewers via Intersection Observer
  let expandedFiles = $state<Set<string>>(new Set());

  // Track user's expansion preference: 'expanded' = all files expanded, 'collapsed' = all files collapsed
  // null means use default behavior (expand all on first load)
  // This preference is preserved when switching between commits/changesets
  let userExpansionPreference = $state<'expanded' | 'collapsed' | null>(null);

  // Track which files have been scrolled into view (for lazy loading DiffViewers)
  // Once a file becomes visible, we keep the DiffViewer mounted to avoid re-init on scroll back
  let visibleFiles = $state<Set<string>>(new Set());

  // Track which files the user has marked as "viewed" (like GitHub PR reviews)
  let viewedFiles = $state<Set<string>>(new Set());
  let viewedCount = $derived(viewedFiles.size);
  let totalFileCount = $derived(new Set(mergedChanges.map((c) => c.filePath)).size);

  // Track which commit groups are expanded in "By commit" mode (default: all expanded)
  let expandedCommits = $state<Set<string>>(new Set());

  // Group mergedChanges by commit for "By commit" mode
  interface CommitGroup {
    hash: string;
    message: string;
    author?: string;
    authorEmail?: string;
    date?: string;
    agentId?: string;
    linkedNoteId?: string;
    changes: LocalFileChange[];
  }

  let commitGroups = $derived.by((): CommitGroup[] | null => {
    if (!groupByCommit) return null;
    const groups: CommitGroup[] = [];
    const seen = new Map<string, number>();
    const allCommits = fileTrackingStore.commits || [];

    for (const change of mergedChanges) {
      if (change.commitHash) {
        const idx = seen.get(change.commitHash);
        if (idx !== undefined) {
          groups[idx].changes.push(change);
        } else {
          // Look up full commit info from fileTrackingStore
          const commitDetail = allCommits.find((c) => c.hash === change.commitHash);
          seen.set(change.commitHash, groups.length);
          groups.push({
            hash: change.commitHash,
            message: change.commitMessage || change.commitHash.substring(0, 7),
            author: commitDetail?.author,
            authorEmail: commitDetail?.authorEmail,
            date: commitDetail?.date,
            agentId: commitDetail?.agentId,
            linkedNoteId: commitDetail?.linkedNoteId,
            changes: [change],
          });
        }
      } else {
        // Non-committed changes (unstaged/staged) — render without a commit header
        // Group consecutive non-committed changes together
        const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
        if (lastGroup && lastGroup.hash === '') {
          lastGroup.changes.push(change);
        } else {
          groups.push({ hash: '', message: 'Working changes', changes: [change] });
        }
      }
    }
    return groups;
  });

  // When commitGroups change, only auto-expand the first commit group for performance
  $effect(() => {
    if (commitGroups) {
      const currentExpanded = untrack(() => expandedCommits);
      const firstWithHash = commitGroups.find((g) => g.hash);
      if (firstWithHash && !currentExpanded.has(firstWithHash.hash)) {
        expandedCommits = new Set([...currentExpanded, firstWithHash.hash]);
      }
    }
  });

  // Initialize expanded state when changes load
  // Preserves the user's expansion preference when switching between commits
  // Uses getExpandKey to ensure correct keying in both combined and by-commit modes
  $effect(() => {
    const currentKeys = new Set(mergedChanges.map((c) => getExpandKey(c)));

    // Use untrack to read current state without creating dependency
    const preference = untrack(() => userExpansionPreference);
    const currentExpanded = untrack(() => expandedFiles);
    const hasOverlap = [...currentExpanded].some((key) => currentKeys.has(key));

    // If files changed completely (switching commits/modes) or it's the first load,
    // apply the user's preference or default to expanded
    if (currentKeys.size > 0 && !hasOverlap) {
      if (preference === 'collapsed') {
        // User prefers collapsed - keep all files collapsed
        expandedFiles = new Set();
        visibleFiles = new Set();
      } else {
        // Default: expand files (preference is 'expanded' or null)
        // In by-commit mode, only expand files belonging to expanded commit groups
        const currentExpandedCommits = untrack(() => expandedCommits);
        let keysToExpand: Set<string>;
        if (groupByCommit && currentExpandedCommits.size > 0) {
          keysToExpand = new Set(
            mergedChanges
              .filter((c) => c.commitHash && currentExpandedCommits.has(c.commitHash))
              .map((c) => getExpandKey(c)),
          );
        } else {
          keysToExpand = currentKeys;
        }
        expandedFiles = keysToExpand;
        // Let IntersectionObserver lazily populate visibleFiles as elements
        // scroll into view. Pre-populating with all keys causes OOM when
        // there are 100+ files (each mounts a Monaco diff editor).
        visibleFiles = new Set();
      }
    } else {
      // Files have some overlap - preserve existing expansion state for matching files
      const currentVisible = untrack(() => visibleFiles);

      const newExpanded = new Set<string>();
      for (const key of currentExpanded) {
        if (currentKeys.has(key)) {
          newExpanded.add(key);
        }
      }
      // Only update if something was actually removed
      if (newExpanded.size !== currentExpanded.size) {
        expandedFiles = newExpanded;
      }

      const newVisible = new Set<string>();
      for (const key of currentVisible) {
        if (currentKeys.has(key)) {
          newVisible.add(key);
        }
      }
      // Only update if something was actually removed
      if (newVisible.size !== currentVisible.size) {
        visibleFiles = newVisible;
      }
    }
  });

  // Intersection Observer action for lazy loading DiffViewers
  // Note: Content fetching for files beyond MAX_UPFRONT_FETCH_COUNT is handled
  // by TrackedChangeDiffViewer when the component renders, not here.
  function observeVisibility(node: HTMLElement, filePath: string) {
    // If already visible, no need to observe
    if (visibleFiles.has(filePath)) {
      return { destroy() {} };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Mark as visible and stop observing
            visibleFiles = new Set([...visibleFiles, filePath]);
            observer.disconnect();
          }
        }
      },
      {
        root: null,
        rootMargin: '100px', // Start loading slightly before visible
        threshold: 0,
      },
    );

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      },
    };
  }

  function openCurrentDiff(filePath: string, event?: MouseEvent) {
    // Find the change object for this file to get full context
    const change = changes.find((c) => c.filePath === filePath);

    // NOTE: We intentionally do NOT pass content here.
    // The oldContent/newContent from tool calls are snippets (just the changed portion),
    // not the full file content. If we pass them, DiffViewer would show a diff between
    // two small snippets, making it look like the entire old content was deleted.
    // By not passing content, DiffViewer will fetch the actual git diff.
    const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
    const panelElement = event?.target
      ? (event.target as HTMLElement)?.closest('[data-panel-id]')
      : null;
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const detail = {
      change: change
        ? {
            id: `chat-change-${filePath}`,
            file: filePath,
            relativePath: filePath,
            type: 'modified' as const,
            // Use the staged property from the change object if available
            stage: change.staged ? ('staged' as const) : ('unstaged' as const),
            stats: change
              ? { additions: change.additions, deletions: change.deletions }
              : { additions: 0, deletions: 0 },
            attribution: {
              manual: true,
              timestamp: Date.now(),
            },
            // Don't pass content - let DiffViewer fetch git diff for accurate display
          }
        : undefined,
      filePath,
      changeId: `chat-change-${filePath}`,
      openInAdjacentPanel,
      sourcePanelId,
    };
    window.dispatchEvent(new CustomEvent('workspace:open-diff', { detail }));
  }

  function openFile(filePath: string, event?: MouseEvent) {
    const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
    const panelElement = event?.target
      ? (event.target as HTMLElement)?.closest('[data-panel-id]')
      : null;
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    window.dispatchEvent(
      new CustomEvent('workspace:open-file', {
        detail: { path: filePath, openInAdjacentPanel, sourcePanelId },
      }),
    );
  }

  // Refresh diff for a single file after staging/unstaging
  // This is more performant than refreshing all file tracking data
  async function refreshFileDiff(filePath: string) {
    const workspaceId = workspaceStore.current?.id;
    if (!workspaceId) return;

    // Track that this file is being refreshed (for loading indicator)
    refreshingFiles = new Set([...refreshingFiles, filePath]);

    try {
      // Mark this file as recently refreshed IMMEDIATELY (before async operations)
      // This prevents the $effect from using stale parent data while we're fetching new data
      // The fileTrackingStore.refresh() may complete before our fetch does, and we need the
      // effect to skip this file and wait for our fresh data
      recentlyRefreshedFiles.set(filePath, Date.now());

      // Fetch both staged and unstaged diffs for this file
      const [stagedResult, unstagedResult] = await Promise.all([
        window.electronAPI?.invoke('git:diff', {
          workspaceId,
          paths: [filePath],
          staged: true,
        }) as Promise<
          | {
              success: boolean;
              data?: Array<{
                file: string;
                oldContent?: string;
                newContent?: string;
                chunks?: DiffHunk[];
              }>;
            }
          | undefined
        >,
        window.electronAPI?.invoke('git:diff', {
          workspaceId,
          paths: [filePath],
          staged: false,
        }) as Promise<
          | {
              success: boolean;
              data?: Array<{
                file: string;
                oldContent?: string;
                newContent?: string;
                chunks?: DiffHunk[];
              }>;
            }
          | undefined
        >,
      ]);

      const hasStagedChanges =
        stagedResult?.success &&
        stagedResult.data &&
        stagedResult.data.length > 0 &&
        (stagedResult.data[0].chunks?.length ?? 0) > 0;
      const hasUnstagedChanges =
        unstagedResult?.success &&
        unstagedResult.data &&
        unstagedResult.data.length > 0 &&
        (unstagedResult.data[0].chunks?.length ?? 0) > 0;

      // Helper to calculate additions/deletions from chunks
      function calculateStats(chunks: DiffHunk[] | undefined): {
        additions: number;
        deletions: number;
      } {
        let additions = 0;
        let deletions = 0;
        for (const chunk of chunks || []) {
          for (const line of chunk.lines || []) {
            if (line.type === 'Addition') additions++;
            else if (line.type === 'Deletion') deletions++;
          }
        }
        return { additions, deletions };
      }

      // Build new entries for this file, preserving existing entry data where possible
      const existingEntries = enrichedChanges.filter((c) => c.filePath === filePath);
      const newEntries: LocalFileChange[] = [];

      if (hasUnstagedChanges && unstagedResult?.data?.[0]) {
        const diffData = unstagedResult.data[0];
        const stats = calculateStats(diffData.chunks);
        // Find existing unstaged entry to preserve toolName, toolCallId, action
        const existingUnstaged = existingEntries.find((e) => !e.staged);
        newEntries.push({
          filePath,
          additions: stats.additions,
          deletions: stats.deletions,
          staged: false,
          category: 'unstaged' as ChangeCategory,
          oldContent: diffData.oldContent || '',
          newContent: diffData.newContent || '',
          chunks: diffData.chunks,
          // Mark as full file content so MonacoDiffViewer knows it can use git:diff to refresh
          isFullFileContent: true,
          // Preserve required fields from existing entry or use defaults
          action: existingUnstaged?.action || 'modify',
          toolName: existingUnstaged?.toolName || 'git',
          toolCallId: existingUnstaged?.toolCallId || `local-${filePath}-unstaged`,
        });
      }

      if (hasStagedChanges && stagedResult?.data?.[0]) {
        const diffData = stagedResult.data[0];
        const stats = calculateStats(diffData.chunks);
        // Find existing staged entry to preserve toolName, toolCallId, action
        const existingStaged = existingEntries.find((e) => e.staged);
        newEntries.push({
          filePath,
          additions: stats.additions,
          deletions: stats.deletions,
          staged: true,
          category: 'staged' as ChangeCategory,
          oldContent: diffData.oldContent || '',
          newContent: diffData.newContent || '',
          chunks: diffData.chunks,
          // Mark as full file content so MonacoDiffViewer knows it can use git:diff to refresh
          isFullFileContent: true,
          // Preserve required fields from existing entry or use defaults
          action: existingStaged?.action || 'modify',
          toolName: existingStaged?.toolName || 'git',
          toolCallId: existingStaged?.toolCallId || `local-${filePath}-staged`,
        });
      }

      // Update the timestamp again now that we have fresh data
      // This resets the cooldown timer so the effect continues to use our data
      recentlyRefreshedFiles.set(filePath, Date.now());

      // Update enrichedChanges: remove old entries for this file, add new ones
      enrichedChanges = [...enrichedChanges.filter((c) => c.filePath !== filePath), ...newEntries];
    } finally {
      // Remove file from refreshing set (done loading)
      const newSet = new Set(refreshingFiles);
      newSet.delete(filePath);
      refreshingFiles = newSet;
    }
  }

  /**
   * Validate that a patch has the required structure for git apply.
   * Returns an error message if invalid, undefined if valid.
   */
  function validatePatch(hunkPatch: string): string | undefined {
    if (!hunkPatch || typeof hunkPatch !== 'string') {
      return 'Invalid patch: empty or not a string';
    }
    if (!hunkPatch.includes('@@')) {
      return 'Invalid patch: missing hunk header (@@)';
    }
    if (!hunkPatch.includes('diff --git') && !hunkPatch.includes('---')) {
      return 'Invalid patch: missing file header';
    }
    return undefined;
  }

  // Hunk staging handlers for inline diffs
  async function handleStageHunk(filePath: string, hunkPatch: string) {
    const workspaceId = workspaceStore.current?.id;
    if (!workspaceId) {
      toast.error('No space available');
      return;
    }

    // Validate patch structure before attempting to apply
    const validationError = validatePatch(hunkPatch);
    if (validationError) {
      logger.warn('Invalid patch for staging', { filePath, error: validationError });
      toast.error('Failed to stage: invalid patch data');
      return;
    }

    // Preserve scroll position before staging
    const scrollTop = scrollContainerRef?.scrollTop ?? 0;

    const result = await gitStore.stageHunk(workspaceId as WorkspaceId, filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk staged');
      // Performant update: only refresh the affected file's diff
      await refreshFileDiff(filePath);
      // NOTE: Removed fileTrackingStore.refresh() - it was causing flicker because
      // the parent's changes prop would update with stale data, triggering the effect
      // to overwrite our fresh data. The local refreshFileDiff is sufficient for UI.
      // Restore scroll position
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          scrollContainerRef.scrollTop = scrollTop;
        }
      });
    } else {
      toast.error(result.error || 'Failed to stage hunk');
    }
  }

  async function handleUnstageHunk(filePath: string, hunkPatch: string) {
    const workspaceId = workspaceStore.current?.id;
    if (!workspaceId) {
      toast.error('No space available');
      return;
    }

    // Validate patch structure before attempting to apply
    const validationError = validatePatch(hunkPatch);
    if (validationError) {
      logger.warn('Invalid patch for unstaging', { filePath, error: validationError });
      toast.error('Failed to unstage: invalid patch data');
      return;
    }

    // Preserve scroll position before unstaging
    const scrollTop = scrollContainerRef?.scrollTop ?? 0;

    const result = await gitStore.unstageHunk(workspaceId as WorkspaceId, filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk unstaged');
      // Performant update: only refresh the affected file's diff
      await refreshFileDiff(filePath);
      // NOTE: Removed fileTrackingStore.refresh() - it was causing flicker because
      // the parent's changes prop would update with stale data, triggering the effect
      // to overwrite our fresh data. The local refreshFileDiff is sufficient for UI.
      // Restore scroll position
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          scrollContainerRef.scrollTop = scrollTop;
        }
      });
    } else {
      toast.error(result.error || 'Failed to unstage hunk');
    }
  }

  // Handle opening a commit changeset view
  function handleOpenCommit(commitHash: string) {
    window.dispatchEvent(
      new CustomEvent('workspace:open-commit-changeset', {
        detail: { commitHash },
      }),
    );
  }

  function toggleFile(expandKey: string) {
    const newSet = new Set(expandedFiles);
    if (newSet.has(expandKey)) {
      newSet.delete(expandKey);
    } else {
      newSet.add(expandKey);
    }
    expandedFiles = newSet;
  }

  // Toggle a commit group's expanded/collapsed state in "By commit" mode
  function toggleCommitGroup(hash: string) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(hash)) {
      newSet.delete(hash);
    } else {
      newSet.add(hash);
    }
    expandedCommits = newSet;
  }

  // Toggle a file's "viewed" state (like GitHub PR review checkboxes)
  // viewedFiles always stores file paths (not expand keys) for consistency
  // across combined and by-commit modes.
  function toggleViewed(filePath: string, expandKey: string) {
    const newViewed = new Set(viewedFiles);
    const newExpanded = new Set(expandedFiles);
    if (newViewed.has(filePath)) {
      // Unmark as viewed — re-expand the diff
      newViewed.delete(filePath);
      newExpanded.add(expandKey);
    } else {
      // Mark as viewed — collapse all expand keys for this file path
      newViewed.add(filePath);
      for (const change of mergedChanges) {
        if (change.filePath === filePath) {
          newExpanded.delete(getExpandKey(change));
        }
      }
    }
    viewedFiles = newViewed;
    expandedFiles = newExpanded;

    // Persist to transient store
    if (cachedTransientStore) {
      const newStoredViewed: Record<string, string> = {};
      for (const fp of newViewed) {
        newStoredViewed[fp] = getCommitFingerprint(fp);
      }
      cachedTransientStore.setViewedFiles(newStoredViewed);
    }
  }

  // Export these functions so parent can control expansion
  export function expandAll() {
    userExpansionPreference = 'expanded';
    // Do NOT expand files the user has marked as viewed
    expandedFiles = new Set(
      mergedChanges.filter((c) => !viewedFiles.has(c.filePath)).map((c) => getExpandKey(c)),
    );
  }

  export function collapseAll() {
    userExpansionPreference = 'collapsed';
    expandedFiles = new Set();
  }

  // Export setter so parent tab wrappers can control group-by-commit mode
  export function setGroupByCommit(value: boolean) {
    groupByCommit = value;
  }

  let allExpanded = $derived(
    mergedChanges.length > 0 &&
      mergedChanges
        .filter((c) => !viewedFiles.has(c.filePath))
        .every((c) => expandedFiles.has(getExpandKey(c))),
  );

  // File refs for visualization navigation
  let fileRefs = $state<Map<string, HTMLDivElement>>(new Map());

  // Commit group refs for scroll-to-commit navigation
  let commitGroupRefs = $state<Map<string, HTMLDivElement>>(new Map());

  // Svelte action to register commit group element refs for scroll-to-commit
  function registerCommitGroupRef(node: HTMLDivElement, hash: string) {
    commitGroupRefs.set(hash, node);
    return {
      destroy() {
        commitGroupRefs.delete(hash);
      },
    };
  }

  // Scroll to a commit group and expand it
  function scrollToCommitGroup(hash: string) {
    // Close the dropdown
    isSummaryBarHovered = false;

    // Expand the commit group if not already expanded
    if (!expandedCommits.has(hash)) {
      expandedCommits = new Set([...expandedCommits, hash]);
    }

    // Scroll to the commit group header after a tick to allow DOM updates
    requestAnimationFrame(() => {
      const ref = commitGroupRefs.get(hash);
      if (ref && scrollContainerRef) {
        const containerRect = scrollContainerRef.getBoundingClientRect();
        const elRect = ref.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + scrollContainerRef.scrollTop - 53;
        scrollContainerRef.scrollTo({ top: offset, behavior: 'smooth' });
        // Brief highlight effect
        ref.classList.add('bg-accent/20');
        setTimeout(() => {
          ref.classList.remove('bg-accent/20');
        }, 1500);
      }
    });
  }

  // Svelte action to register file element refs for scroll-to-file
  function registerRef(node: HTMLDivElement, filePath: string) {
    fileRefs.set(filePath, node);
    return {
      destroy() {
        fileRefs.delete(filePath);
      },
    };
  }

  // Track which file/line to scroll to in the diff viewer
  let scrollTarget = $state<{ filePath: string; lineNumber: number } | null>(null);

  // Handle visualization click - scroll to file in list and highlight
  // Accepts union type from ChangeSetVisualization
  function handleVisualizationFileClick(change: unknown) {
    // Support both ChatFileChange (filePath) and TrackedChange (path)
    const changeObj = change as { filePath?: string; path?: string };
    const filePath = changeObj.filePath || changeObj.path;
    if (!filePath) return;

    scrollToFile(filePath);
  }

  // Handle visualization line click - scroll to file AND specific line
  function handleVisualizationLineClick(
    change: unknown,
    _lineIndex: number,
    line: VisualizationLine,
  ) {
    const changeObj = change as { filePath?: string; path?: string };
    const filePath = changeObj.filePath || changeObj.path;
    if (!filePath) return;

    // Get the line number in the new file (for scrolling in the diff viewer)
    const lineNumber = line.newLineNumber || line.lineNumber + 1;

    // Set scroll target - this will be passed to the InlineDiffItem
    scrollTarget = { filePath, lineNumber };

    // Also scroll to the file card
    scrollToFile(filePath);

    // Clear scroll target after a delay to allow re-clicking the same line
    setTimeout(() => {
      scrollTarget = null;
    }, 100);
  }

  // Common logic for scrolling to a file
  async function scrollToFile(filePath: string) {
    // In by-commit mode, ensure the commit group containing this file is expanded first
    if (groupByCommit && commitGroups) {
      let needsTick = false;
      for (const group of commitGroups) {
        if (group.hash && group.changes.some((c) => c.filePath === filePath)) {
          if (!expandedCommits.has(group.hash)) {
            const newSet = new Set(expandedCommits);
            newSet.add(group.hash);
            expandedCommits = newSet;
            needsTick = true;
          }
          break;
        }
      }
      // Wait for DOM to update after expanding the commit group
      if (needsTick) {
        await tick();
      }
    }

    const ref = fileRefs.get(filePath);
    if (ref && scrollContainerRef) {
      const containerRect = scrollContainerRef.getBoundingClientRect();
      const elRect = ref.getBoundingClientRect();
      // Scroll so the file sits 20px below the sticky summary bar (~33px)
      const offset = elRect.top - containerRect.top + scrollContainerRef.scrollTop - 53;
      scrollContainerRef.scrollTo({ top: offset, behavior: 'smooth' });
      // Brief highlight effect using background color instead of ring
      ref.classList.add('bg-accent/20');
      setTimeout(() => {
        ref.classList.remove('bg-accent/20');
      }, 1500);
    }
    // Expand the file if collapsed - find matching expand key(s) for this file
    const matchingKeys = mergedChanges
      .filter((c) => c.filePath === filePath)
      .map((c) => getExpandKey(c));
    const anyExpanded = matchingKeys.some((key) => expandedFiles.has(key));
    if (!anyExpanded && matchingKeys.length > 0) {
      toggleFile(matchingKeys[0]);
    }
  }

  // Sticky header collapse behavior
  let isStuck = $state(false);
  let isHeaderHovered = $state(false);

  // Reference to scroll container for preserving scroll position
  let scrollContainerRef: HTMLElement | null = $state(null);

  // Detect when header becomes stuck using scroll position
  function handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    // Collapse after scrolling down 100px
    isStuck = target.scrollTop > 100;
    updateFirstInViewFile(target);
  }

  // Derived state for whether header should be collapsed
  const isHeaderCollapsed = $derived(isStuck && !isHeaderHovered);

  // Track which file is first in view in the scroll container
  let firstInViewFilePath = $state<string | null>(null);

  function updateFirstInViewFile(scrollContainer: HTMLElement) {
    const containerRect = scrollContainer.getBoundingClientRect();
    // Account for sticky summary bar height (~33px)
    const topEdge = containerRect.top + 33;
    let topmost: string | null = null;
    let topmostTop = Infinity;

    for (const [filePath, el] of fileRefs) {
      const rect = el.getBoundingClientRect();
      // File is in view if its bottom is below the top edge and top is above the container bottom
      if (rect.bottom > topEdge && rect.top < containerRect.bottom) {
        // Pick the file whose top is closest to (but not necessarily above) the top edge
        if (rect.top < topmostTop) {
          topmostTop = rect.top;
          topmost = filePath;
        }
      }
    }
    firstInViewFilePath = topmost;
  }

  // Hover state for summary bar file list
  let isSummaryBarHovered = $state(false);
  let summaryBarHoverTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleSummaryBarMouseEnter() {
    if (summaryBarHoverTimeout) {
      clearTimeout(summaryBarHoverTimeout);
      summaryBarHoverTimeout = null;
    }
    isSummaryBarHovered = true;
  }

  function handleSummaryBarMouseLeave() {
    summaryBarHoverTimeout = setTimeout(() => {
      isSummaryBarHovered = false;
    }, 200);
  }

  function handleSummaryFileClick(filePath: string) {
    isSummaryBarHovered = false;
    scrollToFile(filePath);
  }

  // State for copy SHA functionality
  let copiedSha = $state(false);

  function copyCommitSha() {
    if (commitInfo?.hash) {
      navigator.clipboard.writeText(commitInfo.hash);
      copiedSha = true;
      setTimeout(() => {
        copiedSha = false;
      }, 2000);
    }
  }

  // Handle opening agent from commit info
  function handleOpenAgentFromCommit(event?: MouseEvent) {
    const agentIdToOpen = commitInfo?.agentId || agentId;
    if (agentIdToOpen) {
      onOpenAgent?.(agentIdToOpen, event);
    }
  }

  // Open commit in an embedded browser panel tab
  function openCommitInBrowser() {
    if (!commitInfo?.hash) return;
    const workspace = workspaceStore.current;
    const repoOwner = workspace?.repositoryOwner;
    const repoName = workspace?.repositoryName;
    const wsId = workspace?.id;
    if (repoOwner && repoName && wsId) {
      const url = `https://github.com/${repoOwner}/${repoName}/commit/${commitInfo.hash}`;
      const layoutManager = getPanelLayoutManager(wsId);
      layoutManager.openTab({
        type: 'browser',
        title: `${commitInfo.hash.substring(0, 7)} · ${repoName}`,
        closable: true,
        browserUrl: url,
        workspaceId: wsId,
      });
    }
  }

  // Derive commit GitHub URL availability
  const hasCommitUrl = $derived(() => {
    const workspace = workspaceStore.current;
    return !!(commitInfo?.hash && workspace?.repositoryOwner && workspace?.repositoryName);
  });

  // Extract GitHub username from email (noreply pattern) for avatar
  function getGitHubUsername(email?: string): string | null {
    if (!email) return null;
    // GitHub noreply: {id}+{username}@users.noreply.github.com or {username}@users.noreply.github.com
    const noreplyMatch = email.match(/(?:\d+\+)?([^@]+)@users\.noreply\.github\.com/);
    if (noreplyMatch) return noreplyMatch[1];
    return null;
  }

  // Get GitHub avatar URL — try username from email, fall back to null
  function getGitHubAvatarUrl(email?: string, size: number = 28): string | null {
    const username = getGitHubUsername(email);
    if (username) return `https://github.com/${username}.png?size=${size * 2}`;
    return null;
  }

  // Get author initials for avatar fallback
  function getAuthorInitials(name?: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name[0]?.toUpperCase() || '?';
  }
</script>

<!-- header is managed by panel tab bar -->
<div class="h-full w-full flex flex-col overflow-hidden">
  <!-- Scroll container -->
  <div class="h-full overflow-auto p-5 pt-0" onscroll={handleScroll} bind:this={scrollContainerRef}>
    <!-- Commit Details Section -->
    {#if commitInfo}
      {@render commitDetailsSection()}
    {/if}

    <!-- File List with Inline Diffs -->
    {#if showLoadingState}
      <!-- Skeleton loader for file changes -->
      <div class="flex flex-col gap-3 py-6">
        {#each Array(4) as _, i}
          <div class="rounded-lg border border-border bg-card p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2 flex-1">
                <Skeleton class="h-4 w-4 rounded" />
                <Skeleton class="h-4 w-48" />
              </div>
              <Skeleton class="h-5 w-16 rounded-full" />
            </div>
            <div class="space-y-2">
              <Skeleton class="h-3 w-full" />
              <Skeleton class="h-3 w-5/6" />
              <Skeleton class="h-3 w-4/6" />
            </div>
          </div>
        {/each}
      </div>
    {:else if mergedChanges.length === 0}
      <div class="flex items-center justify-center h-full text-subtle py-6">
        No changes to display
      </div>
    {:else}
      <!-- Sticky summary bar: "N files changed" with hover file list -->
      <div
        class="sticky top-0 z-20 -mx-5 px-5"
      >
        <div class="flex items-center justify-between py-2 bg-background/95 backdrop-blur-sm border-b border-border">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="text-xs font-medium text-subtle whitespace-nowrap"
            onmouseenter={handleSummaryBarMouseEnter}
            onmouseleave={handleSummaryBarMouseLeave}
          >
            {totalFileCount} file{totalFileCount === 1 ? '' : 's'} changed
            {#if groupByCommit && commitCount > 0}
              , {commitCount} commit{commitCount === 1 ? '' : 's'}
            {/if}
            {#if viewedCount > 0}
              <span class="text-subtle">·</span>
              <span>{viewedCount} viewed</span>
            {/if}
          </span>
          <div class="flex items-center gap-2">
            {#if hasCommittedChanges && !commitInfo}
              <div class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 -my-1">
                <button
                  type="button"
                  class="px-2 py-0.5 text-xs rounded cursor-pointer transition-colors {!groupByCommit ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (groupByCommit = false)}
                >
                  Combined
                </button>
                <button
                  type="button"
                  class="px-2 py-0.5 text-xs rounded cursor-pointer transition-colors {groupByCommit ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (groupByCommit = true)}
                >
                  By commit
                </button>
              </div>
            {/if}
          </div>
        </div>

        <!-- Expandable file list on hover (absolute overlay, doesn't push content) -->
        {#if isSummaryBarHovered}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="absolute left-0 right-0 bg-background/95 backdrop-blur-sm border-b border-border shadow-lg py-1 px-3 overflow-y-auto"
            style="max-height: 80vh;"
            transition:slide={{ axis: 'y', duration: 150 }}
            onmouseenter={handleSummaryBarMouseEnter}
            onmouseleave={handleSummaryBarMouseLeave}
          >
            {#if groupByCommit && commitGroups}
              <!-- Show files grouped by commit -->
              {#each commitGroups as group (group.hash || 'working')}
                {#if group.hash}
                  <button
                    type="button"
                    class="w-full flex items-center gap-1.5 px-2 py-1 text-left text-ui text-muted-foreground font-medium mt-1 first:mt-0 cursor-pointer hover:text-foreground transition-colors"
                    onclick={() => scrollToCommitGroup(group.hash)}
                    title="Scroll to commit"
                  >
                    <span class="truncate">{group.message.split('\n')[0]}</span>
                    <span class="shrink-0 text-ghost">·</span>
                    <span class="shrink-0">{group.changes.length} file{group.changes.length === 1 ? '' : 's'}</span>
                  </button>
                {:else}
                  <div class="px-2 py-1 text-ui text-subtle font-medium mt-1 first:mt-0">
                    Working changes
                  </div>
                {/if}
                {#each group.changes as change (change.filePath + '-summary-' + group.hash)}
                  {@const displayPath = getDisplayPath(change.filePath)}
                  {@const isActive = firstInViewFilePath === change.filePath}
                  {@const isViewed = viewedFiles.has(change.filePath)}
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-2 pl-5 py-1 rounded text-left transition-colors cursor-pointer text-xs hover:bg-muted/50 {isActive ? 'bg-accent/15 text-foreground' : 'text-muted-foreground'} {isViewed ? 'opacity-50' : ''}"
                    onclick={() => handleSummaryFileClick(change.filePath)}
                  >
                    <span class="truncate flex-1 min-w-0">
                      <span class="font-medium">{getFileName(displayPath)}</span>
                      {#if getDirectoryPath(displayPath)}
                        <span class="text-subtle ml-1">{getDirectoryPath(displayPath)}</span>
                      {/if}
                    </span>
                    <LineChangesBadge additions={change.additions} deletions={change.deletions} size="xs" />
                  </button>
                {/each}
              {/each}
            {:else}
              <!-- Flat file list -->
              {#each mergedChanges as change (change.filePath + '-summary')}
                {@const displayPath = getDisplayPath(change.filePath)}
                {@const isActive = firstInViewFilePath === change.filePath}
                {@const isViewed = viewedFiles.has(change.filePath)}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors cursor-pointer text-xs hover:bg-muted/50 {isActive ? 'bg-accent/15 text-foreground' : 'text-muted-foreground'} {isViewed ? 'opacity-50' : ''}"
                  onclick={() => handleSummaryFileClick(change.filePath)}
                >
                  <span class="truncate flex-1 min-w-0">
                    <span class="font-medium">{getFileName(displayPath)}</span>
                    {#if getDirectoryPath(displayPath)}
                      <span class="text-subtle ml-1">{getDirectoryPath(displayPath)}</span>
                    {/if}
                  </span>
                  <LineChangesBadge additions={change.additions} deletions={change.deletions} size="xs" />
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
      <div class="flex flex-col gap-2 py-6">
        {#if groupByCommit && commitGroups}
          <!-- Group-by-commit mode: render changes grouped under commit headers -->
          {#each commitGroups as group, i (group.hash || 'working-' + i)}
            {#if group.hash}
              <!-- Commit group with sticky collapsible header -->
              <div class="mb-2" use:registerCommitGroupRef={group.hash}>
                <div class="sticky top-[31.5px] z-[11] bg-background/95 backdrop-blur-sm rounded-md">
                  <div class="flex items-center gap-2 w-full px-3 py-2 rounded-md bg-muted/30">
                    <button
                      type="button"
                      class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                      onclick={() => toggleCommitGroup(group.hash)}
                    >
                      <Fa
                        icon={expandedCommits.has(group.hash) ? faChevronDown : faChevronRight}
                        class="text-subtle w-2.5! h-2.5! shrink-0"
                      />
                      <!-- Author avatar -->
                      <div
                        class="shrink-0 w-5 h-5 rounded-full bg-muted-foreground/15 flex items-center justify-center text-ui font-medium text-subtle select-none overflow-hidden"
                        title={group.author || ''}
                      >
                        {#if getGitHubAvatarUrl(group.authorEmail, 20)}
                          <img
                            src={getGitHubAvatarUrl(group.authorEmail, 20) ?? ''}
                            alt={group.author || ''}
                            class="w-full h-full object-cover"
                            loading="lazy"
                            onerror={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                              const sibling = (e.currentTarget as HTMLImageElement).nextElementSibling;
                              if (sibling) (sibling as HTMLElement).classList.remove('hidden');
                            }}
                          />
                          <span class="hidden">{getAuthorInitials(group.author)}</span>
                        {:else}
                          {getAuthorInitials(group.author)}
                        {/if}
                      </div>
                      <span class="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                        {group.message.split('\n')[0]}
                      </span>
                    </button>
                    <span class="text-ui text-subtle shrink-0 flex items-center gap-1.5">
                      {#if group.date}
                        <span>{formatRelativeTime(group.date)}</span>
                        <span class="text-ghost">·</span>
                      {/if}
                      <span>{group.changes.length} file{group.changes.length === 1 ? '' : 's'}</span>
                    </span>
                    <button
                      type="button"
                      class="text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                      onclick={() => handleOpenCommit(group.hash)}
                      title="Open commit"
                    >
                      <Fa icon={faArrowUpRightFromSquare} class="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
                {#if expandedCommits.has(group.hash)}
                  <div class="flex flex-col gap-2 mt-2 mx-2" transition:slide={{ duration: 150 }}>
                    {#each group.changes as change (getExpandKey(change))}
                      {@render fileCard(change, true)}
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <!-- Working changes (unstaged/staged) without a commit header -->
              {#each group.changes as change (getExpandKey(change))}
                {@render fileCard(change, false)}
              {/each}
            {/if}
          {/each}
        {:else}
          <!-- Combined mode: flat list of merged changes -->
          {#each mergedChanges as change (change.filePath + '-' + (change.commitHash || 'working'))}
            {@render fileCard(change)}
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

{#snippet commitDetailsSection()}
  <div class="mb-3 px-1">
    <div class="flex items-start gap-2.5 py-2">
      <!-- Author avatar (GitHub image with initials fallback) -->
      <div
        class="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-muted-foreground/15 flex items-center justify-center text-ui font-medium text-subtle select-none overflow-hidden"
        title={commitInfo?.author || ''}
      >
        {#if getGitHubAvatarUrl(commitInfo?.authorEmail)}
          <img
            src={getGitHubAvatarUrl(commitInfo?.authorEmail) ?? ''}
            alt={commitInfo?.author || ''}
            class="w-full h-full object-cover"
            loading="lazy"
            onerror={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const sibling = (e.currentTarget as HTMLImageElement).nextElementSibling;
              if (sibling) (sibling as HTMLElement).classList.remove('hidden');
            }}
          />
          <span class="hidden">{getAuthorInitials(commitInfo?.author)}</span>
        {:else}
          {getAuthorInitials(commitInfo?.author)}
        {/if}
      </div>

      <div class="flex-1 min-w-0 space-y-1">
        <!-- Commit title — clickable if GitHub URL available -->
        {#if hasCommitUrl()}
          <button
            type="button"
            class="text-sm font-medium text-foreground hover:text-accent-foreground hover:underline underline-offset-2 text-left cursor-pointer transition-colors leading-snug"
            onclick={openCommitInBrowser}
            title="Open on GitHub"
          >
            {commitInfo?.message?.split('\n')[0] || 'Untitled commit'}
            <Fa icon={faArrowUpRightFromSquare} class="inline-block w-2.5 h-2.5 ml-1 opacity-40" />
          </button>
        {:else}
          <p class="text-sm font-medium text-foreground leading-snug">
            {commitInfo?.message?.split('\n')[0] || 'Untitled commit'}
          </p>
        {/if}

        <!-- Meta line: author · relative date · sha -->
        <div class="flex items-center gap-1.5 text-ui text-subtle flex-wrap">
          {#if commitInfo?.author}
            <span>{commitInfo.author}</span>
          {/if}
          {#if commitInfo?.date}
            <span class="text-ghost">·</span>
            <span title={commitInfo.date}>{formatRelativeTime(commitInfo.date)}</span>
          {/if}
          {#if commitInfo?.hash}
            <span class="text-ghost">·</span>
            <button
              type="button"
              class="inline-flex items-center gap-0.5 font-mono hover:text-foreground transition-colors"
              onclick={copyCommitSha}
              title={copiedSha ? 'Copied!' : 'Copy full SHA'}
            >
              {commitInfo.hash.substring(0, 7)}
              <Fa icon={copiedSha ? faCheck : faCopy} class="w-2 h-2 opacity-50" />
            </button>
          {/if}
        </div>

        <!-- Commit body (rest of message if multiline) -->
        {#if commitInfo?.message && commitInfo.message.includes('\n')}
          {@const body = commitInfo.message.split('\n').slice(1).join('\n').trim()}
          {#if body}
            <p class="text-xs text-subtle whitespace-pre-wrap leading-relaxed pt-0.5">
              {body}
            </p>
          {/if}
        {/if}

        <!-- Agent / Linked note -->
        {#if commitInfo?.agentId || agentId || commitInfo?.linkedNoteId}
          <div class="flex items-center gap-2.5 min-w-0">
            {#if commitInfo?.agentId || agentId}
              {@const displayAgentId = commitInfo?.agentId || agentId}
              {@const agentSession = displayAgentId
                ? sessionStore.getSession(displayAgentId)
                : undefined}
              {@const agentName =
                agentSession?.name && agentSession.name !== 'New Workspace Agent'
                  ? agentSession.name
                  : 'Agent'}
              <button
                type="button"
                class="flex items-center gap-1 text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-w-0"
                onclick={(e) => handleOpenAgentFromCommit(e)}
                title="Open agent"
              >
                <span class="shrink-0">
                  <AuggieAvatar
                    faceSeed={displayAgentId ?? undefined}
                    colorSeed={displayAgentId ?? undefined}
                    size={14}
                  />
                </span>
                <span class="truncate">{agentName}</span>
              </button>
            {/if}
            {#if commitInfo?.linkedNoteId && onOpenNote}
              {@const linkedNote = notesStore.findById(NoteId(commitInfo.linkedNoteId))}
              {@const noteName = linkedNote?.title || 'Note'}
              <button
                type="button"
                class="flex items-center gap-1 text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-w-0"
                onclick={(e) => onOpenNote?.(commitInfo?.linkedNoteId!, e)}
                title="Open linked note"
              >
                <Fa icon={faNote} class="w-2.5 h-2.5 shrink-0" />
                <span class="truncate">{noteName}</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet fileCard(change: LocalFileChange, inCommitGroup?: boolean)}
  {@const displayPath = getDisplayPath(change.filePath)}
  {@const expandKey = getExpandKey(change)}
  {@const isViewed = viewedFiles.has(change.filePath)}
  {@const stickyTop = inCommitGroup ? '64px' : '31.5px'}
  <div
    class="mb-4 bg-sidebar border border-border rounded-lg overflow-clip transition-all duration-300 {isViewed ? 'opacity-50' : ''}"
    style="overflow-anchor: none;"
    use:registerRef={change.filePath}
  >
    <!-- File Header (sticky within scroll container) -->
    <div class="flex items-center gap-2 px-4 py-1.5 group relative sticky z-10 bg-sidebar" style="top: {stickyTop}; border-bottom: 1px solid {expandedFiles.has(expandKey) ? 'var(--border)' : 'transparent'}">
      <button
        onclick={() => toggleFile(expandKey)}
        class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer shrink"
      >
        <Fa
          icon={expandedFiles.has(expandKey) ? faChevronDown : faChevronRight}
          class="text-subtle w-2.5! h-2.5! shrink-0"
        />

        <span class="text-sm truncate shrink-0 max-w-full" title={displayPath}>
          {getFileName(displayPath)}
        </span>
        {#if getDirectoryPath(displayPath)}
          <span class="text-xs text-subtle truncate hidden sm:inline shrink-6">
            {getDirectoryPath(displayPath)}
          </span>
        {/if}
        <LineChangesBadge additions={change.additions} deletions={change.deletions} size="xs" />
        <!-- Loading indicator when file is being refreshed -->
        {#if refreshingFiles.has(change.filePath)}
          <Fa icon={faSpinner} class="w-3 h-3 text-ghost animate-spin shrink-0" />
        {/if}
      </button>

      <!-- Action buttons -->
      <div
        class="absolute right-2 flex items-center gap-px"
      >
        <div class="flex items-center gap-px bg-background opacity-0 group-hover:opacity-100 transition-opacity">
        {#if showStagingControls}
          {@const locked = isFileLocked(change.filePath)}
          <!-- Staging controls for merged changes (both staged and unstaged) -->
          {#if change.isMerged}
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Stage unstaged changes'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onStage?.(change.filePath);
              }}
            >
              <Fa icon={faPlus} class="w-3 h-3" />
            </Button>
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Unstage staged changes'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onUnstage?.(change.filePath);
              }}
            >
              <Fa icon={faMinus} class="w-3 h-3" />
            </Button>
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Revert unstaged changes'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onRevert?.(change.filePath);
              }}
            >
              <Fa icon={faRotateLeft} class="w-3 h-3" />
            </Button>
          {:else if change.staged}
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Unstage file'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onUnstage?.(change.filePath);
              }}
            >
              <Fa icon={faMinus} class="w-3 h-3" />
            </Button>
          {:else if change.category !== 'committed'}
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Stage file'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onStage?.(change.filePath);
              }}
            >
              <Fa icon={faPlus} class="w-3 h-3" />
            </Button>
            <Button
              variant="ghost-light"
              size="icon-xs"
              tooltip={locked ? LOCKED_TOOLTIP : 'Revert changes'}
              disabled={locked}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onRevert?.(change.filePath);
              }}
            >
              <Fa icon={faRotateLeft} class="w-3 h-3" />
            </Button>
          {/if}
        {/if}
        <Button
          variant="ghost-light"
          size="icon-xs"
          tooltip="View current diff"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            openCurrentDiff(change.filePath, e);
          }}
        >
          <Fa icon={faCodeCompare} class="w-3 h-3" />
        </Button>
        <Button
          variant="ghost-light"
          size="icon-xs"
          tooltip="Open file"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            openFile(change.filePath, e);
          }}
        >
          <Fa icon={faArrowUpRightFromSquare} class="w-3 h-3" />
        </Button>
        </div>
        <!-- Always-visible viewed checkbox -->
        <label
          class="shrink-0 flex items-center gap-1.5 cursor-pointer ml-1"
          title={isViewed ? 'Mark as not viewed' : 'Mark as viewed'}
          onclick={(e: MouseEvent) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isViewed}
            onchange={() => toggleViewed(change.filePath, expandKey)}
            class="sr-only peer"
          />
          <span
            class="w-3.5 h-3.5 rounded border border-muted-foreground/30 flex items-center justify-center
              peer-checked:bg-primary peer-checked:border-primary transition-colors"
          >
            {#if isViewed}
              <Fa icon={faCheck} class="w-2! h-2! text-primary-foreground" />
            {/if}
          </span>
          <span class="text-xs text-subtle">Viewed</span>
        </label>
      </div>

    </div>

    <!-- Inline Diff (when expanded) - lazy loaded via Intersection Observer -->
    {#if expandedFiles.has(expandKey)}
      <div
        class="border-t border-border"
        transition:slide={{ axis: 'y', duration: 200 }}
        use:observeVisibility={expandKey}
      >
        {#if visibleFiles.has(expandKey)}
          {#if change.isMerged && change.allParts && change.allParts.length > 1}
            <!-- Merged change: show all parts with gutter indicators -->
            <CombinedInlineDiffItem
              parts={change.allParts}
              foldUnchanged={editorSettings.foldUnchanged}
              lineWrapping={editorSettings.lineWrapping}
              {isAggregate}
              onStageHunk={showStagingControls ? handleStageHunk : undefined}
              onUnstageHunk={showStagingControls ? handleUnstageHunk : undefined}
              onOpenCommit={handleOpenCommit}
            />
          {:else}
            <!-- Single change (only staged or only unstaged) -->
            {@const category = getChangeCategory(change)}
            <InlineDiffItem
              {change}
              foldUnchanged={editorSettings.foldUnchanged}
              lineWrapping={editorSettings.lineWrapping}
              scrollToLine={scrollTarget?.filePath === change.filePath
                ? scrollTarget.lineNumber
                : undefined}
              {isAggregate}
              onStageHunk={showStagingControls && category === 'unstaged'
                ? handleStageHunk
                : undefined}
              onUnstageHunk={showStagingControls && category === 'staged'
                ? handleUnstageHunk
                : undefined}
              onOpenCommit={category === 'committed' ? handleOpenCommit : undefined}
            />
          {/if}
        {:else}
          <!-- Placeholder while waiting for visibility -->
          <div class="flex items-center justify-center h-[300px] text-subtle">
            <Fa icon={faSpinner} class="animate-spin mr-2" />
            Loading diff...
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}
