<script module lang="ts">
  import type { ChangeCategory as _ChangeCategory, LocalFileChange as _LocalFileChange } from './types';

  type _NumstatEntry = { filePath: string; additions: number; deletions: number };

  /**
   * Get the category for a change, with consistent fallback logic.
   * Prioritizes explicit category, then derives from staged boolean.
   *
   * Exported from the module context so unit tests (and the instance script
   * below) can reuse the same classification without duplication.
   */
  export function getChangeCategory(change: _LocalFileChange): _ChangeCategory {
    if (change.category) return change.category;
    if (change.staged === true) return 'staged';
    return 'unstaged';
  }

  /**
   * Identify file paths that will render through UnifiedMultiStageDiff (i.e.
   * the `isMerged` branch of mergeChangesByFilePath). Mirrors the conditions
   * in mergeChangesByFilePath so fetchContent can guarantee these files are
   * enriched before mergedChanges is derived, regardless of
   * MAX_UPFRONT_FETCH_COUNT. Without this, over-cap merged files arrive at
   * UnifiedMultiStageDiff with no chunks/oldContent/newContent and render
   * "No changes to display" because no TrackedChangeDiffViewer is ever mounted
   * to self-fetch. See audit:
   * intent://local/note/83b58f2d-e095-4576-82b8-bb434a5f909f
   */
  export function computeMergedDestinedPaths(
    source: _LocalFileChange[],
    groupByCommitMode: boolean,
  ): Set<string> {
    const byPath = new Map<
      string,
      { hasStaged: boolean; hasUnstaged: boolean; committedCount: number }
    >();

    for (const change of source) {
      const category = getChangeCategory(change);
      const existing = byPath.get(change.filePath) || {
        hasStaged: false,
        hasUnstaged: false,
        committedCount: 0,
      };

      if (category === 'committed') {
        existing.committedCount++;
      } else if (category === 'staged') {
        existing.hasStaged = true;
      } else {
        existing.hasUnstaged = true;
      }

      byPath.set(change.filePath, existing);
    }

    const mergedPaths = new Set<string>();
    for (const [filePath, info] of byPath) {
      const hasNonCommittedParts = info.hasStaged || info.hasUnstaged;
      const totalParts =
        (info.hasStaged ? 1 : 0) + (info.hasUnstaged ? 1 : 0) + info.committedCount;

      // Mixed stages: staged/unstaged + anything else (matches mergeChangesByFilePath condition).
      if (hasNonCommittedParts && totalParts > 1) {
        mergedPaths.add(filePath);
        continue;
      }
      // Committed-only, combined mode, >1 commit.
      if (!hasNonCommittedParts && info.committedCount > 1 && !groupByCommitMode) {
        mergedPaths.add(filePath);
      }
    }

    return mergedPaths;
  }

  /**
   * Identify committed file groups that should be collapsed to a single
   * branch-base diff before renderer-side merging. Per-commit hunks use the
   * post-state of each commit, so multiple committed parts for the same file can
   * share line numbers that refer to different file states. By-commit mode keeps
   * the original per-commit entries intentionally.
   */
  export function computeBranchBaseCollapsedCommittedPaths(
    source: _LocalFileChange[],
    groupByCommitMode: boolean,
  ): Set<string> {
    if (groupByCommitMode) return new Set();

    const committedCounts = new Map<string, number>();
    for (const change of source) {
      if (getChangeCategory(change) !== 'committed') continue;
      committedCounts.set(change.filePath, (committedCounts.get(change.filePath) ?? 0) + 1);
    }

    const collapsed = new Set<string>();
    for (const [filePath, count] of committedCounts) {
      if (count > 1) collapsed.add(filePath);
    }
    return collapsed;
  }

  export function computeBranchBaseCommittedFallbacks(
    source: _LocalFileChange[],
    collapsedPaths: Set<string>,
  ): Map<string, _LocalFileChange[]> {
    const fallbackByPath = new Map<string, _LocalFileChange[]>();
    for (const change of source) {
      if (!collapsedPaths.has(change.filePath) || getChangeCategory(change) !== 'committed') {
        continue;
      }
      const fallbackChanges = fallbackByPath.get(change.filePath) ?? [];
      fallbackChanges.push(change);
      fallbackByPath.set(change.filePath, fallbackChanges);
    }
    return fallbackByPath;
  }

  function findNumstatForPath(
    statsByPath: Map<string, _NumstatEntry>,
    stats: _NumstatEntry[],
    filePath: string,
  ): _NumstatEntry | undefined {
    const exact = statsByPath.get(filePath);
    if (exact) return exact;

    const normalizedPath = filePath.replace(/^\/+/, '');
    return stats.find((stat) => {
      const statPath = stat.filePath.replace(/^\/+/, '');
      return normalizedPath.endsWith(`/${statPath}`) || statPath.endsWith(`/${normalizedPath}`);
    });
  }

  export function applyNumstatStats(
    source: _LocalFileChange[],
    localStats: _NumstatEntry[],
    committedStats: _NumstatEntry[] = [],
  ): _LocalFileChange[] {
    const localByPath = new Map(localStats.map((stat) => [stat.filePath, stat]));
    const committedByPath = new Map(committedStats.map((stat) => [stat.filePath, stat]));
    const consumedLocalStats = new Set<string>();
    const consumedCommittedStats = new Set<string>();

    return source.map((change) => {
      const category = getChangeCategory(change);
      const stats = category === 'committed' ? committedStats : localStats;
      const statsByPath = category === 'committed' ? committedByPath : localByPath;
      const stat = findNumstatForPath(statsByPath, stats, change.filePath);
      if (!stat) return change;
      const consumedStats = category === 'committed' ? consumedCommittedStats : consumedLocalStats;
      if (consumedStats.has(stat.filePath)) {
        if (change.additions === 0 && change.deletions === 0) return change;
        return { ...change, additions: 0, deletions: 0 };
      }
      consumedStats.add(stat.filePath);
      if (change.additions === stat.additions && change.deletions === stat.deletions) return change;
      return { ...change, additions: stat.additions, deletions: stat.deletions };
    });
  }
