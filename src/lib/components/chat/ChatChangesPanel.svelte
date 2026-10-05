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

  import { getChangeCategory, isPathLocked } from './chat-changes-enrichment';
  import { canOpenAgentPath } from './agent-path-actions';
  import Fa from 'svelte-fa';

  import {
    faChevronDown,
    faChevronLeft,
    faCodeCompare,
    faArrowUpRightFromSquare,
    faPlus,
    faMinus,
    faRotateLeft,
    faLock,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import InlineDiffItem from './InlineDiffItem.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { safeDisclosureTransition } from './disclosure-motion';
  import { onDestroy, tick, untrack } from 'svelte';
  import { Virtualizer } from '@pierre/diffs';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import {
    selectFoldUnchanged,
    selectLineWrapping,
  } from '$store/renderer/slices/ui-layout/ui-layout-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectCurrentCommits } from '$store/renderer/slices/changes/changes-selectors';
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import CombinedInlineDiffItem from './CombinedInlineDiffItem.svelte';
  import { getLockedTooltip } from '$lib/utils/agent-lock-utils';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  import {
    openWorkspaceCommitChangeset,
    openWorkspaceDiff,
    openWorkspaceFile,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import type { TrackedChange } from '$features/file-tracking/types';

  import { selectViewedFiles } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { setViewedFiles } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { selectLockedFilePaths } from '$store/renderer/slices/agent-lock/agent-lock-selectors';

  const routeWorkspaceId = getWorkspaceRouteContext()?.workspaceId ?? '';
  const foldUnchanged = selectFoldUnchanged();
  const lineWrapping = selectLineWrapping();
  const workspace$ = selectWorkspaceById(routeWorkspaceId);
  const lockedFilePaths$ = selectLockedFilePaths(routeWorkspaceId);

  // Re-export types from types.ts for backward compatibility
  export type { ChangeCategory, LocalFileChange, DiffHunk } from './types';
  import type { ChangeCategory, LocalFileChange } from './types';
  import { getDirectoryPath, getFileName, stripWorkspacePrefix } from '$lib/utils/file-utils';
  import { formatRelativeTime } from '$lib/utils/timeFormatting';

  import {
    selectChatChanges,
    selectChatChangesConsumer,
    selectChatChangesRefreshingPaths,
  } from '$store/renderer/slices/chat-changes/chat-changes-selectors';
  import {
    chatChangesInputChanged,
    chatChangesConsumerReleased,
    chatChangesHunkRequested,
  } from '$store/renderer/slices/chat-changes/chat-changes-slice';
  import { getSelectedTextWithinSurface } from '$lib/utils/selected-text';
  import { store as appStore } from '$store/renderer/store';

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
    /**
     * Secondary git root scoping the committed-content fetches (multi git
     * root tracking, §5.6). Absent → primary-root behavior, byte-identical.
     */
    gitRootId?: string;
    /**
     * The secondary root's canonical path — forwarded to the per-file diff
     * viewers so absolute paths resolve against the root, not the worktree.
     */
    gitRootPath?: string;
  }

  let {
    changes,
    agentId = null,
    isAggregate: isAggregateProp = false,
    onOpenAgent,
    showStagingControls: showStagingControlsProp = false,
    showCategoryFilter = false,
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
    gitRootId = undefined,
    gitRootPath = undefined,
  }: Props = $props();

  const agentSession$ = $derived(selectAgentSession(agentId ?? ''));
  const nodeOwnedPaths = $derived(
    !!agentId && (!$agentSession$ || hasNodeOwnedAgentPath($agentSession$)),
  );
  const showStagingControls = $derived(showStagingControlsProp && !nodeOwnedPaths);
  const isAggregate = $derived(isAggregateProp && !nodeOwnedPaths);
  const offlineNode = $derived(nodeOwnedPaths && $agentSession$?.nodeState === 'offline');

  // Group-by-commit toggle state (default: combined view)
  // svelte-ignore state_referenced_locally -- initial-value prop seeds the local toggle; later changes are user-driven.
  let groupByCommit = $state(initialGroupByCommit);

  // File tracking state from Redux
  const ftCommits$ = selectCurrentCommits(routeWorkspaceId);

  // Helper to check if a file is locked (agent auto-commit pending). Locked
  // paths come from the agent-lock slice (PROTOCOL §5.19 / §6.5) repo-relative,
  // while change paths here may be absolute — isPathLocked matches both forms.
  function isFileLocked(filePath: string): boolean {
    const workspace = $workspace$;
    const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;
    return isPathLocked($lockedFilePaths$, filePath, workspacePath);
  }

  const consumerId = crypto.randomUUID();
  const consumer$ = selectChatChangesConsumer(routeWorkspaceId, consumerId);
  const changes$ = selectChatChanges(routeWorkspaceId, consumerId);
  const refreshingPaths$ = selectChatChangesRefreshingPaths(routeWorkspaceId, consumerId);
  const enrichedChanges = $derived(nodeOwnedPaths ? changes : $changes$);
  const isEnrichingChanges = $derived($consumer$?.status === 'pending');
  const refreshingFiles = $derived(new Set($refreshingPaths$));

  // Bind view inputs to the root-owned domain owner; no reads or promises live here.
  $effect(() => {
    appStore.dispatch(
      chatChangesInputChanged(routeWorkspaceId, consumerId, crypto.randomUUID(), {
        changes,
        agentId,
        showStagingControls,
        isAggregate,
        groupByCommit,
        nodeOwnedPaths,
        branchBaseRef: branchBaseRef ?? undefined,
        branchBaseCommitSha: branchBaseCommitSha ?? undefined,
        gitRootId,
        gitRootPath,
      }),
    );
  });
  onDestroy(() => appStore.dispatch(chatChangesConsumerReleased(routeWorkspaceId, consumerId)));

  function getStoredViewedFilesRecord() {
    if (!routeWorkspaceId) return {};
    return selectViewedFiles.select(appStore.state, routeWorkspaceId);
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
    // Depend on mergedChanges and the immutable route workspace identity
    const currentMergedChanges = mergedChanges;
    const currentWorkspaceId = routeWorkspaceId;

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
    const workspace = $workspace$;
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
    const newKey =
      `gbc:${groupByCommit}::` +
      sorted
        .map((c) => {
          // Gitlink pin SHAs are part of the key: a pin-to-pin move keeps the
          // same stats (1 addition + 1 deletion), so without them the stale
          // entry would be retained (#1739).
          const gitlinkKey = c.gitlink
            ? `|gl:${c.gitlink.oldSha || ''}:${c.gitlink.newSha || ''}`
            : '';
          const baseKey = `${c.filePath}|${c.category || c.staged}|${c.isMerged || false}|${c.additions || 0}|${c.deletions || 0}${gitlinkKey}`;
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

    if (!nodeOwnedPaths && newKey === lastMergedChangesKey) {
      return; // Skip update - data hasn't changed
    }
    lastMergedChangesKey = newKey;
    mergedChanges = sorted;
  });

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
  let totalAdditions = $derived(mergedChanges.reduce((sum, c) => sum + (c.additions ?? 0), 0));
  let totalDeletions = $derived(mergedChanges.reduce((sum, c) => sum + (c.deletions ?? 0), 0));

  // Whether any committed changes exist (for showing the group-by-commit toggle)
  let hasCommittedChanges = $derived(changes.some((c) => getChangeCategory(c) === 'committed'));

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
          groups.push({
            hash: '',
            message: m.chat_changesPanel_workingChanges_label(),
            changes: [change],
          });
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
            ? mergedChanges.filter((c) => c.commitHash && currentExpandedCommits.has(c.commitHash))
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
    if (nodeOwnedPaths) return;
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
    const wsId = routeWorkspaceId;
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
    appStore.dispatch(
      openWorkspaceDiff(wsId, diffChange as unknown as TrackedChange, {
        changeId: `chat-change-${filePath}`,
        filePath,
        openInAdjacentPanel,
        sourcePanelId,
        branchBaseRef: branchBaseRef ?? undefined,
        branchBaseCommitSha: branchBaseCommitSha ?? undefined,
        gitRootId,
        gitRootPath,
      }),
    );
  }

  function openFile(filePath: string, event?: MouseEvent) {
    if (nodeOwnedPaths) return;
    const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
    const panelElement = event?.target
      ? (event.target as HTMLElement)?.closest('[data-panel-id]')
      : null;
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const wsId = routeWorkspaceId;
    if (!wsId) return;
    appStore.dispatch(openWorkspaceFile(wsId, filePath, { openInAdjacentPanel, sourcePanelId }));
  }

  // Only DOM scroll state stays local; mutation completion comes from the owner.
  let pendingHunkScroll: { requestId: string; top: number } | undefined;
  function requestHunk(kind: 'stageHunk' | 'unstageHunk', filePath: string, hunkPatch: string) {
    const requestId = crypto.randomUUID();
    pendingHunkScroll = { requestId, top: scrollContainerRef?.scrollTop ?? 0 };
    appStore.dispatch(
      chatChangesHunkRequested(routeWorkspaceId, consumerId, requestId, kind, filePath, hunkPatch),
    );
  }
  function handleStageHunk(filePath: string, hunkPatch: string) {
    requestHunk('stageHunk', filePath, hunkPatch);
  }
  function handleUnstageHunk(filePath: string, hunkPatch: string) {
    requestHunk('unstageHunk', filePath, hunkPatch);
  }
  $effect(() => {
    const completed = $consumer$?.completedMutationRequestId;
    if (!pendingHunkScroll || pendingHunkScroll.requestId !== completed) return;
    const top = pendingHunkScroll.top;
    pendingHunkScroll = undefined;
    const frame = requestAnimationFrame(() => {
      if (scrollContainerRef) scrollContainerRef.scrollTop = top;
    });
    return () => cancelAnimationFrame(frame);
  });

  // Handle opening a commit changeset view
  function handleOpenCommit(commitHash: string) {
    const wsId = routeWorkspaceId;
    if (!wsId) return;
    appStore.dispatch(
      openWorkspaceCommitChangeset(
        wsId,
        commitHash,
        undefined,
        gitRootId ? { gitRootId } : undefined,
      ),
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

  const VIEWED_COLLAPSE_SCROLL_SETTLE_MS = 230;

  function getRenderedFileExpandKeys(): string[] {
    if (groupByCommit && commitGroups) {
      const keys: string[] = [];
      for (const group of commitGroups) {
        if (group.hash && !expandedCommits.has(group.hash)) continue;
        keys.push(...group.changes.map((change) => getExpandKey(change)));
      }
      return keys;
    }

    return mergedChanges.map((change) => getExpandKey(change));
  }

  function getViewedScrollTargetExpandKey(expandKey: string): string {
    const renderedKeys = getRenderedFileExpandKeys();
    const currentIndex = renderedKeys.indexOf(expandKey);
    return currentIndex >= 0 ? (renderedKeys[currentIndex + 1] ?? expandKey) : expandKey;
  }

  function findFileHeader(expandKey: string): HTMLElement | null {
    const content = virtualizerContentRef;
    if (!content) return null;

    for (const header of content.querySelectorAll<HTMLElement>('[data-change-header-key]')) {
      if (header.dataset.changeHeaderKey === expandKey) return header;
    }
    return null;
  }

  function scrollFileHeaderIntoView(expandKey: string) {
    const container = scrollContainerRef;
    const header = findFileHeader(expandKey);
    if (!container || !header) return;

    const containerRect = container.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const stickyTop = Number.parseFloat(header.dataset.changeStickyTop ?? '0') || 0;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextScrollTop = container.scrollTop + headerRect.top - containerRect.top - stickyTop;

    container.scrollTo({
      top: Math.min(maxScrollTop, Math.max(0, nextScrollTop)),
      behavior: 'auto',
    });
  }

  function scheduleViewedCollapseScroll(expandKey: string) {
    const targetExpandKey = getViewedScrollTargetExpandKey(expandKey);

    void tick().then(() => {
      requestAnimationFrame(() => {
        scrollFileHeaderIntoView(targetExpandKey);
        window.setTimeout(() => {
          scrollFileHeaderIntoView(targetExpandKey);
        }, VIEWED_COLLAPSE_SCROLL_SETTLE_MS);
      });
    });
  }

  // Toggle a file's "viewed" state (like GitHub PR review checkboxes)
  // viewedFiles always stores file paths (not expand keys) for consistency
  // across combined and by-commit modes.
  function toggleViewed(filePath: string, expandKey: string) {
    const newViewed = new Set(viewedFiles);
    const newExpanded = new Set(expandedFiles);
    const wasViewed = newViewed.has(filePath);
    const shouldScrollAfterMarkViewed = !wasViewed && newExpanded.has(expandKey);

    if (wasViewed) {
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

    if (shouldScrollAfterMarkViewed) {
      scheduleViewedCollapseScroll(expandKey);
    }

    // Persist to transient store
    if (routeWorkspaceId) {
      const newStoredViewed: Record<string, string> = {};
      for (const fp of newViewed) {
        newStoredViewed[fp] = getCommitFingerprint(fp);
      }
      appStore.dispatch(setViewedFiles(routeWorkspaceId, newStoredViewed));
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

  let panelRootRef: HTMLDivElement | null = $state(null);

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

  type AllChangesSearchResult = { element: HTMLElement; headerKey?: string };
  type SearchTextSegment = { text: string; isMatch: boolean };

  const ALL_CHANGES_SEARCH_CONTENT_SELECTOR = [
    '[data-column-content]',
    '[data-content] [data-line]',
    '[data-content] [data-no-newline]',
    'pre [data-line]',
  ].join(',');
  const ALL_CHANGES_SEARCH_HIGHLIGHT_BACKGROUND = 'rgba(255, 213, 0, 0.4)';
  const ALL_CHANGES_SEARCH_CURRENT_BACKGROUND = 'rgba(59, 130, 246, 0.5)';
  const ALL_CHANGES_SEARCH_SCROLL_MARGIN_PX = 16;
  const ALL_CHANGES_SEARCH_DEBOUNCE_MS = 150;

  let allChangesSearchOpen = $state(false);
  let allChangesSearchQuery = $state('');
  let allChangesSearchResults = $state<AllChangesSearchResult[]>([]);
  let allChangesSearchIndex = $state(0);
  let allChangesSearchInputRef: HTMLInputElement | null = $state(null);
  let allChangesSearchHeaderMatchKeys = $state<Set<string>>(new Set());
  let allChangesSearchCurrentHeaderKey = $state<string | null>(null);
  let allChangesSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let allChangesSearchRenderKey = $derived.by(() => {
    const renderedKeys =
      groupByCommit && commitGroups
        ? commitGroups
            .filter((group) => !group.hash || expandedCommits.has(group.hash))
            .flatMap((group) => group.changes.map((change) => getExpandKey(change)))
        : mergedChanges.map((change) => getExpandKey(change));

    return [
      groupByCommit ? 'grouped' : 'combined',
      renderedKeys.join('|'),
      [...expandedFiles].join('|'),
      [...visibleFiles].join('|'),
    ].join('::');
  });

  function getAllChangesSearchRoots(): ParentNode[] {
    const content = virtualizerContentRef;
    if (!content) return [];

    return Array.from(content.querySelectorAll('diffs-container'))
      .map((diffsContainer) => diffsContainer.shadowRoot)
      .filter((root): root is ShadowRoot => root != null);
  }

  function openAllChangesSearchFromSelection() {
    const selectedText = getSelectedTextWithinSurface(panelRootRef, {
      extraRoots: getAllChangesSearchRoots(),
    });

    if (selectedText) {
      allChangesSearchQuery = selectedText;
      allChangesSearchIndex = 0;
    }

    allChangesSearchOpen = true;
    void tick().then(() => {
      allChangesSearchInputRef?.focus();
      allChangesSearchInputRef?.select();
    });
  }

  function closeAllChangesSearch() {
    cancelAllChangesSearchDebounce();
    allChangesSearchOpen = false;
    allChangesSearchQuery = '';
    resetAllChangesSearchState();
  }

  function resetAllChangesSearchState() {
    clearAllChangesSearchHighlights();
    allChangesSearchResults = [];
    allChangesSearchIndex = 0;
    allChangesSearchHeaderMatchKeys = new Set();
    allChangesSearchCurrentHeaderKey = null;
  }

  function cancelAllChangesSearchDebounce() {
    if (allChangesSearchDebounceTimer !== null) {
      clearTimeout(allChangesSearchDebounceTimer);
      allChangesSearchDebounceTimer = null;
    }
  }

  function scheduleAllChangesSearch(query: string) {
    cancelAllChangesSearchDebounce();
    allChangesSearchIndex = 0;

    if (!allChangesSearchOpen || !query.trim()) {
      resetAllChangesSearchState();
      return;
    }

    allChangesSearchDebounceTimer = setTimeout(() => {
      allChangesSearchDebounceTimer = null;
      if (allChangesSearchOpen && allChangesSearchQuery.trim()) {
        performAllChangesSearch(allChangesSearchQuery);
      }
    }, ALL_CHANGES_SEARCH_DEBOUNCE_MS);
  }

  onDestroy(cancelAllChangesSearchDebounce);

  function clearAllChangesSearchHighlights() {
    const roots = getAllChangesSearchRoots();
    for (const root of roots) {
      root.querySelectorAll('.all-changes-search-highlight').forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        parent.normalize();
      });
    }
  }

  function performAllChangesSearch(query: string) {
    clearAllChangesSearchHighlights();
    allChangesSearchResults = [];
    allChangesSearchHeaderMatchKeys = new Set();
    allChangesSearchCurrentHeaderKey = null;
    allChangesSearchIndex = 0;

    const normalizedQuery = query.trim();
    const content = virtualizerContentRef;
    if (!normalizedQuery || !content) return;

    const results: AllChangesSearchResult[] = [];
    const headerMatchKeys = new Set<string>();
    const lowerQuery = normalizedQuery.toLowerCase();

    content.querySelectorAll<HTMLElement>('[data-change-card-key]').forEach((card) => {
      const header = card.querySelector<HTMLElement>('[data-change-header-key]');
      const headerKey = header?.dataset.changeHeaderKey;
      const headerText = header?.dataset.changeSearchText ?? '';
      if (header && headerKey && hasVisibleAllChangesHeaderMatch(headerText, lowerQuery)) {
        headerMatchKeys.add(headerKey);
        results.push({ element: header, headerKey });
      }

      card.querySelectorAll('diffs-container').forEach((diffsContainer) => {
        const searchRoot = diffsContainer.shadowRoot;
        if (!searchRoot) return;

        getAllChangesSearchContentElements(searchRoot).forEach((el) => {
          highlightAllChangesSearchText(el, normalizedQuery);
        });

        searchRoot.querySelectorAll<HTMLElement>('.all-changes-search-highlight').forEach((el) => {
          if (isRenderedAllChangesSearchElement(el)) results.push({ element: el });
        });
      });
    });

    allChangesSearchHeaderMatchKeys = headerMatchKeys;
    allChangesSearchResults = results;
    if (results.length > 0) navigateToAllChangesSearchResult(0);
  }

  function getAllChangesSearchContentElements(searchRoot: ParentNode): HTMLElement[] {
    const candidates = Array.from(
      searchRoot.querySelectorAll<HTMLElement>(ALL_CHANGES_SEARCH_CONTENT_SELECTOR),
    );
    const elements: HTMLElement[] = [];

    for (const candidate of candidates) {
      if (elements.some((element) => element.contains(candidate))) continue;
      elements.push(candidate);
    }

    return elements;
  }

  function highlightAllChangesSearchText(element: HTMLElement, query: string) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const segments: { node: Text; start: number; end: number }[] = [];
    const lowerQuery = query.toLowerCase();
    let fullText = '';

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || '';
      segments.push({ node, start: fullText.length, end: fullText.length + text.length });
      fullText += text;
    }

    const lowerText = fullText.toLowerCase();
    const matches: { start: number; end: number }[] = [];
    let index = 0;

    while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
      matches.push({ start: index, end: index + query.length });
      index += query.length;
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const start = getAllChangesSearchTextPosition(segments, matches[i].start, false);
      const end = getAllChangesSearchTextPosition(segments, matches[i].end, true);
      if (!start || !end) continue;

      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const span = document.createElement('span');
      span.className = 'all-changes-search-highlight';
      span.style.backgroundColor = ALL_CHANGES_SEARCH_HIGHLIGHT_BACKGROUND;
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
  }

  function getAllChangesSearchTextPosition(
    segments: { node: Text; start: number; end: number }[],
    offset: number,
    preferPrevious: boolean,
  ): { node: Text; offset: number } | null {
    const orderedSegments = preferPrevious ? [...segments].reverse() : segments;
    for (const segment of orderedSegments) {
      const withinSegment = preferPrevious
        ? offset > segment.start && offset <= segment.end
        : offset >= segment.start && offset < segment.end;
      if (withinSegment) return { node: segment.node, offset: offset - segment.start };
    }
    return null;
  }

  function isRenderedAllChangesSearchElement(element: HTMLElement): boolean {
    return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
  }

  function navigateToAllChangesSearchResult(index: number) {
    if (allChangesSearchResults.length === 0) return;

    allChangesSearchResults.forEach((result) => {
      result.element.classList.remove('all-changes-search-current');
      if (!result.headerKey) {
        result.element.style.backgroundColor = ALL_CHANGES_SEARCH_HIGHLIGHT_BACKGROUND;
      }
    });

    if (index < 0) index = allChangesSearchResults.length - 1;
    if (index >= allChangesSearchResults.length) index = 0;

    allChangesSearchIndex = index;
    const result = allChangesSearchResults[index];
    allChangesSearchCurrentHeaderKey = result.headerKey ?? null;
    result.element.classList.add('all-changes-search-current');
    if (!result.headerKey) {
      result.element.style.backgroundColor = ALL_CHANGES_SEARCH_CURRENT_BACKGROUND;
    }
    scrollAllChangesSearchResultIntoView(result.element);
  }

  function scrollAllChangesSearchResultIntoView(element: HTMLElement) {
    const container = scrollContainerRef;
    if (!container) {
      element.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return;
    }
    scrollAllChangesSearchElementIntoContainer(element, container);
  }

  function scrollAllChangesSearchElementIntoContainer(
    element: HTMLElement,
    container: HTMLElement,
  ) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const targetTop = elementRect.top - containerRect.top + container.scrollTop;
    const targetLeft = elementRect.left - containerRect.left + container.scrollLeft;
    const nextTop = Math.max(0, targetTop - container.clientHeight / 2 + elementRect.height / 2);
    let nextLeft = container.scrollLeft;

    if (elementRect.left < containerRect.left + ALL_CHANGES_SEARCH_SCROLL_MARGIN_PX) {
      nextLeft = Math.max(0, targetLeft - ALL_CHANGES_SEARCH_SCROLL_MARGIN_PX);
    } else if (elementRect.right > containerRect.right - ALL_CHANGES_SEARCH_SCROLL_MARGIN_PX) {
      nextLeft = Math.max(
        0,
        targetLeft -
          container.clientWidth +
          elementRect.width +
          ALL_CHANGES_SEARCH_SCROLL_MARGIN_PX,
      );
    }

    container.scrollTo({ top: nextTop, left: nextLeft, behavior: 'smooth' });
  }

  function getAllChangesHighlightedTextSegments(text: string): SearchTextSegment[] {
    const query = allChangesSearchOpen ? allChangesSearchQuery.trim() : '';
    if (!query) return [{ text, isMatch: false }];

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const segments: SearchTextSegment[] = [];
    let cursor = 0;
    let index = 0;

    while ((index = lowerText.indexOf(lowerQuery, cursor)) !== -1) {
      if (index > cursor) segments.push({ text: text.slice(cursor, index), isMatch: false });
      segments.push({ text: text.slice(index, index + query.length), isMatch: true });
      cursor = index + query.length;
    }

    if (cursor < text.length) segments.push({ text: text.slice(cursor), isMatch: false });
    return segments.length > 0 ? segments : [{ text, isMatch: false }];
  }

  function hasVisibleAllChangesHeaderMatch(displayPath: string, lowerQuery: string): boolean {
    return [getFileName(displayPath), getDirectoryPath(displayPath)]
      .filter(Boolean)
      .some((segment) => segment.toLowerCase().includes(lowerQuery));
  }

  function isNodeInAllChangesPanel(node: Node | null): boolean {
    if (!panelRootRef || !node) return false;
    if (panelRootRef.contains(node)) return true;

    const root = node.getRootNode();
    return root instanceof ShadowRoot && panelRootRef.contains(root.host);
  }

  function shouldHandleAllChangesFindShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false;
    if (
      event.composedPath().some((node) => node instanceof Node && isNodeInAllChangesPanel(node))
    ) {
      return true;
    }
    return isNodeInAllChangesPanel(document.activeElement);
  }

  function handleAllChangesGlobalKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      if (shouldHandleAllChangesFindShortcut(event)) {
        event.preventDefault();
        openAllChangesSearchFromSelection();
      }
      return;
    }

    if (
      allChangesSearchOpen &&
      event.key === 'Escape' &&
      shouldHandleAllChangesFindShortcut(event)
    ) {
      event.preventDefault();
      closeAllChangesSearch();
    }
  }

  function handleAllChangesSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'F3' || (event.key === 'g' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      if (event.shiftKey) navigateToAllChangesSearchResult(allChangesSearchIndex - 1);
      else navigateToAllChangesSearchResult(allChangesSearchIndex + 1);
    }
  }

  function handlePanelPointerDown(event: PointerEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, textarea, select, a, [contenteditable="true"], diffs-container',
      )
    ) {
      return;
    }
    panelRootRef?.focus({ preventScroll: true });
  }

  let allChangesSearchRunVersion = 0;
  $effect(() => {
    const isOpen = allChangesSearchOpen;
    const query = allChangesSearchQuery;
    // Reference renderKey in the tracked scope so Svelte subscribes to it.
    const _renderKey = allChangesSearchRenderKey;

    untrack(() => {
      if (!isOpen || !query.trim()) {
        allChangesSearchRunVersion++;
        cancelAllChangesSearchDebounce();
        resetAllChangesSearchState();
        return;
      }

      const version = ++allChangesSearchRunVersion;
      void tick().then(() => {
        if (version !== allChangesSearchRunVersion) return;
        scheduleAllChangesSearch(query);
      });
    });
  });

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
    const workspace = $workspace$;
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
    const workspace = $workspace$;
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

  // Get author initials for avatar fallback
  function getAuthorInitials(name?: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name[0]?.toUpperCase() || '?';
  }
