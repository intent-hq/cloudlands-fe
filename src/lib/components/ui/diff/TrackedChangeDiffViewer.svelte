<script lang="ts">
/* eslint-disable max-lines */
  /**
   * TrackedChangeDiffViewer - Diff viewer for TrackedChange objects with hunk staging
   *
   * This component wraps the pure DiffViewer and handles:
   * - Loading diff content via IPC (git:diff, git:show-file)
   * - Hunk staging/unstaging with hover actions in the gutter
   * - Real-time updates when file content changes
   */
  import {
  onMount,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';
  import { invoke } from '$lib/electron-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectOriginalFileContent } from '$lib/store/slices/files/files-selectors';
  import { loadFileContentRequested } from '$lib/store/slices/files/files-slice';
  import type { FileReadResponse } from '$lib/store/slices/files/files-types';
  import {
  selectActiveWorkspace,
  selectActiveWorkspaceId,
} from '$lib/store/slices/workspace/workspace-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import type { TrackedChange } from '$features/file-tracking/types';
  import DiffViewer from './DiffViewer.svelte';
  import type { LineStageIndicator, PureDiffLineAnnotation } from './types';
  import {
  batchedGitBranchBaseDiff,
  batchedGitDiff,
  dedupedShowFile,
} from './diff-ipc-batcher';
  import { hashContent } from './DiffViewer.svelte';
  import * as Diff from 'diff';
  import { getChangedLineNumbersFromContent } from './line-staging';
  import Fa from 'svelte-fa';
  import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { track } from '$lib/services/analytics';

  const logger = createLogger('TrackedChangeDiffViewer');
  const MAX_CONTENT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

  interface Props {
    change: TrackedChange;
    workspaceId?: string;
    viewMode?: 'unified' | 'split';
    showHeader?: boolean;
    /** When true, unchanged regions are collapsed/folded */
    foldUnchanged?: boolean;
    /** When true, long lines wrap instead of scrolling */
    lineWrapping?: boolean;
    /** Callback when user wants to stage a hunk */
    onStageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to unstage a hunk */
    onUnstageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to open a commit changeset */
    onOpenCommit?: (commitHash: string) => void;
    /** Optional refresh key to force reload */
    refreshKey?: number;
    /** Branch base ref for aggregate committed branch diffs */
    branchBaseRef?: string;
    /** Resolved branch boundary SHA for aggregate committed branch diffs */
    branchBaseCommitSha?: string;
    /** When true, use provided content from change.content instead of fetching from git */
    useProvidedContent?: boolean;
    /**
     * Starting line number for partial/snippet diffs (1-based). When > 1,
     * blank lines are prepended so real file line numbers are rendered in the gutter.
     */
    lineOffset?: number;
    /** Per-line stage indicators for multi-stage diffs */
    lineStageIndicators?: LineStageIndicator[];
    /** Line annotations for custom per-line content */
    annotations?: PureDiffLineAnnotation<any>[];
    /** Custom render function for annotations */
    renderAnnotation?: (annotation: PureDiffLineAnnotation<any>) => HTMLElement | undefined;
    /**
     * Optional pierre `Virtualizer`. When supplied, the underlying `DiffViewer`
     * instantiates a `VirtualizedFileDiff` so off-screen diffs collapse to
     * height-preserving placeholders. Used by multi-file lists like
     * `ChatChangesPanel`; single-diff callsites leave this unset.
     */
    virtualizer?: import('@pierre/diffs').Virtualizer;
  }

  let {
    change,
    workspaceId,
    viewMode = 'unified',
    showHeader = false,
    foldUnchanged = true,
    lineWrapping = false,
    onStageHunk,
    onUnstageHunk,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onOpenCommit,
    refreshKey,
    branchBaseRef,
    branchBaseCommitSha,
    useProvidedContent = false,
    lineOffset = 1,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lineStageIndicators,
    annotations = [],
    renderAnnotation,
    virtualizer,
  }: Props = $props();

  // Unique instance ID for debugging
  const instanceId = Math.random().toString(36).substring(2, 8);

  // State
  let loading = $state(true);
  let error: string | null = $state(null);
  let oldContent = $state('');
  let newContent = $state('');
  let resolvedFilePath = $state(''); // The actual relative path used for git operations
  let contentTooLarge = $state(false);
  let noChangesAtStage = $state(false);
  let lastRefreshKey = $state<number | undefined>(undefined);
  // Track the last change identity to prevent effect loops
  let lastChangeId = $state<string | undefined>(undefined);
  let lastChangeFile = $state<string | undefined>(undefined);
  // Guard against duplicate loadDiffContent calls
  let isLoadingDiff = $state(false);

  // For partial/snippet diffs, prepend blank lines so pierre's gutter shows
  // real file line numbers. Combined with foldUnchanged, the padding collapses
  // into a folded region.
  const linePadding = $derived(lineOffset > 1 ? '\n'.repeat(lineOffset - 1) : '');
  const displayOldContent = $derived(linePadding + oldContent);
  const displayNewContent = $derived(linePadding + newContent);

  // Line selection state
  let selectedLines = $state<{
    start: number;
    end: number;
    side?: 'additions' | 'deletions';
  } | null>(null);

  // Hovered line state for per-line staging button
  // Use $state.raw to avoid triggering reactivity from DOM element references
  let hoveredLine = $state.raw<{
    lineNumber: number;
    side: 'additions' | 'deletions';
    lineElement: HTMLElement;
    numberElement?: HTMLElement;
  } | null>(null);
  let hoverButtonElement: HTMLButtonElement | null = null;

  // Prevent multiple simultaneous staging operations
  let isProcessingLineAction = $state(false);
  const dispatch = getDispatch();
  const activeWorkspace = selectActiveWorkspace();
  const activeWorkspaceId = selectActiveWorkspaceId();
  const filePathStore = writable<string | null | undefined>(undefined);
  const effectiveWorkspaceIdStore = writable<string>('');
  const workingTreeFileContentStore = selectOriginalFileContent(
    effectiveWorkspaceIdStore,
    filePathStore,
  );

  // Get workspace info
  const workspace = $derived($activeWorkspace);
  const workspacePath = $derived(workspace?.worktreePath || workspace?.repositoryPath || '');

  // File info
  const fileName = $derived(change?.relativePath || change?.file || 'file');
  const language = $derived(getLanguageFromFileName(fileName));
  let lastObservedWorkingTreeContent = $state<string | null>(null);
  let lastObservedWorkingTreeKey = $state('');

  function resolveRelativeFilePath(rawFilePath: string): string {
    if (!rawFilePath.startsWith('/') || !workspacePath) return rawFilePath;

    const normalizedWorkspacePath = workspacePath.endsWith('/')
      ? workspacePath.slice(0, -1)
      : workspacePath;
    if (rawFilePath.startsWith(normalizedWorkspacePath + '/')) {
      return rawFilePath.slice(normalizedWorkspacePath.length + 1);
    }
    if (rawFilePath.startsWith(normalizedWorkspacePath)) {
      const relativePath = rawFilePath.slice(normalizedWorkspacePath.length);
      return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    }
    return rawFilePath;
  }

  function getAbsoluteFilePath(relativePath: string): string | null {
    if (!relativePath) return null;
    if (relativePath.startsWith('/')) return relativePath;
    if (!workspacePath) return null;
    return `${workspacePath}/${relativePath}`;
  }

  async function loadWorkingTreeFileContent(wsId: string, filePath: string): Promise<string> {
    const absolutePath = getAbsoluteFilePath(filePath);
    if (!absolutePath) return '';

    try {
      const response = await invoke<FileReadResponse>('file:read', {
        workspaceId: wsId,
        path: absolutePath,
      });
      if (response.success === false) {
        logger.warn('[loadWorkingTreeFileContent] Failed to read disk content', {
          instanceId,
          filePath,
          error: response.error,
        });
        return '';
      }
      const data = response.data;
      return typeof data === 'string' ? data : data?.content ?? '';
    } catch (err) {
      logger.warn('[loadWorkingTreeFileContent] Failed to read disk content', {
        instanceId,
        filePath,
        error: err instanceof Error ? err.message : err,
      });
      return '';
    }
  }

  // Hash the unpadded content so the @pierre/diffs worker AST cache hits on
  // re-mount. Padding bytes change with lineOffset; folding them into the
  // hash would generate a fresh cache key every time the offset moves. We
  // still append `:off${lineOffset}` so a real offset change (which affects
  // what pierre renders) still invalidates the cached entry.
  const hasPadding = $derived(lineOffset > 1);
  const oldDiffCacheKey = $derived(
    hasPadding ? `${fileName}:${hashContent(oldContent)}:off${lineOffset}` : undefined,
  );
  const newDiffCacheKey = $derived(
    hasPadding ? `${fileName}:${hashContent(newContent)}:off${lineOffset}` : undefined,
  );

  function getLanguageFromFileName(name: string): string | undefined {
    const ext = name.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      py: 'python',
      rs: 'rust',
      go: 'go',
      rb: 'ruby',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      md: 'markdown',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sql: 'sql',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      svelte: 'svelte',
      vue: 'vue',
    };
    return ext ? langMap[ext] : undefined;
  }

  function checkContentSize(old: string, new_: string): boolean {
    const totalSize = (old?.length || 0) + (new_?.length || 0);
    if (totalSize > MAX_CONTENT_SIZE_BYTES) {
      contentTooLarge = true;
      return false;
    }
    return true;
  }

  function isRawGitDiff(content: string): boolean {
    if (!content) return false;
    const firstLine = content.split('\n')[0] || '';
    return (
      firstLine.startsWith('diff --git') ||
      firstLine.startsWith('---') ||
      firstLine.startsWith('@@')
    );
  }

  // forceRefresh: when true, ignore useProvidedContent and fetch fresh from git
  // This is used after staging/unstaging operations to show the updated diff
  async function loadDiffContent(forceRefresh = false) {
    // Guard against duplicate concurrent calls (onMount + $effect can race)
    if (isLoadingDiff) {
      logger.debug('[loadDiffContent] Skipping - already loading');
      return;
    }
    isLoadingDiff = true;

    loading = true;
    error = null;
    contentTooLarge = false;
    noChangesAtStage = false;
    oldContent = '';
    newContent = '';

    try {
      if (!change) {
        error = 'No change provided';
        return;
      }

      const stagedValue = change.stage === 'staged';
      let filePath = change.relativePath || change.file;

      // Convert absolute path to relative
      // Handle both with and without trailing slash on workspacePath
      filePath = resolveRelativeFilePath(filePath);

      // Store the resolved path for patch generation
      resolvedFilePath = filePath;

      // Check if content is already provided
      const oldContentValue = change.content?.oldContent || '';
      const newContentValue = change.content?.newContent || '';
      const hasProvidedContent =
        change.content?.oldContent !== undefined &&
        change.content?.newContent !== undefined &&
        (oldContentValue.length > 0 || newContentValue.length > 0);
      const contentIsRawDiff = isRawGitDiff(oldContentValue) || isRawGitDiff(newContentValue);

      logger.debug('[loadDiffContent] Checking content', {
        instanceId,
        stage: change.stage,
        commitHash: change.commitHash,
        changeId: change.id,
        hasProvidedContent,
        contentIsRawDiff,
        oldContentLength: oldContentValue.length,
        newContentLength: newContentValue.length,
        forceRefresh,
      });

      // Use provided content when:
      // 1. useProvidedContent prop is true (e.g., for inline diffs in chat showing exact tool call snippets)
      // 2. For committed changes (can't fetch fresh from git)
      // For staged/unstaged without useProvidedContent, fetch fresh to show current state
      // When forceRefresh is true, always fetch fresh (except for committed changes which can't be refreshed)
      const shouldUseProvidedContent =
        !forceRefresh &&
        hasProvidedContent &&
        !contentIsRawDiff &&
        (useProvidedContent || change.stage === 'committed');
      const shouldUseBranchBaseDiff =
        !forceRefresh &&
        !useProvidedContent &&
        !change.commitHash &&
        change.stage === 'committed' &&
        Boolean(branchBaseRef || branchBaseCommitSha);

      if (shouldUseProvidedContent) {
        logger.info('[loadDiffContent] Using provided content', {
          reason: useProvidedContent ? 'useProvidedContent prop' : 'committed change',
          oldContentLength: oldContentValue.length,
          newContentLength: newContentValue.length,
          oldContentPreview: oldContentValue.substring(0, 100),
          newContentPreview: newContentValue.substring(0, 100),
        });
        if (!checkContentSize(oldContentValue, newContentValue)) return;
        oldContent = oldContentValue;
        newContent = newContentValue;
        logger.info('[loadDiffContent] Content set', {
          oldContentLength: oldContent.length,
          newContentLength: newContent.length,
        });
      } else if (shouldUseBranchBaseDiff) {
        logger.info('[loadDiffContent] Fetching branch-base diff content', {
          baseRef: branchBaseRef,
          baseCommitSha: branchBaseCommitSha,
          filePath,
        });

        const wsIdForBranchBase = workspaceId || workspace?.id || '';
        const diffChunk = await batchedGitBranchBaseDiff(
          wsIdForBranchBase,
          { baseRef: branchBaseRef, baseCommitSha: branchBaseCommitSha },
          filePath,
        );

        oldContent = diffChunk?.oldContent || '';
        newContent = diffChunk?.newContent || '';

        if (!newContent && !oldContent) {
          noChangesAtStage = true;
        }
      } else if (change.stage === 'committed' && change.commitHash) {
        // For committed changes without provided content, fetch using git:show-file
        logger.info('[loadDiffContent] Fetching committed file content', {
          commitHash: change.commitHash,
          filePath,
        });

        const wsIdForShow = workspaceId || workspace?.id || '';
        // Parallel show-file fetches via the dedup cache so overlapping
        // mounts for the same file+commit share a single IPC round-trip.
        const [newContentResult, oldContentResult] = await Promise.all([
          dedupedShowFile(wsIdForShow, change.commitHash, filePath),
          dedupedShowFile(wsIdForShow, `${change.commitHash}^`, filePath),
        ]);

        newContent = newContentResult?.success ? newContentResult.data || '' : '';
        oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';

        logger.info('[loadDiffContent] Committed content fetched', {
          oldContentLength: oldContent.length,
          newContentLength: newContent.length,
        });

        if (!newContent && !oldContent) {
          noChangesAtStage = true;
        }
      } else {
        logger.debug('[loadDiffContent] Fetching via git:diff', {
          instanceId,
          stage: change.stage,
          stagedValue,
        });
        const wsIdForDiff = workspaceId || workspace?.id || '';

        // Helper: fill oldContent/newContent from git at a given `staged`
        // flag via the batcher + show-file dedup cache. Returns true when the
        // diff chunk (or its fallback) populated both sides.
        const tryLoadAtStage = async (stagedFlag: boolean): Promise<boolean> => {
          const diffChunk = await batchedGitDiff(wsIdForDiff, stagedFlag, filePath);

          if (diffChunk) {
            const hasValidOld =
              diffChunk.oldContent !== undefined && diffChunk.oldContent !== '';
            const hasValidNew =
              diffChunk.newContent !== undefined && diffChunk.newContent !== '';

            if (hasValidOld && hasValidNew) {
              oldContent = diffChunk.oldContent || '';
              newContent = diffChunk.newContent || '';
              return true;
            }

            // Fallback: fetch content manually via show-file / file:read.
            // Old side always comes from a git ref; new side comes from the
            // working copy for unstaged changes.
            const gitRef = stagedFlag ? 'HEAD' : ':0';
            const oldResult = await dedupedShowFile(wsIdForDiff, gitRef, filePath);
            if (oldResult?.success) oldContent = oldResult.data || '';

            if (stagedFlag) {
              const indexResult = await dedupedShowFile(wsIdForDiff, ':0', filePath);
              if (indexResult?.success) newContent = indexResult.data || '';
            } else {
              const wsId = workspaceId || workspace?.id;
              newContent = wsId ? await loadWorkingTreeFileContent(wsId, filePath) : '';
            }
            return true;
          }
          return false;
        };

        const loadedAtRequested = await tryLoadAtStage(stagedValue);

        if (!loadedAtRequested) {
          // git:diff returned no changes for the requested stage
          // Try the opposite stage (e.g., if unstaged returned nothing, try staged)
          // This handles cases where the tracked change has stale stage info
          const oppositeStaged = !stagedValue;
          logger.info('[loadDiffContent] No changes at requested stage, trying opposite stage', {
            instanceId,
            originalStage: change.stage,
            triedStaged: stagedValue,
            tryingStaged: oppositeStaged,
          });

          const loadedAtOpposite = await tryLoadAtStage(oppositeStaged);
          if (loadedAtOpposite) {
            logger.info('[loadDiffContent] Found changes at opposite stage', {
              instanceId,
              stage: oppositeStaged ? 'staged' : 'unstaged',
              oldContentLength: oldContent.length,
              newContentLength: newContent.length,
            });
          } else {
            // Neither stage has changes - fall back to provided content if available
            // This handles cases where changes have been committed, reverted, or modified
            if (hasProvidedContent && !contentIsRawDiff) {
              logger.info(
                '[loadDiffContent] git:diff returned no changes, falling back to provided content',
                {
                  instanceId,
                  oldContentLength: oldContentValue.length,
                  newContentLength: newContentValue.length,
                },
              );
              if (checkContentSize(oldContentValue, newContentValue)) {
                oldContent = oldContentValue;
                newContent = newContentValue;
              } else {
                noChangesAtStage = true;
              }
            } else {
              noChangesAtStage = true;
            }
          }
        }
      }

      if (!checkContentSize(oldContent, newContent)) {
        oldContent = '';
        newContent = '';
      }
    } catch (err) {
      logger.error('Failed to load diff content', err as Error);
      error = err instanceof Error ? err.message : 'Failed to load diff';
    } finally {
      loading = false;
      isLoadingDiff = false;
    }
  }

  /**
   * Convert a jsdiff patch to git-compatible format.
   * jsdiff creates patches like:
   *   Index: filename
   *   ===================================================================
   *   --- filename
   *   +++ filename
   * But git expects:
   *   diff --git a/filename b/filename
   *   --- a/filename
   *   +++ b/filename
   */

  // Generate a patch for a range of lines (new file line numbers)
  // This properly includes context lines for git apply to work
  // For staging: context comes from oldContent (INDEX)
  // For unstaging: context comes from newContent (INDEX) since we apply with --reverse
  // The optional `side` parameter filters to only additions or deletions when specified
  function generateLinePatch(
    startLine: number,
    endLine: number,
    side?: 'additions' | 'deletions',
  ): string | null {
    const filePath = resolvedFilePath || change.relativePath || change.file;
    const contextLines = 3;
    const lineDelta = lineOffset > 1 ? Math.floor(lineOffset) - 1 : 0;
    const localStartLine = Math.max(1, startLine - lineDelta);
    const localEndLine = Math.max(localStartLine, endLine - lineDelta);

    const fullPatch = Diff.createPatch(filePath, oldContent, newContent, '', '', {
      context: contextLines,
    });

    // Parse all hunks from the full patch
    const lines = fullPatch.split('\n');

    // Build proper git-format headers (jsdiff doesn't create git-compatible headers)
    // For new files (empty oldContent), use /dev/null as the old file
    const isNewFile = oldContent === '' && lineDelta === 0;
    const gitHeaders = isNewFile
      ? [
          `diff --git a/${filePath} b/${filePath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${filePath}`,
        ]
      : [`diff --git a/${filePath} b/${filePath}`, `--- a/${filePath}`, `+++ b/${filePath}`];

    // Collect all hunk content with line tracking
    interface HunkLine {
      content: string;
      oldLine: number | null; // null for additions
      newLine: number | null; // null for deletions
      type: 'context' | 'addition' | 'deletion';
    }

    const allHunkLines: HunkLine[] = [];
    let inHunk = false;
    let currentNewLine = 0;
    let currentOldLine = 0;

    for (const line of lines) {
      // Skip jsdiff headers, we'll use our own git-format headers
      if (
        line.startsWith('Index:') ||
        line.startsWith('===') ||
        line.startsWith('---') ||
        line.startsWith('+++')
      ) {
        continue;
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentOldLine = parseInt(match[1], 10);
          currentNewLine = parseInt(match[2], 10);
          inHunk = true;
        }
      } else if (inHunk && line !== '') {
        if (line.startsWith('+')) {
          allHunkLines.push({
            content: line,
            oldLine: null,
            newLine: currentNewLine,
            type: 'addition',
          });
          currentNewLine++;
        } else if (line.startsWith('-')) {
          allHunkLines.push({
            content: line,
            oldLine: currentOldLine,
            newLine: null,
            type: 'deletion',
          });
          currentOldLine++;
        } else if (line.startsWith(' ')) {
          allHunkLines.push({
            content: line,
            oldLine: currentOldLine,
            newLine: currentNewLine,
            type: 'context',
          });
          currentNewLine++;
          currentOldLine++;
        }
      }
    }

    // Find target lines and collect with context
    // First, find the range of indices that contain our target lines
    // If `side` is specified, only include changes of that type
    let targetStartIdx = -1;
    let targetEndIdx = -1;

    logger.info('[generateLinePatch] Searching for target lines', {
      startLine,
      endLine,
      localStartLine,
      localEndLine,
      side,
      allHunkLinesCount: allHunkLines.length,
      allHunkLinesSample: allHunkLines.slice(0, 10).map((hl) => ({
        content: hl.content.substring(0, 40),
        oldLine: hl.oldLine,
        newLine: hl.newLine,
        type: hl.type,
        effectiveLineNum: hl.newLine ?? hl.oldLine,
      })),
    });

    for (let i = 0; i < allHunkLines.length; i++) {
      const hl = allHunkLines[i];
      const lineNum = hl.newLine ?? hl.oldLine;
      if (lineNum !== null && lineNum >= localStartLine && lineNum <= localEndLine) {
        // Check if this line type matches the requested side
        const isAddition = hl.type === 'addition';
        const isDeletion = hl.type === 'deletion';

        // If side is specified, only include matching types
        if (side === 'additions' && !isAddition) continue;
        if (side === 'deletions' && !isDeletion) continue;

        if (isAddition || isDeletion) {
          if (targetStartIdx === -1) targetStartIdx = i;
          targetEndIdx = i;
        }
      }
    }

    logger.info('[generateLinePatch] Target found', {
      targetStartIdx,
      targetEndIdx,
      targetLines:
        targetStartIdx >= 0
          ? allHunkLines.slice(targetStartIdx, targetEndIdx + 1).map((hl) => ({
              content: hl.content,
              oldLine: hl.oldLine,
              newLine: hl.newLine,
              type: hl.type,
            }))
          : null,
    });

    if (targetStartIdx === -1) return null;

    // Include context lines before and after, but ONLY include:
    // 1. The target addition/deletion lines the user selected
    // 2. Context (unchanged) lines that are CONTIGUOUS with the target
    // IMPORTANT: Stop at any non-target addition/deletion to avoid gaps in the patch

    // Collect context lines BEFORE the target (walking backwards, stopping at any change)
    const contextBefore: HunkLine[] = [];
    for (let i = targetStartIdx - 1; i >= 0 && contextBefore.length < contextLines; i--) {
      const hl = allHunkLines[i];
      if (hl.type === 'context') {
        contextBefore.unshift(hl);
      } else {
        // Hit a non-target change, stop here
        break;
      }
    }

    // Collect the target lines
    const targetLines: HunkLine[] = [];
    for (let i = targetStartIdx; i <= targetEndIdx; i++) {
      targetLines.push(allHunkLines[i]);
    }

    // Collect context lines AFTER the target (walking forwards, stopping at any change)
    const contextAfter: HunkLine[] = [];
    for (
      let i = targetEndIdx + 1;
      i < allHunkLines.length && contextAfter.length < contextLines;
      i++
    ) {
      const hl = allHunkLines[i];
      if (hl.type === 'context') {
        contextAfter.push(hl);
      } else {
        // Hit a non-target change, stop collecting from diff
        break;
      }
    }

    // If we couldn't get enough trailing context from the diff (because another change follows),
    // we need to get context from the appropriate content based on the operation:
    // - For STAGING (unstaged changes): context from OLD content (INDEX) - we apply forward
    // - For UNSTAGING (staged changes): context from NEW content (INDEX) - we apply with --reverse
    // The key insight: context must match the file being patched (the INDEX in both cases)
    if (contextAfter.length < contextLines) {
      const isUnstaging = change.stage === 'staged';

      if (isUnstaging) {
        // For unstaging, we apply --reverse, so context must match newContent (INDEX)
        // Find the last new line number from our selection
        let lastNewLine = 0;
        const lastContextAfter = contextAfter[contextAfter.length - 1];
        if (lastContextAfter?.newLine) {
          lastNewLine = lastContextAfter.newLine;
        } else {
          for (let i = targetEndIdx; i >= 0; i--) {
            const hl = allHunkLines[i];
            if (hl.newLine !== null) {
              lastNewLine = hl.newLine;
              break;
            }
          }
        }
        // For deletions-only, use the line number from context
        if (lastNewLine === 0) {
          const lastContextLine = contextBefore[contextBefore.length - 1];
          if (lastContextLine?.newLine) {
            lastNewLine = lastContextLine.newLine;
          }
        }

        // Get additional context from newContent (INDEX for staged changes)
        const newLines = newContent.split('\n');
        const neededContextLines = contextLines - contextAfter.length;
        for (let i = 0; i < neededContextLines; i++) {
          const lineIdx = lastNewLine + i; // lastNewLine is 1-based, so this gets the next lines
          if (lineIdx < newLines.length) {
            const lineContent = newLines[lineIdx];
            contextAfter.push({
              content: ' ' + lineContent,
              oldLine: null,
              newLine: lineIdx + 1,
              type: 'context',
            });
          }
        }
      } else {
        // For staging, we apply forward, so context must match oldContent (INDEX)
        // Find the last old line number from our selection
        let lastOldLine = 0;
        const lastContextAfter = contextAfter[contextAfter.length - 1];
        if (lastContextAfter?.oldLine) {
          lastOldLine = lastContextAfter.oldLine;
        } else {
          for (let i = targetEndIdx; i >= 0; i--) {
            const hl = allHunkLines[i];
            if (hl.oldLine !== null) {
              lastOldLine = hl.oldLine;
              break;
            }
          }
        }
        // For additions-only, use the line number where they would be inserted
        if (lastOldLine === 0) {
          const lastContextLine = contextBefore[contextBefore.length - 1];
          if (lastContextLine?.oldLine) {
            lastOldLine = lastContextLine.oldLine;
          }
        }

        // Get additional context from oldContent (INDEX for unstaged changes)
        const oldLines = oldContent.split('\n');
        const neededContextLines = contextLines - contextAfter.length;
        for (let i = 0; i < neededContextLines; i++) {
          const lineIdx = lastOldLine + i; // lastOldLine is 1-based, so this gets the next lines
          if (lineIdx < oldLines.length) {
            const lineContent = oldLines[lineIdx];
            contextAfter.push({
              content: ' ' + lineContent,
              oldLine: lineIdx + 1,
              newLine: null,
              type: 'context',
            });
          }
        }
      }
    }

    // Combine: context before + target + context after
    const selectedLines: HunkLine[] = [...contextBefore, ...targetLines, ...contextAfter];

    if (selectedLines.length === 0) return null;

    // Calculate hunk header values
    // Find first old line and first new line
    let firstOldLine = 0;
    let firstNewLine = 0;
    for (const hl of selectedLines) {
      if (hl.oldLine !== null && firstOldLine === 0) {
        firstOldLine = hl.oldLine;
      }
      if (hl.newLine !== null && firstNewLine === 0) {
        firstNewLine = hl.newLine;
      }
      if (firstOldLine !== 0 && firstNewLine !== 0) break;
    }

    // If we only have additions (no old lines), use the new line number
    if (firstOldLine === 0) {
      firstOldLine = firstNewLine > 0 ? firstNewLine - 1 : 1;
    }
    if (firstNewLine === 0) {
      firstNewLine = firstOldLine;
    }

    // Count lines for header
    let oldCount = 0;
    let newCount = 0;
    for (const hl of selectedLines) {
      if (hl.type === 'deletion') {
        oldCount++;
      } else if (hl.type === 'addition') {
        newCount++;
      } else {
        oldCount++;
        newCount++;
      }
    }

    const hunkHeader = `@@ -${firstOldLine + lineDelta},${oldCount} +${firstNewLine + lineDelta},${newCount} @@`;
    const patchContent = selectedLines.map((hl) => hl.content).join('\n');

    const patch = [...gitHeaders, hunkHeader, patchContent].join('\n') + '\n';

    logger.info('[generateLinePatch] Generated patch', {
      hunkHeader,
      selectedLinesCount: selectedLines.length,
      selectedLinesContent: selectedLines.map((hl) => ({
        content: hl.content,
        type: hl.type,
      })),
      fullPatch: patch,
    });

    return patch;
  }

  // Handle line selection change
  function handleLineSelected(
    range: { start: number; end: number; side?: 'additions' | 'deletions' } | null,
  ) {
    selectedLines = range;
  }

  // Stage selected lines
  function stageSelectedLines() {
    if (!selectedLines) return;
    const effectiveFilePath = resolvedFilePath || change.relativePath || change.file;
    const patch = generateLinePatch(selectedLines.start, selectedLines.end, selectedLines.side);
    if (patch && onStageHunk) {
      onStageHunk(effectiveFilePath, patch);
      // Track line staging event
      track('Staged Changes', { method: 'lines' });
      selectedLines = null; // Clear selection after staging
    }
  }

  // Unstage selected lines
  function unstageSelectedLines() {
    if (!selectedLines) return;
    const effectiveFilePath = resolvedFilePath || change.relativePath || change.file;
    const patch = generateLinePatch(selectedLines.start, selectedLines.end, selectedLines.side);
    if (patch && onUnstageHunk) {
      onUnstageHunk(effectiveFilePath, patch);
      selectedLines = null; // Clear selection after unstaging
    }
  }

  // Changed-line computation is lazy + memoized. It used to be a
  // `$derived.by` that re-ran whenever content, file path, or dependencies
  // changed — even when the user never interacted with the diff. For the
  // "all changes" view that's N expensive patch-parse runs on mount. Now we
  // compute on demand from the hover effect and the selection action bar,
  // and cache by (filePath, contentHash-old, contentHash-new, lineOffset).
  const EMPTY_CHANGED = {
    additions: new Set<number>(),
    deletions: new Set<number>(),
  };
  let changedLineMemoKey = '';
  let changedLineMemoValue: { additions: Set<number>; deletions: Set<number> } = EMPTY_CHANGED;
  function getChangedLineNumbers(): { additions: Set<number>; deletions: Set<number> } {
    if (!oldContent && !newContent) return EMPTY_CHANGED;

    const filePath = resolvedFilePath || change.relativePath || change.file;
    const key = `${filePath}|${hashContent(oldContent)}|${hashContent(newContent)}|${lineOffset}`;
    if (key === changedLineMemoKey) return changedLineMemoValue;

    const { additions, deletions } = getChangedLineNumbersFromContent(
      filePath,
      oldContent,
      newContent,
      lineOffset,
    );
    changedLineMemoKey = key;
    changedLineMemoValue = { additions, deletions };
    return changedLineMemoValue;
  }

  // Load content on mount
  onMount(() => {
    logger.info('[onMount] Component mounted', {
      instanceId,
      changeId: change?.id,
      file: change?.file,
      stage: change?.stage,
      commitHash: change?.commitHash,
    });
    loadDiffContent();
  });

  $effect(() => {
    const wsId = workspaceId || $activeWorkspaceId || '';
    const filePath = resolveRelativeFilePath(change?.relativePath || change?.file || '');
    const absolutePath = getAbsoluteFilePath(filePath);
    const fileKey = `${wsId}:${filePath}`;

    effectiveWorkspaceIdStore.set(wsId);
    filePathStore.set(filePath);

    if (fileKey !== lastObservedWorkingTreeKey) {
      lastObservedWorkingTreeKey = fileKey;
      lastObservedWorkingTreeContent = null;
    }

    if (wsId && filePath && absolutePath && change?.stage !== 'committed' && !useProvidedContent) {
      dispatch(loadFileContentRequested(wsId, filePath, absolutePath));
    }
  });

  $effect(() => {
    if (useProvidedContent) return;
    const content = $workingTreeFileContentStore;
    if (content === null || content === lastObservedWorkingTreeContent) return;

    const previousContent = untrack(() => lastObservedWorkingTreeContent);
    lastObservedWorkingTreeContent = content;
    if (previousContent === null) return;

    logger.debug('[files slice] File content changed, reloading diff', {
      instanceId,
      filePath: change?.relativePath || change?.file,
    });
    loadDiffContent();
  });

  // Watch for refreshKey changes
  $effect(() => {
    if (refreshKey !== undefined && refreshKey !== lastRefreshKey) {
      const isFirst = lastRefreshKey === undefined;
      lastRefreshKey = refreshKey;
      if (!isFirst) {
        logger.debug('[refreshKey effect] RefreshKey changed, reloading', {
          instanceId,
          refreshKey,
          lastRefreshKey,
        });
        loadDiffContent();
      }
    }
  });

  // Watch for change prop changes - only reload when the actual change identity changes
  // Skip the initial run since onMount already handles loading
  $effect(() => {
    const currentId = change?.id;
    const currentFile = change?.file;

    // Read lastChangeId/lastChangeFile without tracking to avoid loops
    const prevId = untrack(() => lastChangeId);
    const prevFile = untrack(() => lastChangeFile);

    // Skip if this is the initial run (prevId undefined) - onMount handles that
    if (prevId === undefined && prevFile === undefined) {
      // Just record the current values for future comparison
      lastChangeId = currentId;
      lastChangeFile = currentFile;
      return;
    }

    // Only reload if the change actually changed (not just object reference)
    if (currentId !== prevId || currentFile !== prevFile) {
      logger.debug('[change effect] Change identity changed, reloading', {
        instanceId,
        currentId,
        currentFile,
        prevId,
        prevFile,
      });
      lastChangeId = currentId;
      lastChangeFile = currentFile;
      loadDiffContent();
    }
  });

  // Manage hover button - append to number element when hovering a changed line
  // Only react to hoveredLine changes - use untrack for everything else to prevent loops
  $effect(() => {
    const line = hoveredLine;

    // Cleanup previous button
    if (hoverButtonElement) {
      hoverButtonElement.remove();
      hoverButtonElement = null;
    }

    if (!line?.numberElement) return;

    // Use untrack to read other state without creating reactive dependencies
    // This prevents infinite loops when changedLineNumbers, loading, etc. change
    untrack(() => {
      // Check if this is a changed line (lazy: first call triggers the memoized compute)
      const changed = getChangedLineNumbers();
      const lineSet = line.side === 'additions' ? changed.additions : changed.deletions;
      if (!lineSet.has(line.lineNumber)) return;

      // Don't show button if operation is in progress
      if (isProcessingLineAction || loading) return;

      // Create the button
      const isUnstaged = change.stage === 'unstaged';
      const hasHandler = isUnstaged ? onStageHunk : onUnstageHunk;
      if (!hasHandler) return;

      const btn = document.createElement('button');
      btn.className = isUnstaged
        ? 'hunk-action-btn hunk-stage-btn line-hover-btn'
        : 'hunk-action-btn hunk-unstage-btn line-hover-btn';
      btn.innerHTML = isUnstaged ? '+' : '−';
      btn.title = isUnstaged ? 'Stage this line' : 'Unstage this line';

      // Stop all event propagation to prevent line selection
      const stopEvent = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      btn.onpointerdown = stopEvent;
      btn.onpointerup = stopEvent;
      btn.onmousedown = stopEvent;
      btn.onmouseup = stopEvent;

      btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        // Prevent multiple simultaneous operations
        if (isProcessingLineAction || loading) {
          return;
        }

        isProcessingLineAction = true;
        btn.disabled = true;
        btn.style.opacity = '0.5';

        try {
          const effectiveFilePath = resolvedFilePath || change.relativePath || change.file;
          // Pass the side to ensure we only stage/unstage the specific change type
          const patch = generateLinePatch(line.lineNumber, line.lineNumber, line.side);
          if (patch) {
            if (isUnstaged && onStageHunk) {
              onStageHunk(effectiveFilePath, patch);
            } else if (!isUnstaged && onUnstageHunk) {
              onUnstageHunk(effectiveFilePath, patch);
            }
          }
          // Reload diff content immediately after operation, forcing fresh fetch from git
          // forceRefresh=true bypasses useProvidedContent to get the actual new state
          await loadDiffContent(true);
        } finally {
          isProcessingLineAction = false;
        }
      };

      line.numberElement!.appendChild(btn);
      hoverButtonElement = btn;
    });
  });