</script>

<script lang="ts">
/* eslint-disable max-lines */
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
    faArrowUpRightFromSquare,
    faPlus,
    faMinus,
    faRotateLeft,
    faSpinner,
    faCopy,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import InlineDiffItem from './InlineDiffItem.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { slide } from 'svelte/transition';
  import { untrack } from 'svelte';
  import { Virtualizer } from '@pierre/diffs';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { selectFoldUnchanged, selectLineWrapping } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import {
  } from '$lib/components/file-tracking/change-set-visualization';
  import {
    selectActiveWorkspace,
    selectActiveWorkspaceId,
  } from '$lib/store/slices/workspace/workspace-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import { selectCurrentCommits } from '$lib/store/slices/changes/changes-selectors';
  import {
    batchedGitBranchBaseDiff,
    batchedGitDiff,
    dedupedGitNumstat,
    dedupedShowFile,
  } from '$lib/components/ui/diff/diff-ipc-batcher';
  import { toast } from '$lib/components/ui/toast';
  import { type WorkspaceId } from '$shared/types/branded-ids';
  import { selectNoteById } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import CombinedInlineDiffItem from './CombinedInlineDiffItem.svelte';
  import { LOCKED_TOOLTIP } from '$lib/utils/agent-lock-utils';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { openWorkspaceCommitChangeset, openWorkspaceDiff, openWorkspaceFile } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
  import type { TrackedChange } from '$features/file-tracking/types';
  