</script>

<svelte:window onkeydown={handleAllChangesGlobalKeydown} />

<!-- header is managed by panel tab bar -->
<div
  bind:this={panelRootRef}
  class="h-full w-full flex flex-col overflow-hidden relative"
  tabindex="-1"
  onpointerdown={handlePanelPointerDown}
>
  {#if offlineNode}
    <p class="px-5 py-2 text-xs text-muted-foreground" role="status">
      {$agentSession$?.checkpoint
        ? m.agent_node_checkpoint_available({ time: $agentSession$.checkpoint.capturedAt })
        : m.agent_node_checkpoint_unavailable()}
      {m.agent_node_transcript_diff_notice()}
    </p>
  {/if}
  {#if allChangesSearchOpen}
    <PanelFindBar
      bind:query={allChangesSearchQuery}
      bind:inputRef={allChangesSearchInputRef}
      placeholder={m.chat_changesPanel_findInChanges_placeholder()}
      currentMatchIndex={allChangesSearchIndex}
      totalMatches={allChangesSearchResults.length}
      emptyResultText="No results"
      resultVariant="muted"
      inputClass="w-48"
      onKeydown={handleAllChangesSearchKeydown}
      onPrevious={() => navigateToAllChangesSearchResult(allChangesSearchIndex - 1)}
      onNext={() => navigateToAllChangesSearchResult(allChangesSearchIndex + 1)}
      onClose={closeAllChangesSearch}
    />
  {/if}

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
        <div class="flex h-full items-center justify-start py-6 text-left text-subtle">
          {m.chat_changesPanel_noChanges_label()}
        </div>
      {:else}
        <!-- Sticky summary bar: "N files changed" -->
        <div class="sticky top-0 z-20 -mx-5 px-5">
          <div class="flex items-center justify-between py-2 bg-background border-b border-border">
            <div
              class="flex items-center justify-start gap-1.5 whitespace-nowrap text-left text-xs font-medium text-subtle"
            >
              <span
                >{totalFileCount === 1
                  ? m.chat_changesPanel_filesChanged_one({ count: formatInteger(totalFileCount) })
                  : m.chat_changesPanel_filesChanged_many({
                      count: formatInteger(totalFileCount),
                    })}</span
              >
              <LineChangesBadge
                additions={totalAdditions}
                deletions={totalDeletions}
                size="xs"
                class="opacity-80"
              />
              {#if groupByCommit && commitCount > 0}
                <span
                  >{commitCount === 1
                    ? m.chat_changesPanel_commitCount_one({ count: formatInteger(commitCount) })
                    : m.chat_changesPanel_commitCount_many({
                        count: formatInteger(commitCount),
                      })}</span
                >
              {/if}
              {#if viewedCount > 0}
                <span class="text-subtle">·</span>
                <span
                  >{m.chat_changesPanel_viewedCount_label({
                    count: formatInteger(viewedCount),
                  })}</span
                >
              {/if}
            </div>
            <div class="flex items-center gap-2">
              {#if hasCommittedChanges && !commitInfo}
                <div
                  class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 -my-1"
                >
                  <Button
                    type="button"
                    variant="plain"
                    class="px-2 py-0.5 text-xs rounded cursor-pointer transition-colors {!groupByCommit
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (groupByCommit = false)}
                  >
                    {m.chat_changesPanel_combined_label()}
                  </Button>
                  <Button
                    type="button"
                    variant="plain"
                    class="px-2 py-0.5 text-xs rounded cursor-pointer transition-colors {groupByCommit
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (groupByCommit = true)}
                  >
                    {m.chat_changesPanel_byCommit_label()}
                  </Button>
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
                {@const groupAuthorLogin = getGitHubUsername(group.authorEmail)}
                <!-- Commit group with sticky collapsible header -->
                <div class="mb-2">
                  <div class="sticky top-[31.5px] z-[11] bg-background rounded-md">
                    <div class="flex items-center gap-2 w-full px-3 py-2 rounded-md bg-muted/30">
                      <Button
                        type="button"
                        variant="plain"
                        class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                        onclick={() => toggleCommitGroup(group.hash)}
                      >
                        <Fa
                          icon={expandedCommits.has(group.hash) ? faChevronDown : faChevronLeft}
                          class="text-subtle w-2.5! h-2.5! shrink-0"
                        />
                        <!-- Author avatar -->
                        <div
                          class="shrink-0 w-5 h-5 rounded-full bg-muted-foreground/15 flex items-center justify-center text-ui font-medium text-subtle select-none overflow-hidden"
                          title={group.author || ''}
                        >
                          {#if groupAuthorLogin}
                            <GitHubAvatar
                              identity={groupAuthorLogin}
                              alt={group.author || ''}
                              size={20}
                              class="w-full h-full object-cover"
                            >
                              {#snippet fallback()}
                                {getAuthorInitials(group.author)}
                              {/snippet}
                            </GitHubAvatar>
                          {:else}
                            {getAuthorInitials(group.author)}
                          {/if}
                        </div>
                        <span class="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                          {group.message.split('\n')[0]}
                        </span>
                      </Button>
                      <span class="text-ui text-subtle shrink-0 flex items-center gap-1.5">
                        {#if group.date}
                          <span>{formatRelativeTime(group.date)}</span>
                          <span class="text-ghost">·</span>
                        {/if}
                        <span
                          >{group.changes.length === 1
                            ? m.chat_changesPanel_fileCount_one({
                                count: formatInteger(group.changes.length),
                              })
                            : m.chat_changesPanel_fileCount_many({
                                count: formatInteger(group.changes.length),
                              })}</span
                        >
                      </span>
                      <Button
                        type="button"
                        variant="ghost-light"
                        size="icon-xs"
                        iconOnly
                        class="text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                        onclick={() => handleOpenCommit(group.hash)}
                        title={m.chat_changesPanel_openCommit_title()}
                      >
                        <Fa icon={faArrowUpRightFromSquare} class="w-2.5 h-2.5" />
                      </Button>
                    </div>
                  </div>
                  {#if expandedCommits.has(group.hash)}
                    <div
                      class="flex flex-col gap-2 mt-2 mx-2"
                      transition:safeDisclosureTransition={{ tier: 'fast' }}
                    >
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
    <!-- /virtualizerContentRef -->
  </div>
</div>

{#snippet commitDetailsSection()}
  {@const commitAuthorLogin = getGitHubUsername(commitInfo?.authorEmail)}
  <div class="mb-3">
    <div class="flex items-center gap-2.5 py-2">
      <div class="flex-1 min-w-0 space-y-1">
        <!-- Commit title — clickable if GitHub URL available -->
        {#if hasCommitUrl()}
          <Button
            type="button"
            variant="link"
            class="h-auto justify-start px-0 text-sm font-medium text-foreground hover:text-accent-foreground hover:underline underline-offset-2 text-left cursor-pointer transition-colors leading-snug"
            onclick={openCommitInBrowser}
            title={m.chat_changesPanel_openOnGitHub_title()}
          >
            {commitInfo?.message?.split('\n')[0] || m.chat_changesPanel_untitledCommit_fallback()}
            <Fa icon={faArrowUpRightFromSquare} class="inline-block w-2.5 h-2.5 ml-1 opacity-40" />
          </Button>
        {:else}
          <p class="text-sm font-medium text-foreground leading-snug">
            {commitInfo?.message?.split('\n')[0] || m.chat_changesPanel_untitledCommit_fallback()}
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
            <span class="inline-flex items-center gap-0.5 font-mono">
              {commitInfo.hash.substring(0, 7)}
              <CopyButton
                text={commitInfo.hash}
                label={m.chat_changesPanel_copyFullSha_title()}
                class="size-5 text-muted-foreground"
              />
            </span>
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
              {@const ccpState = appStore.state}
              {@const currentWsId = routeWorkspaceId}
              {@const agentSession =
                displayAgentId && currentWsId
                  ? selectAgentSession.select(ccpState, displayAgentId)
                  : undefined}
              {@const agentName =
                agentSession?.name && agentSession.name !== 'New Workspace Agent'
                  ? agentSession.name
                  : m.chat_shared_agentName_fallback()}
              <Button
                type="button"
                variant="plain"
                class="flex items-center gap-1 text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-w-0"
                onclick={(e) => handleOpenAgentFromCommit(e)}
                title={m.chat_changesPanel_openAgent_title()}
              >
                <span class="shrink-0">
                  <AgentAvatar agentId={displayAgentId ?? undefined} size={14} />
                </span>
                <span class="truncate">{agentName}</span>
              </Button>
            {/if}
            {#if commitInfo?.linkedNoteId && onOpenNote}
              {@const linkedNote = selectNoteById.select(
                appStore.state,
                routeWorkspaceId,
                commitInfo.linkedNoteId,
              )}
              {@const noteName = linkedNote?.title || m.chat_changesPanel_note_fallback()}
              <Button
                type="button"
                variant="plain"
                class="flex items-center gap-1 text-ui text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-w-0"
                onclick={(e) => onOpenNote?.(commitInfo?.linkedNoteId!, e)}
                title={m.chat_changesPanel_openLinkedNote_title()}
              >
                <Fa icon={faNote} class="w-2.5 h-2.5 shrink-0" />
                <span class="truncate">{noteName}</span>
              </Button>
            {/if}
          </div>
        {/if}
      </div>
      <!-- Author avatar (GitHub image with initials fallback) -->
      <div
        class="shrink-0 w-7 h-7 rounded-full bg-muted-foreground/15 flex items-center justify-center text-ui font-medium text-subtle select-none overflow-hidden"
        title={commitInfo?.author || ''}
      >
        {#if commitAuthorLogin}
          <GitHubAvatar
            identity={commitAuthorLogin}
            alt={commitInfo?.author || ''}
            size={28}
            class="w-full h-full object-cover"
          >
            {#snippet fallback()}
              {getAuthorInitials(commitInfo?.author)}
            {/snippet}
          </GitHubAvatar>
        {:else}
          {getAuthorInitials(commitInfo?.author)}
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet fileCard(change: LocalFileChange, inCommitGroup?: boolean)}
  {@const displayPath = getDisplayPath(change.filePath)}
  {@const expandKey = getExpandKey(change)}
  {@const isViewed = viewedFiles.has(change.filePath)}
  {@const locked = isFileLocked(change.filePath)}
  {@const stickyTop = inCommitGroup ? '64px' : '31.5px'}
  <div
    class="mb-4 bg-sidebar border border-border rounded-lg overflow-clip transition-all duration-spring-slow ease-spring-slow motion-reduce:transition-none {isViewed
      ? 'opacity-50'
      : ''}"
    style="overflow-anchor: none;"
    data-change-card-key={expandKey}
  >
    <!-- File Header (sticky within scroll container) -->
    <div
      class="flex items-center gap-2 px-0 py-1.5 group relative sticky z-10 bg-sidebar {allChangesSearchHeaderMatchKeys.has(
        expandKey,
      )
        ? 'ring-1 ring-warning/30 bg-warning/10'
        : ''} {allChangesSearchCurrentHeaderKey === expandKey
        ? 'ring-2 ring-blue-400/70 bg-blue-500/10'
        : ''}"
      style="top: {stickyTop}; border-bottom: 1px solid {expandedFiles.has(expandKey)
        ? 'var(--border)'
        : 'transparent'}"
      data-change-header-key={expandKey}
      data-change-sticky-top={stickyTop}
      data-change-search-text={displayPath}
    >
      <Button
        variant="plain"
        onclick={() => toggleFile(expandKey)}
        class="flex min-w-0 flex-1 shrink cursor-pointer items-center justify-start gap-2 text-left"
      >
        <span class="text-sm truncate shrink-0 max-w-full" title={displayPath}>
          {#each getAllChangesHighlightedTextSegments(getFileName(displayPath)) as segment, i (i)}
            {#if segment.isMatch}
              <mark class="rounded-sm bg-warning/10 px-0.5 text-foreground">{segment.text}</mark>
            {:else}
              {segment.text}
            {/if}
          {/each}
        </span>
        <Fa
          icon={expandedFiles.has(expandKey) ? faChevronDown : faChevronLeft}
          class="text-subtle w-2.5! h-2.5! shrink-0"
        />

        {#if getDirectoryPath(displayPath)}
          <span class="text-xs text-subtle truncate hidden sm:inline shrink-6">
            {#each getAllChangesHighlightedTextSegments(getDirectoryPath(displayPath)) as segment, i (i)}
              {#if segment.isMatch}
                <mark class="rounded-sm bg-warning/10 px-0.5 text-foreground">{segment.text}</mark>
              {:else}
                {segment.text}
              {/if}
            {/each}
          </span>
        {/if}
        <LineChangesBadge additions={change.additions} deletions={change.deletions} size="xs" />
        <!-- Lock indicator: an agent's auto-commit is pending for this file -->
        {#if locked}
          <span role="img" aria-label={getLockedTooltip()} title={getLockedTooltip()}>
            <Fa icon={faLock} class="w-2.5 h-2.5 text-subtle shrink-0" />
          </span>
        {/if}
        <!-- Loading indicator when file is being refreshed -->
        {#if refreshingFiles.has(change.filePath)}
          <IntentMarkLoader size={12} class="text-ghost shrink-0" />
        {/if}
      </Button>

      <!-- Action buttons -->
      <div class="absolute right-2 flex items-center gap-px">
        <div
          class="flex items-center gap-px bg-background opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {#if showStagingControls}
            <!-- Staging controls for merged changes (both staged and unstaged) -->
            {#if change.isMerged}
              <Button
                variant="ghost-light"
                size="icon-xs"
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_stageUnstaged_tooltip()}
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
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_unstageStaged_tooltip()}
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
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_revertUnstaged_tooltip()}
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
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_unstageFile_tooltip()}
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
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_stageFile_tooltip()}
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
                tooltip={locked ? getLockedTooltip() : m.chat_changesPanel_revertChanges_tooltip()}
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
            disabled={nodeOwnedPaths}
            tooltip={m.chat_changesPanel_viewCurrentDiff_tooltip()}
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
            disabled={nodeOwnedPaths}
            tooltip={m.chat_changesPanel_openFile_tooltip()}
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
          title={isViewed
            ? m.chat_changesPanel_markNotViewed_title()
            : m.chat_changesPanel_markViewed_title()}
          onclick={(e: MouseEvent) => e.stopPropagation()}
        >
          <Checkbox
            checked={isViewed}
            onCheckedChange={() => toggleViewed(change.filePath, expandKey)}
            size="sm"
            ariaLabel={isViewed
              ? m.chat_changesPanel_markNotViewed_title()
              : m.chat_changesPanel_markViewed_title()}
          />
          <span class="text-xs text-subtle">{m.chat_changesPanel_viewed_label()}</span>
        </label>
      </div>
    </div>

    <!-- Inline Diff (when expanded) - lazy loaded via Intersection Observer -->
    {#if expandedFiles.has(expandKey)}
      <div
        class="border-t border-border"
        transition:safeDisclosureTransition={{ tier: 'moderate' }}
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
              onStageHunk={showStagingControls && !locked ? handleStageHunk : undefined}
              onUnstageHunk={showStagingControls && !locked ? handleUnstageHunk : undefined}
              onOpenCommit={handleOpenCommit}
              {virtualizer}
            />
          {:else}
            <!-- Single change (only staged or only unstaged) -->
            {@const category = getChangeCategory(change)}
            <InlineDiffItem
              allowHeadReads={!nodeOwnedPaths}
              canReadHeadFiles={() => canOpenAgentPath(appStore.state, agentId)}
              {change}
              foldUnchanged={$foldUnchanged}
              lineWrapping={$lineWrapping}
              scrollToLine={scrollTarget?.filePath === change.filePath
                ? scrollTarget?.lineNumber
                : undefined}
              {isAggregate}
              onStageHunk={showStagingControls && !locked && category === 'unstaged'
                ? handleStageHunk
                : undefined}
              onUnstageHunk={showStagingControls && !locked && category === 'staged'
                ? handleUnstageHunk
                : undefined}
              onOpenCommit={category === 'committed' ? handleOpenCommit : undefined}
              {virtualizer}
              {gitRootId}
              {gitRootPath}
            />
          {/if}
        {:else}
          <!-- Placeholder while waiting for visibility -->
          <div class="flex h-[300px] items-center justify-start text-left text-subtle">
            <IntentMarkLoader size={16} class="mr-2" />
            {m.chat_changesPanel_loadingDiff_label()}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}