</script>

<div class="tracked-change-diff-viewer">
  {#if loading}
    <!-- Skeleton loader that mimics diff appearance -->
    <div class="diff-skeleton">
      <!-- Header skeleton -->
      <div class="diff-skeleton-header">
        <Skeleton class="h-4 w-48" />
        <Skeleton class="h-4 w-24" />
      </div>
      <!-- Code lines skeleton -->
      <div class="diff-skeleton-content">
        {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as i }
          <div
            class="diff-skeleton-line"
            class:diff-skeleton-line--added={i % 5 === 2}
            class:diff-skeleton-line--removed={i % 7 === 3}
          >
            <Skeleton class="h-3 w-6 shrink-0" />
            <Skeleton class="h-3" style="width: {40 + Math.random() * 50}%" />
          </div>
        {/each}
      </div>
    </div>
  {:else if error}
    <div class="error-state">
      <Fa icon={faExclamationTriangle} class="text-destructive-foreground" />
      <span class="text-destructive-foreground text-sm ml-2">{error}</span>
    </div>
  {:else if contentTooLarge}
    <div class="error-state">
      <Fa icon={faExclamationTriangle} class="text-warning" />
      <span class="text-subtle text-sm ml-2">File too large to display diff</span>
    </div>
  {:else if noChangesAtStage}
    <div class="empty-state">
      <span class="text-subtle text-sm">
        {#if change.stage === 'committed'}
          Unable to load diff for this commit
        {:else}
          No {change.stage === 'staged' ? 'staged' : 'unstaged'} changes for this file
        {/if}
      </span>
    </div>
  {:else}

    <div class="diff-wrapper">
      <!-- Selection action bar -->
      {#if selectedLines}
        {@const changedLines = getChangedLineNumbers()}
        {@const lineSet =
          selectedLines.side === 'additions'
            ? changedLines.additions
            : changedLines.deletions}
        {@const modifiedCount = Array.from(
          { length: selectedLines!.end - selectedLines!.start + 1 },
          (_, i) => selectedLines!.start + i,
        ).filter((lineNum) => lineSet.has(lineNum)).length}
        <div class="selection-action-bar">
          <span class="selection-info">
            {modifiedCount} modified line{modifiedCount !== 1 ? 's' : ''} selected
          </span>
          {#if modifiedCount > 0}
            {#if change.stage === 'unstaged' && onStageHunk}
              <button class="hunk-action-btn hunk-stage-btn" onclick={stageSelectedLines}>
                <span class="icon">+</span> Stage
              </button>
            {:else if change.stage === 'staged' && onUnstageHunk}
              <button class="hunk-action-btn hunk-unstage-btn" onclick={unstageSelectedLines}>
                <span class="icon">−</span> Unstage
              </button>
            {/if}
          {/if}
          <button
            class="hunk-action-btn"
            style="background: transparent; color: hsl(var(--muted-foreground));"
            onclick={() => (selectedLines = null)}
          >
            ✕
          </button>
        </div>
      {/if}

      <div class="diff-content">
        <DiffViewer
          oldContent={displayOldContent}
          newContent={displayNewContent}
          oldCacheKey={oldDiffCacheKey}
          newCacheKey={newDiffCacheKey}
          {fileName}
          {language}
          {viewMode}
          {showHeader}
          showStats={false}
          expandUnchanged={!foldUnchanged}
          overflow={lineWrapping ? 'wrap' : 'scroll'}
          enableLineSelection={!!(onStageHunk || onUnstageHunk)}
          {selectedLines}
          onLineSelected={handleLineSelected}
          onLineEnter={(props) => {
            if (onStageHunk || onUnstageHunk) {
              hoveredLine = {
                lineNumber: props.lineNumber,
                side: props.annotationSide,
                lineElement: props.lineElement,
                numberElement: props.numberElement,
              };
            }
          }}
          onLineLeave={() => {
            hoveredLine = null;
          }}
          {annotations}
          {renderAnnotation}
          {virtualizer}
          unsafeCSS={`
          /* Make line number column relative for hover button positioning */
          [data-column-number] {
            position: sticky;
            left: 0;
          }

          /* Stage/unstage buttons */
          .hunk-action-btn {
            font-size: 0.75rem;
            font-weight: 500;
            padding: 0.2rem 0.5rem;
            border-radius: 0.25rem;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 0.25rem;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .hunk-action-btn .icon {
            font-weight: 700;
          }
          .hunk-stage-btn {
            background: hsl(142 76% 36% / 0.15);
            color: hsl(142 76% 36%);
          }
          .hunk-stage-btn:hover {
            background: hsl(142 76% 36% / 0.25);
          }
          .hunk-unstage-btn {
            background: hsl(0 84% 60% / 0.15);
            color: hsl(0 84% 60%);
          }
          .hunk-unstage-btn:hover {
            background: hsl(0 84% 60% / 0.25);
          }
          /* Per-line hover button (appended to number column on hover) */
          /* Leave 16px on left for line selection click area */
          .line-hover-btn {
            position: absolute;
            top: 0;
            left: 16px;
            right: 0;
            bottom: 0;
            width: calc(100% - 16px);
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            font-size: 0.9rem;
            padding: 0;
          }
          /* Hide line number when hover button is present */
          [data-column-number]:has(.line-hover-btn) [data-line-number-content] {
            visibility: hidden;
          }
        `}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .tracked-change-diff-viewer {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .diff-wrapper {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Ensure the diff viewer itself can scroll */
  .tracked-change-diff-viewer :global(.pure-diff) {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: none;
    border-radius: 0;
  }

  .error-state,
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    height: 100%;
  }

  /* Diff skeleton loader styles */
  .diff-skeleton {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: hsl(var(--background));
  }

  .diff-skeleton-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--muted) / 0.3);
  }

  .diff-skeleton-content {
    flex: 1;
    padding: 0.5rem 0;
    overflow: hidden;
  }

  .diff-skeleton-line {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 1rem;
    height: 1.5rem;
  }

  .diff-skeleton-line--added {
    background: hsl(var(--success) / 0.08);
  }

  .diff-skeleton-line--removed {
    background: hsl(var(--destructive) / 0.08);
  }
</style>