import { selectViewedFiles } from '$lib/store/slices/transient-ui/transient-ui-selectors';
  import { setViewedFiles } from '$lib/store/slices/transient-ui/transient-ui-slice';

  const foldUnchanged = selectFoldUnchanged();
  const lineWrapping = selectLineWrapping();
  const activeWorkspace = selectActiveWorkspace();
  const activeWorkspaceId = selectActiveWorkspaceId();
  const agentFileRefreshes = selectAgentFileRefreshes(activeWorkspaceId);

  // Re-export types from types.ts for backward compatibility
  export type { ChangeCategory, LocalFileChange, DiffHunk } from './types';
  import type { ChangeCategory, LocalFileChange, DiffHunk } from './types';
  import { getDirectoryPath, getFileName, stripWorkspacePrefix, pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import { formatRelativeTime } from '$lib/utils/timeFormatting';
  import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { selectAgentFileRefreshes } from '$lib/store/slices/chat-changes/chat-changes-selectors';

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
    /** Branch base ref for collapsing multi-commit committed file groups */
    branchBaseRef?: string | null;
    /** Resolved branch boundary SHA for collapsing multi-commit committed file groups */
    branchBaseCommitSha?: string | null;
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
    branchBaseRef = null,
    branchBaseCommitSha = null,
  }: Props = $props();

  // Group-by-commit toggle state (default: combined view)
  let groupByCommit = $state(initialGroupByCommit);

  // File tracking state from Redux
  const ftCommits$ = selectCurrentCommits();

  // Helper to check if a file is locked
  function isFileLocked(filePath: string): boolean {
    return lockedFilePaths.has(filePath);
  }

  // Instance ID for debugging
  const instanceId = Math.random().toString(36).substring(2, 8);

  function getStoredViewedFilesRecord() {
    const workspaceId = $activeWorkspaceId;
    if (!workspaceId) return {};
    return selectViewedFiles.select(getReduxStore().getState(), workspaceId);
  }

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
    // Depend on mergedChanges and active workspace identity
    const currentMergedChanges = mergedChanges;
    const currentWorkspaceId = $activeWorkspaceId;

    if (!currentWorkspaceId || currentMergedChanges.length === 0) return;
    if (hasRestoredViewedFiles) return;

    const stored = getStoredViewedFilesRecord();
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

  // Reacts to the chat-changes saga's debounced agent-file-change refreshes.
  // The saga owns the IPC listener and per-(workspace, path) debounce; this
  // effect just translates per-path version increments into refreshFileDiff calls.
  $effect(() => {
    if (!showStagingControls) return;

    const wsId = $activeWorkspaceId;
    if (!wsId) return;

    if (lastSeenRefreshWorkspaceId !== wsId) {
      lastSeenVersionByPath.clear();
      lastSeenRefreshWorkspaceId = wsId;
    }

    for (const entry of $agentFileRefreshes) {
      const lastSeen = lastSeenVersionByPath.get(entry.path) ?? 0;
      if (entry.version <= lastSeen) continue;
      lastSeenVersionByPath.set(entry.path, entry.version);

      const matchingChange = untrack(() =>
        enrichedChanges.find((c) => filePathsMatch(entry.path, c.filePath)),
      );
      if (!matchingChange) continue;

      logger.debug('ChatChangesPanel: Agent file change detected', {
        changedPath: entry.path,
        matchingFilePath: matchingChange.filePath,
      });

      recentlyRefreshedFiles.set(matchingChange.filePath, Date.now());
      void refreshFileDiff(matchingChange.filePath);
    }
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


  // Get display path - convert absolute paths to relative by extracting just the relevant portion
  function getDisplayPath(filePath: string): string {
    // If it's a workspace-relative absolute path, extract the relative part
    // e.g., /Users/foo/intent/uuid/repo/src/file.ts -> src/file.ts
    const workspace = $activeWorkspace;
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
  let lastSeenVersionByPath = new Map<string, number>();
  let lastSeenRefreshWorkspaceId: string | null = null;

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
        return `${c.filePath}|${c.category || c.staged}|${c.commitHash || ''}`;
      })
      .sort()
      .join(';;');
  }

  function calculateDiffHunkStats(chunks: DiffHunk[] | undefined): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const hunk of chunks || []) {
      for (const line of hunk.lines || []) {
        if (line.type === 'Addition') additions++;
        else if (line.type === 'Deletion') deletions++;
      }
    }
    return { additions, deletions };
  }

  // Fetch diff content for all changes (both local and agent changes)
  $effect(() => {
    // Capture dependencies at the start
    const currentChanges = changes;
    const currentShowStagingControls = showStagingControls;
    const currentBranchBaseRef = branchBaseRef ?? undefined;
    const currentBranchBaseCommitSha = branchBaseCommitSha ?? undefined;
    const workspaceId = $activeWorkspaceId;

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
    const newChangesKey = `${currentBranchBaseRef ?? ''}|${currentBranchBaseCommitSha ?? ''}::${generateChangesKey(currentChanges)}`;
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

    // Fetch content for each file (limited to MAX_UPFRONT_FETCH_COUNT to prevent OOM).
    // Files beyond this limit will have their content fetched by TrackedChangeDiffViewer
    // when rendered. Wave 4: classify first, then fire all IPCs in parallel via the
    // batcher so same-tick requests coalesce into one `git:diff` per (workspace, staged)
    // group instead of N serial round-trips.
    const fetchContent = async () => {
      type PlanItem =
        | { kind: 'skip-refreshed' }
        | { kind: 'push-raw'; change: LocalFileChange }
        | { kind: 'fetch-committed'; change: LocalFileChange; commitHash: string }
        | {
            kind: 'fetch-branch-committed';
            change: LocalFileChange;
            baseRef?: string;
            baseCommitSha?: string;
            fallbackChanges: LocalFileChange[];
          }
        | { kind: 'fetch-local'; change: LocalFileChange; staged: boolean };

      const plan: PlanItem[] = [];
      let slotsUsed = 0;
      const fetchStart = performance.now();

      // Files destined for the UnifiedMultiStageDiff (`isMerged`) branch must
      // be enriched upfront: the merger runs before any TrackedChangeDiffViewer
      // is mounted, so the on-demand fetch that covers over-cap single-stage
      // files never runs for merged rows. Only relevant when the renderer
      // actually merges (i.e. showStagingControls === true — see mergedChanges
      // effect). Read groupByCommit via untrack so toggling grouping doesn't
      // re-trigger this effect. See audit:
      // intent://local/note/83b58f2d-e095-4576-82b8-bb434a5f909f
      const currentGroupByCommit = untrack(() => groupByCommit);
      const mergedDestinedPaths = currentShowStagingControls
        ? computeMergedDestinedPaths(currentChanges, currentGroupByCommit)
        : new Set<string>();
      const branchBaseCollapsedCommittedPaths =
        currentShowStagingControls && (currentBranchBaseRef || currentBranchBaseCommitSha)
          ? computeBranchBaseCollapsedCommittedPaths(currentChanges, currentGroupByCommit)
          : new Set<string>();
      const branchBaseCommittedFallbacks = computeBranchBaseCommittedFallbacks(
        currentChanges,
        branchBaseCollapsedCommittedPaths,
      );
      const plannedBranchBaseCommittedPaths = new Set<string>();

      for (const change of currentChanges) {
        if (!currentShowStagingControls) {
          // For agent changes:
          // - Per-turn views (isAggregate=false): use snippet content directly.
          //   The snippet oldContent/newContent accurately represents what this turn changed.
          // - Aggregate views: handled separately by the gitDiffChanges effect
          //   which fetches git:diff to get the cumulative changes.
          //
          // We do NOT fetch fullFileContent for per-turn views because:
          // 1. The current file reflects ALL changes from ALL turns.
          // 2. We only want to show what THIS turn changed.
          plan.push({ kind: 'push-raw', change });
          continue;
        }

        // Skip files that were recently refreshed via refreshFileDiff.
        // We'll add our local entries for these files at the end.
        if (recentlyRefreshedFilePaths.has(change.filePath)) {
          plan.push({ kind: 'skip-refreshed' });
          continue;
        }

        const category = getChangeCategory(change);
        const commitHash = change.commitHash;

        if (category === 'committed' && branchBaseCollapsedCommittedPaths.has(change.filePath)) {
          if (plannedBranchBaseCommittedPaths.has(change.filePath)) {
            continue;
          }
          plannedBranchBaseCommittedPaths.add(change.filePath);
          plan.push({
            kind: 'fetch-branch-committed',
            change,
            baseRef: currentBranchBaseRef,
            baseCommitSha: currentBranchBaseCommitSha,
            fallbackChanges: branchBaseCommittedFallbacks.get(change.filePath) ?? [change],
          });
          continue;
        }

        const mustEnrich = mergedDestinedPaths.has(change.filePath);

        // If we've hit the upfront limit, add the change without content
        // (will be fetched on-demand by TrackedChangeDiffViewer via the batcher).
        // Merged-destined files bypass the cap — they never reach
        // TrackedChangeDiffViewer and must be enriched here.
        if (!mustEnrich && slotsUsed >= MAX_UPFRONT_FETCH_COUNT) {
          plan.push({ kind: 'push-raw', change });
          continue;
        }

        // Merged-destined files are mandatory enrichments and do not count
        // toward the single-stage cap — otherwise a burst of merged rows could
        // starve single-stage files of their slots.
        if (category === 'committed' && commitHash) {
          plan.push({
            kind: 'fetch-committed',
            change,
            commitHash: String(commitHash),
          });
          if (!mustEnrich) slotsUsed++;
          continue;
        }

        // Already-enriched local change: keep chunks, no IPC needed.
        if (change.chunks && change.chunks.length > 0) {
          plan.push({ kind: 'push-raw', change });
          if (!mustEnrich) slotsUsed++;
          continue;
        }

        plan.push({
          kind: 'fetch-local',
          change,
          staged: change.staged === true,
        });
        if (!mustEnrich) slotsUsed++;
      }

      // Fire every IPC in parallel. `batchedGitDiff` coalesces same-tick requests
      // that share (workspaceId, staged) into a single `git:diff` call, so up to
      // `MAX_UPFRONT_FETCH_COUNT` local files collapse into at most 2 IPC calls
      // (one staged, one unstaged). `dedupedShowFile` dedupes concurrent calls
      // for the same (workspace, ref, path).
      const localNumstatPromise = currentShowStagingControls
        ? dedupedGitNumstat(workspaceId).catch((error) => {
            logger.warn('[fetchContent] Failed to fetch local numstat', { error });
            return [];
          })
        : Promise.resolve([]);
      const committedNumstatPromise =
        currentShowStagingControls &&
        !currentGroupByCommit &&
        (currentBranchBaseRef || currentBranchBaseCommitSha)
          ? dedupedGitNumstat(workspaceId, {
              baseRef: currentBranchBaseRef,
              baseCommitSha: currentBranchBaseCommitSha,
              targetRef: 'HEAD',
            }).catch((error) => {
              logger.warn('[fetchContent] Failed to fetch branch-base numstat', { error });
              return [];
            })
          : Promise.resolve([]);
      const resolved = await Promise.all(
        plan.map((item) => {
          if (item.kind === 'fetch-committed') {
            return Promise.all([
              dedupedShowFile(workspaceId, item.commitHash, item.change.filePath),
              dedupedShowFile(workspaceId, `${item.commitHash}^`, item.change.filePath),
            ])
              .then(([newRes, oldRes]) => ({ item, newRes, oldRes }))
              .catch((error) => {
                logger.warn('[fetchContent] Failed to fetch committed content', {
                  filePath: item.change.filePath,
                  error,
                });
                return { item, newRes: undefined, oldRes: undefined };
              });
          }
          if (item.kind === 'fetch-branch-committed') {
            return batchedGitBranchBaseDiff(
              workspaceId,
              { baseRef: item.baseRef, baseCommitSha: item.baseCommitSha },
              item.change.filePath,
            )
              .then((chunk) => ({ item, chunk }))
              .catch((error) => {
                logger.warn('[fetchContent] Failed to fetch branch-base committed diff', {
                  filePath: item.change.filePath,
                  error,
                });
                return { item, chunk: undefined };
              });
          }
          if (item.kind === 'fetch-local') {
            return batchedGitDiff(workspaceId, item.staged, item.change.filePath)
              .then((chunk) => ({ item, chunk }))
              .catch((error) => {
                logger.warn('[fetchContent] Failed to fetch local diff', {
                  filePath: item.change.filePath,
                  error,
                });
                return { item, chunk: undefined };
              });
          }
          return Promise.resolve({ item });
        }),
      );

      // Check cancellation after all fetches settle.
      if (thisVersion !== fetchVersion) return;

      const enriched: LocalFileChange[] = [];
      for (const result of resolved) {
        const { item } = result;
        if (item.kind === 'skip-refreshed') continue;

        if (item.kind === 'push-raw') {
          enriched.push(item.change);
          continue;
        }

        if (item.kind === 'fetch-committed') {
          const { newRes, oldRes } = result as {
            item: typeof item;
            newRes?: { success: boolean; data?: string };
            oldRes?: { success: boolean; data?: string };
          };
          const newContent = newRes?.success ? newRes.data || '' : '';
          const oldContent = oldRes?.success ? oldRes.data || '' : '';
          enriched.push({
            ...item.change,
            oldContent,
            newContent,
            // Mark as full file content so diff viewer knows it can use git:show-file to refresh
            isFullFileContent: true,
          });
          continue;
        }

        if (item.kind === 'fetch-branch-committed') {
          const { chunk } = result as {
            item: Extract<PlanItem, { kind: 'fetch-branch-committed' }>;
            chunk?: { oldContent?: string; newContent?: string; chunks?: unknown[] };
          };
          if (chunk) {
            const chunks = chunk.chunks as DiffHunk[] | undefined;
            const stats = calculateDiffHunkStats(chunks);
            enriched.push({
              ...item.change,
              additions: stats.additions,
              deletions: stats.deletions,
              oldContent: chunk.oldContent || '',
              newContent: chunk.newContent || '',
              chunks,
              // Mark as full file content so diff viewer can render the collapsed branch diff directly.
              isFullFileContent: true,
            });
          } else {
            enriched.push(...item.fallbackChanges);
          }
          continue;
        }

        if (item.kind === 'fetch-local') {
          const { chunk } = result as {
            item: typeof item;
            chunk?: {
              oldContent?: string;
              newContent?: string;
              chunks?: unknown[];
            };
          };
          if (chunk) {
            enriched.push({
              ...item.change,
              oldContent: chunk.oldContent || '',
              newContent: chunk.newContent || '',
              chunks: chunk.chunks as DiffHunk[] | undefined,
              // Mark as full file content so diff viewer knows it can use git:diff to refresh
              isFullFileContent: true,
            });
          } else {
            enriched.push(item.change);
          }
        }
      }

      // Add back the locally refreshed entries that we captured at the start of the effect.
      // This ensures we use our local data for recently refreshed files instead of stale parent data.
      enriched.push(...localEntriesForRefreshedFiles);

      // Only update if this is still the current fetch.
      if (thisVersion === fetchVersion) {
        const [localStats, committedStats] = await Promise.all([
          localNumstatPromise,
          committedNumstatPromise,
        ]);
        if (thisVersion !== fetchVersion) return;

        enrichedChanges = applyNumstatStats(enriched, localStats, committedStats);
        isEnrichingChanges = false;
        logger.debug('[ChatChangesPanel:fetchContent] batched fetch complete', {
          files: currentChanges.length,
          fetchedLocal: plan.filter((p) => p.kind === 'fetch-local').length,
          fetchedCommitted: plan.filter((p) => p.kind === 'fetch-committed').length,
          fetchedBranchCommitted: plan.filter((p) => p.kind === 'fetch-branch-committed').length,
          skippedRefreshed: plan.filter((p) => p.kind === 'skip-refreshed').length,
          elapsedMs: Math.round(performance.now() - fetchStart),
        });
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

    const workspaceId = $activeWorkspaceId;
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

    // Fetch git diff for each file. Wave 4: use `batchedGitDiff` so same-tick
    // requests for (workspaceId, staged=false) collapse into one IPC instead of N.
    const fetchGitDiffs = async () => {
      const fetchStart = performance.now();
      const chunks = await Promise.all(
        reactiveChanges.map((change) =>
          batchedGitDiff(workspaceId, false, change.filePath).catch((error) => {
            logger.warn('Failed to fetch git diff', { filePath: change.filePath, error });
            return undefined;
          }),
        ),
      );

      const results: LocalFileChange[] = reactiveChanges.map((change, i) => {
        const diffChunk = chunks[i];
        if (diffChunk && diffChunk.oldContent !== undefined && diffChunk.newContent !== undefined) {
          // Use git diff content with proper full file content
          return {
            ...change,
            oldContent: diffChunk.oldContent,
            newContent: diffChunk.newContent,
            // Pass chunks for proper line-by-line diff visualization
            chunks: diffChunk.chunks as DiffHunk[] | undefined,
            // Mark as full file content so diff viewer knows it can use git:diff to refresh
            isFullFileContent: true,
          } as LocalFileChange;
        }
        return change;
      });

      gitDiffChanges = results;
      logger.debug('[ChatChangesPanel:fetchGitDiffs] batched aggregate fetch complete', {
        files: reactiveChanges.length,
        elapsedMs: Math.round(performance.now() - fetchStart),
      });
    };

    fetchGitDiffs();
  });

  // Use git diff changes for visualization when aggregate, otherwise use merged changes


  // File-count threshold above which we DO NOT auto-expand all files on
  // initial load. The user's explicit "expand all" header button still works.
  // Prevents scheduling N placeholder IOs + a cascade of diff mounts in one
  // frame when the workspace has dozens of changed files.
  const AUTO_EXPAND_THRESHOLD = 30;

  // When the change set exceeds AUTO_EXPAND_THRESHOLD and the user has no
  // explicit preference, expand this many leading files so the panel still
  // shows diffs on load instead of feeling empty.
  const AUTO_EXPAND_INITIAL_COUNT = 10;

  // Track expanded state for each file - start EXPANDED by default for better UX
  // Performance is handled by lazy-loading DiffViewers via Intersection Observer
  let expandedFiles = $state<Set<string>>(new Set());

  // Track user's expansion preference: 'expanded' = all files expanded, 'collapsed' = all files collapsed
  // null means use default behavior (expand when below AUTO_EXPAND_THRESHOLD)
  // This preference is preserved when switching between commits/changesets
  let userExpansionPreference = $state<'expanded' | 'collapsed' | null>(null);

  // Track which files have been scrolled into view (for lazy loading DiffViewers)
  // Once a file becomes visible, we keep the DiffViewer mounted to avoid re-init on scroll back
  let visibleFiles = $state<Set<string>>(new Set());

  // Track which files the user has marked as "viewed" (like GitHub PR reviews)
  let viewedFiles = $state<Set<string>>(new Set());
  let viewedCount = $derived(viewedFiles.size);
  let totalFileCount = $derived(new Set(mergedChanges.map((c) => c.filePath)).size);

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
    const allCommits = $ftCommits$ || [];

    for (const change of mergedChanges) {
      if (change.commitHash) {
        const idx = seen.get(change.commitHash);
        if (idx !== undefined) {
          groups[idx].changes.push(change);
        } else {
          // Look up full commit info from Redux file tracking state
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
      // Auto-expand guardrail: opening "all changes" with many files used to
      // auto-expand every row, scheduling N placeholder IOs + a cascade of
      // diff mounts in the same frame. When the count exceeds the threshold
      // and the user hasn't opted in, expand only the first few files so
      // there's something to look at — the header expand-all button still
      // works and individual files can be opened.
      if (preference === 'collapsed') {
        // Keep all files collapsed
        expandedFiles = new Set();
        visibleFiles = new Set();
      } else {
        // In by-commit mode, only consider files belonging to expanded commit groups
        const currentExpandedCommits = untrack(() => expandedCommits);
        const inScopeChanges =
          groupByCommit && currentExpandedCommits.size > 0
            ? mergedChanges.filter(
                (c) => c.commitHash && currentExpandedCommits.has(c.commitHash),
              )
            : mergedChanges;

        const shouldExpandAll =
          preference === 'expanded' ||
          (preference == null && currentKeys.size <= AUTO_EXPAND_THRESHOLD);

        if (shouldExpandAll) {
          expandedFiles = new Set(inScopeChanges.map((c) => getExpandKey(c)));
        } else {
          // preference == null && currentKeys.size > AUTO_EXPAND_THRESHOLD:
          // partial-expand the leading files so the panel isn't empty on load.
          // Files marked viewed stay collapsed.
          const currentViewed = untrack(() => viewedFiles);
          const partialKeys = new Set<string>();
          for (const change of inScopeChanges) {
            if (partialKeys.size >= AUTO_EXPAND_INITIAL_COUNT) break;
            if (currentViewed.has(change.filePath)) continue;
            partialKeys.add(getExpandKey(change));
          }
          expandedFiles = partialKeys;
        }
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
        // Generous margin so slow scrolls never show a loading flash.
        // Wave 3: this is now the ONLY IntersectionObserver between the
        // panel and TrackedChangeDiffViewer — InlineDiffItem's inner IO
        // has been removed to avoid redundant visibility gating.
        rootMargin: '400px',
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
    const wsId = $activeWorkspaceId;
    if (!wsId) return;
    const category = change ? getChangeCategory(change) : undefined;
    const diffChange = change
      ? {
          id: `chat-change-${filePath}`,
          file: filePath,
          relativePath: filePath,
          type: 'modified' as const,
          // Use the staged property from the change object if available
          stage:
            category === 'committed'
              ? ('committed' as const)
              : change.staged
                ? ('staged' as const)
                : ('unstaged' as const),
          stats: change
            ? { additions: change.additions, deletions: change.deletions }
            : { additions: 0, deletions: 0 },
          attribution: {
            manual: true,
            timestamp: Date.now(),
          },
          // Don't pass content - let DiffViewer fetch git diff for accurate display
        }
      : undefined;
    if (!diffChange) return;
    getReduxStore().dispatch(
      openWorkspaceDiff(wsId, diffChange as unknown as TrackedChange, {
        changeId: `chat-change-${filePath}`,
        filePath,
        openInAdjacentPanel,
        sourcePanelId,
        branchBaseRef: branchBaseRef ?? undefined,
        branchBaseCommitSha: branchBaseCommitSha ?? undefined,
      }),
    );
  }

  function openFile(filePath: string, event?: MouseEvent) {
    const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
    const panelElement = event?.target
      ? (event.target as HTMLElement)?.closest('[data-panel-id]')
      : null;
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const wsId = $activeWorkspaceId;
    if (!wsId) return;
    getReduxStore().dispatch(
      openWorkspaceFile(wsId, filePath, { openInAdjacentPanel, sourcePanelId }),
    );
  }

  // Refresh diff for a single file after staging/unstaging
  // This is more performant than refreshing all file tracking data
  async function refreshFileDiff(filePath: string) {
    const workspaceId = $activeWorkspaceId;
    if (!workspaceId) return;

    // Track that this file is being refreshed (for loading indicator)
    refreshingFiles = new Set([...refreshingFiles, filePath]);

    try {
      // Mark this file as recently refreshed IMMEDIATELY (before async operations)
      // This prevents the $effect from using stale parent data while we're fetching new data
      // The file tracking refresh may complete before our fetch does, and we need the
      // effect to skip this file and wait for our fresh data
      recentlyRefreshedFiles.set(filePath, Date.now());

      // Fetch both staged and unstaged diffs for this file. Wave 4: route through
      // `batchedGitDiff` so concurrent refreshes for different files on the same
      // tick coalesce into one IPC per staging group.
      const [stagedChunk, unstagedChunk] = await Promise.all([
        batchedGitDiff(workspaceId, true, filePath).catch(() => undefined),
        batchedGitDiff(workspaceId, false, filePath).catch(() => undefined),
      ]);

      const hasStagedChanges =
        !!stagedChunk && (((stagedChunk.chunks as DiffHunk[] | undefined)?.length) ?? 0) > 0;
      const hasUnstagedChanges =
        !!unstagedChunk && (((unstagedChunk.chunks as DiffHunk[] | undefined)?.length) ?? 0) > 0;

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

      if (hasUnstagedChanges && unstagedChunk) {
        const unstagedChunks = unstagedChunk.chunks as DiffHunk[] | undefined;
        const stats = calculateStats(unstagedChunks);
        // Find existing unstaged entry to preserve toolName, toolCallId, action
        const existingUnstaged = existingEntries.find((e) => !e.staged);
        newEntries.push({
          filePath,
          additions: stats.additions,
          deletions: stats.deletions,
          staged: false,
          category: 'unstaged' as ChangeCategory,
          oldContent: unstagedChunk.oldContent || '',
          newContent: unstagedChunk.newContent || '',
          chunks: unstagedChunks,
          // Mark as full file content so diff viewer knows it can use git:diff to refresh
          isFullFileContent: true,
          // Preserve required fields from existing entry or use defaults
          action: existingUnstaged?.action || 'modify',
          toolName: existingUnstaged?.toolName || 'git',
          toolCallId: existingUnstaged?.toolCallId || `local-${filePath}-unstaged`,
        });
      }

      if (hasStagedChanges && stagedChunk) {
        const stagedChunks = stagedChunk.chunks as DiffHunk[] | undefined;
        const stats = calculateStats(stagedChunks);
        // Find existing staged entry to preserve toolName, toolCallId, action
        const existingStaged = existingEntries.find((e) => e.staged);
        newEntries.push({
          filePath,
          additions: stats.additions,
          deletions: stats.deletions,
          staged: true,
          category: 'staged' as ChangeCategory,
          oldContent: stagedChunk.oldContent || '',
          newContent: stagedChunk.newContent || '',
          chunks: stagedChunks,
          // Mark as full file content so diff viewer knows it can use git:diff to refresh
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
    const workspaceId = $activeWorkspaceId;
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

    const result = await gitClient.stageHunk(workspaceId as WorkspaceId, filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk staged');
      gitCache.invalidateWorkspace(workspaceId);
      getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      // Performant update: only refresh the affected file's diff
      await refreshFileDiff(filePath);
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
    const workspaceId = $activeWorkspaceId;
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

    const result = await gitClient.unstageHunk(workspaceId as WorkspaceId, filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk unstaged');
      gitCache.invalidateWorkspace(workspaceId);
      getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      // Performant update: only refresh the affected file's diff
      await refreshFileDiff(filePath);
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
    const wsId = $activeWorkspaceId;
    if (!wsId) return;
    getReduxStore().dispatch(openWorkspaceCommitChangeset(wsId, commitHash));
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
    if ($activeWorkspaceId) {
      const newStoredViewed: Record<string, string> = {};
      for (const fp of newViewed) {
        newStoredViewed[fp] = getCommitFingerprint(fp);
      }
      getReduxStore().dispatch(setViewedFiles($activeWorkspaceId, newStoredViewed));
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let allExpanded = $derived(
    mergedChanges.length > 0 &&
      mergedChanges
        .filter((c) => !viewedFiles.has(c.filePath))
        .every((c) => expandedFiles.has(getExpandKey(c))),
  );

  // Track which file/line to scroll to in the diff viewer
  let scrollTarget = $state<{ filePath: string; lineNumber: number } | null>(null);

  // Reference to scroll container for preserving scroll position
  let scrollContainerRef: HTMLElement | null = $state(null);

  // Wave 5a: Single pierre `Virtualizer` instance scoped to this panel's
  // scroll container. `VirtualizedFileDiff` (inside each `DiffViewer`)
  // connects to it so off-screen files collapse to height-preserving
  // placeholders, keeping live hunk DOM bounded to O(viewport) rather
  // than growing linearly with `expandedFiles.size`.
  //
  // The outer 400 px `observeVisibility` gate below is preserved — it
  // still decides *when* to fetch per-file content (IPC) and mount the
  // underlying `DiffViewer`. Once mounted, the virtualizer takes over
  // fine-grained real-DOM vs placeholder management inside that file.
  let virtualizerContentRef: HTMLDivElement | null = $state(null);
  let virtualizer = $state<Virtualizer | undefined>(undefined);

  $effect(() => {
    const scrollRoot = scrollContainerRef;
    const content = virtualizerContentRef;
    if (!scrollRoot || !content) return;

    const instance = new Virtualizer();
    instance.setup(scrollRoot, content);
    virtualizer = instance;

    return () => {
      instance.cleanUp();
      if (virtualizer === instance) virtualizer = undefined;
    };
  });

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
    const workspace = $activeWorkspace;
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
    const workspace = $activeWorkspace;
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
  <div class="h-full overflow-auto p-5 pt-0" bind:this={scrollContainerRef}>
    <!--
      Single content wrapper for the pierre Virtualizer's `resizeObserver`.
      All diff rows must live inside this wrapper so the virtualizer can
      measure total content height and reconcile visible instances.
    -->
    <div bind:this={virtualizerContentRef}>
    <!-- Commit Details Section -->
    {#if commitInfo}
      {@render commitDetailsSection()}
    {/if}

    <!-- File List with Inline Diffs -->
    {#if showLoadingState}
      <!-- Skeleton loader for file changes -->
      <div class="flex flex-col gap-3 py-6">
        {#each Array(4) as _}
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
      <!-- Sticky summary bar: "N files changed" -->
      <div class="sticky top-0 z-20 -mx-5 px-5">
        <div class="flex items-center justify-between py-2 bg-background/95 backdrop-blur-sm border-b border-border">
          <span class="text-xs font-medium text-subtle whitespace-nowrap">
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
      </div>
      <div class="flex flex-col gap-2 py-6">
        {#if groupByCommit && commitGroups}
          <!-- Group-by-commit mode: render changes grouped under commit headers -->
          {#each commitGroups as group, i (group.hash || 'working-' + i)}
            {#if group.hash}
              <!-- Commit group with sticky collapsible header -->
              <div class="mb-2">
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
    </div><!-- /virtualizerContentRef -->
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
              {@const ccpState = getReduxStore().getState()}
              {@const currentWsId = selectActiveWorkspaceId.select(ccpState)}
              {@const agentSession = displayAgentId && currentWsId
                ? selectAgentById.select(ccpState, displayAgentId)
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
              {@const linkedNote = selectNoteById.select(getReduxStore().getState(), $activeWorkspaceId ?? '', commitInfo.linkedNoteId)}
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
              foldUnchanged={$foldUnchanged}
              lineWrapping={$lineWrapping}
              {isAggregate}
              onStageHunk={showStagingControls ? handleStageHunk : undefined}
              onUnstageHunk={showStagingControls ? handleUnstageHunk : undefined}
              onOpenCommit={handleOpenCommit}
              {virtualizer}
            />
          {:else}
            <!-- Single change (only staged or only unstaged) -->
            {@const category = getChangeCategory(change)}
            <InlineDiffItem
              {change}
              foldUnchanged={$foldUnchanged}
              lineWrapping={$lineWrapping}
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
              {virtualizer}
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
