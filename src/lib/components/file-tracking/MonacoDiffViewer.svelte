<script lang="ts">
  /**
   * MonacoDiffViewer - Monaco-based diff viewer with git integration
   *
   * For read-only diff display, use:
   * ```svelte
   * import { DiffViewer } from '$lib/components/ui/diff';
   * ```
   */
  import { onMount } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { ensureMonacoInitialized, initializeMonaco } from '$lib/utils/monaco-workers';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import { defineMonacoThemes, getActiveMonacoThemeName } from '$lib/utils/monaco-theme';
  import { themeManager } from '$lib/utils/theme';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Fa from 'svelte-fa';
  import {
    faExclamationTriangle,
    faEye,
    faExternalLinkAlt,
    faFolderOpen,
  } from '@fortawesome/free-solid-svg-icons';
  import AgentAttributionBadge from '$lib/components/shared/AgentAttributionBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import * as Diff from 'diff';
  import { stripWorkspacePrefix, pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import { selectCodeFontFamilyCSS } from '$lib/store/slices/code-font-settings/code-font-settings-selectors';

  // Content size limits to prevent freezes with massive files
  const MAX_CONTENT_SIZE_BYTES = 500 * 1024; // 500KB
  const DIFF_LOAD_TIMEOUT_MS = 8000; // 8 seconds timeout for loading diffs

  const logger = createLogger('MonacoDiffViewer');

  interface Props {
    change: TrackedChange;
    workspaceId?: string;
    sideBySide?: boolean;
    compact?: boolean; // When true, uses content-based height instead of fixed min-height
    lineWrapping?: boolean;
    foldUnchanged?: boolean; // When true, folds unchanged regions in the diff
    handleMouseWheel?: boolean; // When false, wheel events pass through to parent (for click-to-scroll pattern)
    alwaysConsumeMouseWheel?: boolean; // When false, only consume wheel events when there's something to scroll (defaults to handleMouseWheel)
    scrollToLine?: number; // When set, scrolls to this line number in the modified editor
    /** When true, the modified side of the diff is editable */
    readOnly?: boolean;
    /** Change this value to force a refresh of the diff content (e.g., after partial staging) */
    refreshKey?: number;
    /** Callback when user wants to stage selected lines/hunk. Receives the file path and unified diff patch. */
    onStageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to unstage selected lines/hunk. Receives the file path and unified diff patch. */
    onUnstageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Starting line number offset for snippet content. When set, line numbers are displayed as (lineOffset + n - 1). */
    lineOffset?: number;
  }

  let {
    change,
    workspaceId,
    sideBySide,
    compact = false,
    lineWrapping = true,
    foldUnchanged = true,
    handleMouseWheel = true,
    alwaysConsumeMouseWheel,
    scrollToLine,
    readOnly = true,
    refreshKey,
    onStageHunk,
    onUnstageHunk,
    lineOffset,
  }: Props = $props();

  const codeFontFamilyCSS = selectCodeFontFamilyCSS();

  // Default alwaysConsumeMouseWheel to match handleMouseWheel for backward compatibility
  let effectiveAlwaysConsume = $derived(alwaysConsumeMouseWheel ?? handleMouseWheel);

  // Svelte 5: bind:this updates the variable; use $state.raw to keep it reactive
  // without proxying DOM nodes.
  let container = $state.raw<HTMLDivElement | undefined>(undefined);
  let editor: monaco.editor.IStandaloneDiffEditor | null = null;
  // Track which container the editor was created in
  let editorContainer: HTMLDivElement | null = null;
  let loading = $state(true);
  let error: string | null = $state(null);
  let oldContent = $state('');
  let newContent = $state('');
  let editorInitialized = false;
  let isDisposing = false;
  let isUpdating = false;
  let updateTimeout: NodeJS.Timeout | null = null;
  let loadTimeoutId: NodeJS.Timeout | null = null;
  // Counter to track load generations - ensures only the latest load's content is used
  let loadGeneration = 0;
  let currentLoadGeneration = 0;

  // Timestamp of the last successful in-place refresh from agent file changes
  // Used to skip redundant refreshKey-triggered loads that would destroy focus/scroll
  let lastInPlaceRefreshTimestamp = 0;
  // How long to suppress refreshKey loads after an in-place refresh (ms)
  const IN_PLACE_REFRESH_SUPPRESSION_MS = 500;

  // For compact mode: dynamically calculated height based on content
  let compactHeight = $state<number | null>(null);

  // State for content too large to display
  let contentTooLarge = $state(false);
  let contentSize = $state(0);
  let loadTimedOut = $state(false);
  // State for binary files that can't be displayed as text diff
  let isBinaryFile = $state(false);
  // State for no changes at this stage (e.g., file was fully staged/unstaged)
  let noChangesAtStage = $state(false);

  // Track whether we're showing snippet content (from tool calls) vs full file content
  // CRITICAL: For snippet content, we need special handling to apply edits to the full file
  let isSnippetContent = $state(false);

  // Store the ORIGINAL snippet content when first loaded (before any edits)
  // This is used to find the snippet location in the full file when saving
  let originalSnippetContent = $state<string | null>(null);

  // Use the sideBySide prop if provided, otherwise fall back to localStorage preference
  const DIFF_VIEW_PREFERENCE_KEY = 'diff-view-side-by-side';
  function getStoredDiffPreference(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(DIFF_VIEW_PREFERENCE_KEY);
    return stored === null ? true : stored === 'true';
  }

  // Derive renderSideBySide from prop or localStorage
  let renderSideBySide = $derived(
    sideBySide !== undefined ? sideBySide : getStoredDiffPreference(),
  );
  let foldingStatus = $state<'idle' | 'folding' | 'folded'>('idle');

  // Detect current theme using ThemeManager for consistency
  function detectCurrentTheme(): boolean {
    if (typeof window === 'undefined') return true;
    return themeManager.isDark();
  }

  let isDarkMode = $state(detectCurrentTheme());

  /**
   * Convert an absolute file path to a relative path for git operations.
   * Git patches require paths relative to the repository root.
   */
  function toRelativePath(absolutePath: string): string {
    // Get workspace path
    const workspace = workspaceId
      ? workspaceStore.findById(WorkspaceId(workspaceId))
      : workspaceStore.current;
    const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

    if (!workspacePath) {
      // Can't determine workspace path, return as-is
      return absolutePath;
    }

    // If the path starts with the workspace path, strip it (with directory boundary check)
    const relativePath = stripWorkspacePrefix(absolutePath, workspacePath);
    if (relativePath !== absolutePath) {
      return relativePath;
    }

    // Path doesn't start with workspace path, return as-is
    return absolutePath;
  }

  /**
   * Generate a unified diff patch for the selected lines.
   * Uses the `diff` library to create a proper patch that can be applied with `git apply --cached`.
   *
   * The approach: generate full patch, then filter to hunks that overlap with the selection.
   */
  function generateHunkPatch(
    startLine: number,
    endLine: number,
    oldContentStr: string,
    newContentStr: string,
    filePath: string,
  ): string | null {
    // Convert absolute path to relative path for git
    const relativeFilePath = toRelativePath(filePath);

    logger.debug('generateHunkPatch called', {
      startLine,
      endLine,
      oldContentLength: oldContentStr.length,
      newContentLength: newContentStr.length,
      filePath,
      relativeFilePath,
      oldContentPreview: oldContentStr.substring(0, 100),
      newContentPreview: newContentStr.substring(0, 100),
    });

    // Use the diff library to create a proper unified patch
    const fullPatch = Diff.createPatch(relativeFilePath, oldContentStr, newContentStr, '', '', {
      context: 3,
    });

    logger.debug('Full patch generated', {
      patchLength: fullPatch.length,
      patchPreview: fullPatch.substring(0, 300),
    });

    // Parse the patch to find hunks that overlap with the selection
    const lines = fullPatch.split('\n');
    const headerLines: string[] = [];
    const hunks: { header: string; lines: string[]; newStart: number; newCount: number }[] = [];

    let currentHunk: {
      header: string;
      lines: string[];
      newStart: number;
      newCount: number;
    } | null = null;

    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
        headerLines.push(line);
      } else if (line.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          if (currentHunk) {
            hunks.push(currentHunk);
          }
          currentHunk = {
            header: line,
            lines: [],
            newStart: parseInt(match[3], 10),
            newCount: parseInt(match[4] || '1', 10),
          };
        }
      } else if (currentHunk) {
        currentHunk.lines.push(line);
      }
    }
    if (currentHunk) {
      hunks.push(currentHunk);
    }

    // Find hunks that overlap with the selection (based on new file line numbers)
    const selectedHunks = hunks.filter((hunk) => {
      const hunkEnd = hunk.newStart + hunk.newCount - 1;
      // Check if hunk overlaps with selection [startLine, endLine]
      return hunk.newStart <= endLine && hunkEnd >= startLine;
    });

    if (selectedHunks.length === 0) {
      logger.warn('No hunks overlap with selection', {
        startLine,
        endLine,
        availableHunks: hunks.map((h) => ({ start: h.newStart, count: h.newCount })),
      });
      return null;
    }

    // Build the patch with only selected hunks
    // Fix the header format for git apply (needs a/ and b/ prefixes)
    const fixedHeaders = headerLines.map((line) => {
      if (line.startsWith('--- ') && !line.startsWith('--- a/')) {
        return `--- a/${relativeFilePath}`;
      }
      if (line.startsWith('+++ ') && !line.startsWith('+++ b/')) {
        return `+++ b/${relativeFilePath}`;
      }
      return line;
    });

    const patchParts = [
      ...fixedHeaders.filter((h) => h.startsWith('---') || h.startsWith('+++')),
      ...selectedHunks.flatMap((hunk) => [hunk.header, ...hunk.lines]),
    ];

    return patchParts.join('\n') + '\n';
  }

  /**
   * Add context menu actions for staging/unstaging hunks
   */
  function addHunkContextMenuActions(diffEditor: monaco.editor.IStandaloneDiffEditor) {
    const modifiedEditor = diffEditor.getModifiedEditor();

    // Only add stage action if we have a callback and this is an unstaged change
    if (onStageHunk && change.stage === ChangeStage.Unstaged) {
      modifiedEditor.addAction({
        id: 'stage-selected-lines',
        label: 'Stage Selected Lines',
        contextMenuGroupId: 'git',
        contextMenuOrder: 1,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
        run: () => {
          const selection = modifiedEditor.getSelection();
          if (!selection) return;

          const patch = generateHunkPatch(
            selection.startLineNumber,
            selection.endLineNumber,
            oldContent,
            newContent,
            change.relativePath || change.file,
          );

          if (patch) {
            onStageHunk(change.relativePath || change.file, patch);
          }
        },
      });

      // Add action to stage current hunk (no selection needed)
      modifiedEditor.addAction({
        id: 'stage-current-hunk',
        label: 'Stage This Hunk',
        contextMenuGroupId: 'git',
        contextMenuOrder: 0.5,
        run: () => {
          // Stage the entire diff as a single hunk
          const lineCount = modifiedEditor.getModel()?.getLineCount() || 1;
          logger.debug('Stage This Hunk clicked', {
            lineCount,
            filePath: change.relativePath || change.file,
            oldContentLength: oldContent.length,
            newContentLength: newContent.length,
          });
          const patch = generateHunkPatch(
            1,
            lineCount,
            oldContent,
            newContent,
            change.relativePath || change.file,
          );

          logger.debug('Generated patch for staging', {
            patchLength: patch?.length,
            patchPreview: patch?.substring(0, 200),
          });

          if (patch) {
            onStageHunk(change.relativePath || change.file, patch);
          } else {
            logger.warn('Failed to generate patch for staging');
            toast.error('Failed to stage selected lines. Please select a complete code block.');
          }
        },
      });
    }

    // Only add unstage action if we have a callback and this is a staged change
    if (onUnstageHunk && change.stage === ChangeStage.Staged) {
      modifiedEditor.addAction({
        id: 'unstage-selected-lines',
        label: 'Unstage Selected Lines',
        contextMenuGroupId: 'git',
        contextMenuOrder: 2,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU],
        run: () => {
          const selection = modifiedEditor.getSelection();
          if (!selection) return;

          const patch = generateHunkPatch(
            selection.startLineNumber,
            selection.endLineNumber,
            oldContent,
            newContent,
            change.relativePath || change.file,
          );

          if (patch) {
            onUnstageHunk(change.relativePath || change.file, patch);
          }
        },
      });

      // Add action to unstage current hunk (no selection needed)
      modifiedEditor.addAction({
        id: 'unstage-current-hunk',
        label: 'Unstage This Hunk',
        contextMenuGroupId: 'git',
        contextMenuOrder: 1.5,
        run: () => {
          // Unstage the entire diff as a single hunk
          const lineCount = modifiedEditor.getModel()?.getLineCount() || 1;
          const patch = generateHunkPatch(
            1,
            lineCount,
            oldContent,
            newContent,
            change.relativePath || change.file,
          );

          if (patch) {
            onUnstageHunk(change.relativePath || change.file, patch);
          }
        },
      });
    }

    // Add gutter menu items for staging/unstaging via Monaco's diff gutter
    addGutterMenuItems(diffEditor);
  }

  // Track gutter menu disposables for cleanup
  let gutterMenuDisposables: monaco.IDisposable[] = [];

  // Track MutationObserver for revert button tooltips
  let revertButtonObserver: MutationObserver | null = null;

  /**
   * Add tooltips to Monaco's revert buttons using native title attribute.
   * Uses MutationObserver because Monaco creates these buttons dynamically.
   */
  function setupRevertButtonTooltips(containerElement: HTMLElement) {
    if (revertButtonObserver) {
      revertButtonObserver.disconnect();
    }

    const addTitlesToButtons = () => {
      // Find all codicon elements in the gutter buttons (these are the revert buttons)
      const buttons = containerElement.querySelectorAll('.gutter .gutterItem .buttons .codicon');
      buttons.forEach((btn) => {
        if (!btn.hasAttribute('title')) {
          btn.setAttribute('title', 'Revert this change');
        }
      });
    };

    // Add titles to any existing buttons
    addTitlesToButtons();

    // Watch for new buttons being added
    revertButtonObserver = new MutationObserver(() => {
      addTitlesToButtons();
    });

    revertButtonObserver.observe(containerElement, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Add gutter menu items for staging/unstaging hunks in the diff gutter
   */
  function addGutterMenuItems(diffEditor: monaco.editor.IStandaloneDiffEditor) {
    // Monaco's diff editor exposes gutter menu through the accessibleDiffViewer
    // We can hook into the diff editor's onDidUpdateDiff to add our custom actions
    try {
      // Access the diff model to get hunk information
      const diffModel = diffEditor.getModel();
      if (!diffModel) return;

      // Listen for diff updates to track hunk positions
      const disposable = diffEditor.onDidUpdateDiff(() => {
        // The diff has been computed - we could add decorations here
        // For now, the context menu actions handle staging/unstaging
        logger.debug('Diff updated, hunks available for staging');
      });

      // Store disposable for cleanup
      gutterMenuDisposables.push(disposable);
    } catch (err) {
      logger.warn('Failed to add gutter menu items:', err);
    }
  }

  // Update editor when sideBySide prop changes
  $effect(() => {
    // Read renderSideBySide to track as dependency
    const currentSideBySide = renderSideBySide;
    if (editor) {
      editor.updateOptions({
        renderSideBySide: currentSideBySide,
      });
      // Force layout update after changing side-by-side mode
      setTimeout(() => editor?.layout(), 50);
    }
  });

  // Update editor when lineWrapping prop changes
  $effect(() => {
    const wrap = lineWrapping;
    if (editor) {
      editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
    }
  });

  // Update font when code font settings change
  $effect(() => {
    const fontFamily = $codeFontFamilyCSS;
    if (editor) {
      editor.updateOptions({ fontFamily });
    }
  });

  // Update editor when foldUnchanged prop changes
  $effect(() => {
    const fold = foldUnchanged;
    if (editor) {
      editor.updateOptions({
        hideUnchangedRegions: {
          enabled: fold,
          revealLineCount: 40,
          minimumLineCount: 1,
          contextLineCount: 3,
        },
      });
    }
  });

  // Update editor scrollbar options when handleMouseWheel or alwaysConsumeMouseWheel props change
  // This enables the "click to focus and scroll" pattern
  // alwaysConsumeMouseWheel controls whether Monaco greedily consumes wheel events even when
  // there's nothing to scroll — when false, vertical wheel events pass through to the parent
  // while horizontal scroll still works if there's horizontal overflow
  $effect(() => {
    const shouldHandle = handleMouseWheel;
    const shouldAlwaysConsume = effectiveAlwaysConsume;
    if (editor) {
      editor.updateOptions({
        scrollbar: {
          alwaysConsumeMouseWheel: shouldAlwaysConsume,
          handleMouseWheel: shouldHandle,
        },
      });
    }
  });

  // Scroll to specific line when scrollToLine prop changes
  $effect(() => {
    const targetLine = scrollToLine;
    if (editor && targetLine && targetLine > 0) {
      // Get the modified editor (right side in side-by-side, or the main editor in inline)
      const modifiedEditor = editor.getModifiedEditor();
      if (modifiedEditor) {
        // Reveal the line in the center of the viewport
        modifiedEditor.revealLineInCenter(targetLine);
        // Also set cursor position for visual feedback
        modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
        // Briefly highlight the line
        const decorations = modifiedEditor.createDecorationsCollection([
          {
            range: new monaco.Range(targetLine, 1, targetLine, 1),
            options: {
              isWholeLine: true,
              className: 'scroll-highlight-line',
            },
          },
        ]);
        // Remove decoration after animation
        setTimeout(() => {
          decorations.clear();
        }, 1500);
      }
    }
  });

  // Debounce timer for file change updates
  let fileChangeDebounce: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    // Load the diff content first
    void loadDiffContent().catch((err) => {
      logger.warn('loadDiffContent failed (onMount)', err);
    });

    // Subscribe to file content changes for real-time diff updates
    const filePath = change?.relativePath || change?.file;
    const wsId = workspaceId || workspaceStore.current?.id;

    // Use shared utility for path matching (handles absolute vs relative, normalization,
    // and prevents false positives like "bar.js" matching "foobar.js")
    const pathsMatch = filePathsMatch;

    const handleFileChange = (data: any) => {
      // Check if this change is for our file FIRST
      const changedPath = data.path || data.relativePath || data.filePath;
      logger.debug('handleFileChange received', { changedPath, ourFilePath: filePath, wsId });

      if (!pathsMatch(changedPath, filePath)) {
        return; // Not our file, ignore
      }

      // Skip if this change came from our own save (only check AFTER path match)
      if (isSavingFromEditor) {
        logger.info('Skipping file change reload - change came from our own save', { filePath });
        return;
      }

      logger.info('File change detected, scheduling in-place refresh', { changedPath, filePath });
      // Debounce rapid updates
      if (fileChangeDebounce) {
        clearTimeout(fileChangeDebounce);
      }
      fileChangeDebounce = setTimeout(() => {
        if (!isDisposing && !isSavingFromEditor) {
          // Refresh content in-place to preserve scroll position
          // This doesn't go through loading state, preventing component re-renders
          void refreshContentInPlace().catch((err) => {
            logger.warn('refreshContentInPlace failed after file change', err);
          });
        }
      }, 300);
    };

    // Handler for agent file changes (emitted when file:write is called with workspaceId)
    const handleAgentFileChange = (data: any) => {
      // Check if this change is for our workspace and file FIRST
      if (data.workspaceId !== wsId) return;
      const changedPath = data.filePath || data.path;
      logger.debug('handleAgentFileChange received', { changedPath, ourFilePath: filePath, wsId });

      if (!pathsMatch(changedPath, filePath)) {
        return; // Not our file, ignore
      }

      // Skip if this change came from our own save (only check AFTER path match)
      if (isSavingFromEditor) {
        logger.info('Skipping agent file change reload - change came from our own save', {
          filePath,
        });
        return;
      }

      logger.info('Agent file change detected, scheduling in-place refresh', {
        changedPath,
        filePath,
      });

      // Debounce rapid updates
      if (fileChangeDebounce) {
        clearTimeout(fileChangeDebounce);
      }
      fileChangeDebounce = setTimeout(() => {
        logger.debug('Agent file change debounce fired', {
          isDisposing,
          isSavingFromEditor,
          filePath,
        });
        if (!isDisposing && !isSavingFromEditor) {
          // Refresh content in-place to preserve scroll position
          // This doesn't go through loading state, preventing component re-renders
          void refreshContentInPlace().catch((err) => {
            logger.warn('refreshContentInPlace failed after agent file change', err);
          });
        } else {
          logger.debug('Agent file change debounce skipped - conditions not met', {
            isDisposing,
            isSavingFromEditor,
          });
        }
      }, 300);
    };

    // Store cleanup functions so we can reliably unsubscribe (context isolation safe)
    let cleanupFileContentChanged: (() => void) | null = null;
    let cleanupAgentFileChanged: (() => void) | null = null;

    // Listen for file content changes
    if (wsId && filePath) {
      cleanupFileContentChanged = listenSync(`file:content-changed:${wsId}`, ({ payload }) => {
        handleFileChange(payload);
      });
      // Also listen for agent file changes (from file:write IPC calls)
      cleanupAgentFileChanged = listenSync('file-tracking:agent-file-changed', ({ payload }) => {
        handleAgentFileChange(payload);
      });
    }

    // NOTE: We intentionally do NOT listen to 'file-tracking:changes-updated' here.
    // That event fires frequently and can cause infinite reload loops.
    // Instead, the parent component should pass a new `refreshKey` prop when staging/unstaging
    // changes that affect this file.

    // Listen to ThemeManager's theme-changed event for custom/preset theme support
    const handleThemeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ theme: string; isDark: boolean }>;
      isDarkMode = customEvent.detail.isDark;
      if (editor) {
        monaco.editor.setTheme(getActiveMonacoThemeName(customEvent.detail.isDark));
      }
    };
    window.addEventListener('theme-changed', handleThemeChanged);

    return () => {
      logger.debug('MonacoDiffViewer cleanup running (component unmounting)', {
        filePath,
        hasFileChangeDebounce: !!fileChangeDebounce,
      });

      // Clean up theme-changed listener
      window.removeEventListener('theme-changed', handleThemeChanged);

      // Clean up file change listeners
      if (wsId && filePath) {
        cleanupFileContentChanged?.();
        cleanupFileContentChanged = null;
        cleanupAgentFileChanged?.();
        cleanupAgentFileChanged = null;
      }

      if (fileChangeDebounce) {
        logger.debug('Clearing fileChangeDebounce in cleanup', { filePath });
        clearTimeout(fileChangeDebounce);
      }

      // Dispose the editor and its models properly
      isDisposing = true;
      if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
      }
      // Dispose content size change listener
      if (contentSizeChangeDisposable) {
        contentSizeChangeDisposable.dispose();
        contentSizeChangeDisposable = null;
      }
      // Dispose content change listener for auto-save
      if (contentChangeDisposable) {
        contentChangeDisposable.dispose();
        contentChangeDisposable = null;
      }
      if (saveDebounceTimeout) {
        clearTimeout(saveDebounceTimeout);
        saveDebounceTimeout = null;
      }
      if (saveCooldownTimeout) {
        clearTimeout(saveCooldownTimeout);
        saveCooldownTimeout = null;
      }
      // Dispose gutter menu listeners
      for (const disposable of gutterMenuDisposables) {
        try {
          disposable.dispose();
        } catch (e) {
          // Ignore disposal errors
        }
      }
      gutterMenuDisposables = [];
      // Disconnect revert button tooltip observer
      if (revertButtonObserver) {
        revertButtonObserver.disconnect();
        revertButtonObserver = null;
      }
      if (editor) {
        // Wrap in a microtask to avoid synchronous disposal issues
        Promise.resolve()
          .then(() => {
            try {
              // Get the current models before disposing the editor
              const model = editor?.getModel();

              // Clear the model from the editor first to prevent internal errors
              if (editor) {
                try {
                  editor.setModel(null);
                } catch (e) {
                  // Ignore errors when clearing model
                }
              }

              // Dispose the editor
              if (editor) {
                try {
                  editor.dispose();
                } catch (err: any) {
                  // Check if it's a Monaco "Canceled" error and suppress it
                  if (!err?.message?.includes('Canceled')) {
                    logger.warn('[DiffViewer] Non-cancellation disposal error:', err);
                  }
                }
                editor = null;
              }

              // Then dispose the models if they exist
              // This ensures models are disposed after the editor
              if (model) {
                setTimeout(() => {
                  try {
                    if (model.original && typeof model.original.dispose === 'function') {
                      model.original.dispose();
                    }
                    if (model.modified && typeof model.modified.dispose === 'function') {
                      model.modified.dispose();
                    }
                  } catch (e) {
                    // Ignore model disposal errors
                  }
                }, 10);
              }
            } catch (err: any) {
              // Check if it's a Monaco "Canceled" error and suppress it
              if (!err?.message?.includes('Canceled')) {
                logger.warn('[DiffViewer] Disposal error:', err);
              }
            }
          })
          .catch((err: any) => {
            // Catch any async errors and suppress "Canceled" errors
            if (!err?.message?.includes('Canceled')) {
              logger.warn('[DiffViewer] Async disposal error:', err);
            }
          });
      }
    };
  });

  // Watch for container changes - if container element changes, the editor is orphaned
  // and needs to be disposed so it can be recreated in the new container.
  // Only depend on `container` to avoid re-running when editor changes.
  $effect(() => {
    // Only read container in the effect dependency tracking
    const currentContainer = container;

    // Use untrack to read editor state without creating dependencies
    $effect.root(() => {
      // This won't create dependencies on editor or editorContainer
    });

    // Check if container changed (comparing to stored reference)
    if (currentContainer && editorContainer && currentContainer !== editorContainer) {
      logger.debug('Container element changed, disposing orphaned editor');

      // The container changed - dispose the old editor
      if (editor) {
        try {
          editor.setModel(null);
          editor.dispose();
        } catch (e) {
          // Ignore disposal errors
        }
        editor = null;
      }
      editorContainer = null;
      editorInitialized = false;
    }
  });

  // Watch for when loading is complete and container is available
  $effect(() => {
    // Don't create editor if content is too large or loading timed out
    if (
      !loading &&
      !error &&
      !contentTooLarge &&
      !loadTimedOut &&
      !isBinaryFile &&
      container &&
      !editorInitialized &&
      !editor
    ) {
      // Create editor - content might be empty strings for new/deleted files
      // Check that we actually have the content loaded (not just initial empty strings)
      if (!editorInitialized && !editor) {
        // Set editorInitialized immediately to prevent multiple concurrent editor creations
        // This must be set BEFORE any async work to avoid race conditions
        editorInitialized = true;

        // Create editor asynchronously to ensure Monaco is initialized
        (async () => {
          try {
            // Ensure Monaco is initialized before creating editor
            await ensureMonacoInitialized();
            await initializeMonaco();

            // Define custom themes with diff colors
            defineMonacoThemes();

            // Re-detect theme right before creating editor (async operations above may have allowed theme to change)
            isDarkMode = detectCurrentTheme();

            // Use theme based on current mode (respects custom/preset themes)
            const theme = getActiveMonacoThemeName(isDarkMode);

            // Set theme globally
            monaco.editor.setTheme(theme);

            // Create the diff editor with explicit diff options
            // Sleek, minimal styling similar to Pierre diff viewer
            const diffOptions: any = {
              theme: theme,
              automaticLayout: true,
              readOnly: readOnly,
              renderSideBySide: renderSideBySide,
              minimap: { enabled: false },
              overviewRulerLanes: 0,
              overviewRuler: false,
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: $codeFontFamilyCSS,
              // Use custom line numbers function when lineOffset is provided to show real file line numbers
              lineNumbers: lineOffset ? (n: number) => `${lineOffset + n - 1}` : 'on',
              lineNumbersMinChars: lineOffset ? 4 : 2,
              renderWhitespace: 'none',
              wordWrap: lineWrapping ? 'on' : 'off',
              ignoreTrimWhitespace: false,
              renderIndicators: false, // Hide the +/- gutter indicators
              renderGutterMenu: false, // Hide the revert button gutter
              originalEditable: false,
              diffAlgorithm: 'advanced',
              guides: { indentation: false }, // Disable indent guides to work around Monaco 0.54.0 crash (indent is not iterable)
              folding: false, // Cleaner look without folding icons
              enableSplitViewResizing: false,
              renderOverviewRuler: false,
              glyphMargin: false, // Hide glyph margin for cleaner look
              renderLineHighlight: 'none', // No line highlight
              renderValidationDecorations: 'off',
              renderControlCharacters: false,
              isInEmbeddedEditor: true,
              useInlineViewWhenSpaceIsLimited: true,
              diffCodeLens: false,
              lineDecorationsWidth: 12, // Minimal left padding
              padding: { top: 8, bottom: 8 },
              hideUnchangedRegions: {
                enabled: foldUnchanged,
                revealLineCount: 40,
                minimumLineCount: 1,
                contextLineCount: 3,
              },
              scrollbar: {
                alwaysConsumeMouseWheel: effectiveAlwaysConsume,
                handleMouseWheel: handleMouseWheel,
                vertical: 'hidden',
                horizontal: 'auto',
                verticalScrollbarSize: 0,
                horizontalScrollbarSize: 8,
              },
              // Separate options for original editor - hide its line numbers
              originalAriaLabel: 'Original',
              modifiedAriaLabel: 'Modified',
            };

            editor = monaco.editor.createDiffEditor(container, diffOptions);
            // Track which container this editor was created in
            editorContainer = container;

            // Hide original editor's line numbers for single-column look
            // Only show the modified (new) line numbers
            const originalEditor = editor.getOriginalEditor();
            originalEditor.updateOptions({
              lineNumbers: 'off',
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 12,
              lineNumbersMinChars: 0,
            });

            // Also update after a delay to ensure it takes effect
            setTimeout(() => {
              if (editor && !isDisposing) {
                editor.getOriginalEditor().updateOptions({
                  lineNumbers: 'off',
                  lineNumbersMinChars: 0,
                });
              }
            }, 100);

            // Verify the editor was created and attached to the container
            const editorDomNode = editor.getContainerDomNode();
            logger.debug('Monaco diff editor created', {
              hasContent: !!(oldContent || newContent),
              oldContentLength: (oldContent || '').length,
              newContentLength: (newContent || '').length,
              editorDomNodeExists: !!editorDomNode,
              editorDomNodeParent: editorDomNode?.parentElement?.className,
              containerChildren: container?.children?.length,
              editorInContainer: container?.contains(editorDomNode),
            });

            // Set the diff model with the loaded content
            updateDiff();
            editorInitialized = true;

            // Add context menu actions for staging/unstaging hunks
            if (onStageHunk || onUnstageHunk) {
              addHunkContextMenuActions(editor);
            }

            // For compact mode, measure content height after folding settles
            if (compact) {
              measureAndSetCompactHeight();
            }

            // Set up auto-save for editable diffs
            if (!readOnly) {
              setupAutoSave();
            }

            // Set up tooltips for revert buttons
            if (container) {
              setupRevertButtonTooltips(container);
            }
          } catch (err) {
            logger.error('[DiffViewer] Failed to create Monaco diff editor:', err);
            error = 'Failed to initialize diff viewer';
            // Reset editorInitialized so it can be retried
            editorInitialized = false;
          }
        })();

        // Check if the container is visible and force layout
        if (container) {
          // Force layout after a short delay
          setTimeout(() => {
            editor?.layout();
          }, 50);
        }
      }
    }
  });

  // Track disposable for content size change listener
  let contentSizeChangeDisposable: monaco.IDisposable | null = null;

  // Track disposable for content change listener (for auto-save)
  let contentChangeDisposable: monaco.IDisposable | null = null;
  let saveDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  // Track when we're saving to avoid reloading from our own save event
  let isSavingFromEditor = false;
  let saveCooldownTimeout: ReturnType<typeof setTimeout> | null = null;
  // Track when we're refreshing content to avoid triggering auto-save from setValue()
  let isRefreshingContent = false;
  // Save generation counter to cancel stale saves (prevents race conditions with revert)
  let saveGeneration = 0;

  /**
   * Save the modified content back to the file
   * @param expectedGeneration - The save generation when this save was scheduled.
   *                             If it doesn't match current generation, the save is cancelled.
   */
  async function saveModifiedContent(expectedGeneration?: number) {
    // Check if this save is stale (a newer edit has occurred)
    if (expectedGeneration !== undefined && expectedGeneration !== saveGeneration) {
      logger.debug('Cancelling stale save', {
        expectedGeneration,
        currentGeneration: saveGeneration,
      });
      return;
    }

    if (!editor || isDisposing || readOnly) return;

    const modifiedEditor = editor.getModifiedEditor();
    const model = modifiedEditor.getModel();
    if (!model) return;

    const editedContent = model.getValue();
    const filePath = change?.relativePath || change?.file;
    const wsId = workspaceId || workspaceStore.current?.id;

    if (!filePath || !wsId) {
      logger.warn('Cannot save: missing file path or workspace ID');
      return;
    }

    // Get workspace to construct absolute path
    const workspace = workspaceId
      ? workspaceStore.findById(WorkspaceId(workspaceId))
      : workspaceStore.current;
    const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

    if (!workspacePath) {
      logger.warn('Cannot save: missing workspace path');
      return;
    }

    // Construct absolute path
    const absolutePath = filePath.startsWith('/') ? filePath : `${workspacePath}/${filePath}`;

    try {
      // Set flag to prevent reloading from our own save event
      isSavingFromEditor = true;
      // Clear any existing cooldown
      if (saveCooldownTimeout) {
        clearTimeout(saveCooldownTimeout);
      }

      let contentToSave: string;

      if (isSnippetContent) {
        // For snippet content, we need to apply the edit to the full file
        // 1. Read the current full file content
        // 2. Find the original snippet (newContent from the tool call) in the file
        // 3. Replace it with the edited content
        // 4. Save the full file

        // Get the ORIGINAL snippet content (stored when first loaded, before any edits)
        // This is what we need to find in the file to replace
        if (!originalSnippetContent) {
          logger.warn('Cannot apply snippet edit: no original snippet content stored');
          isSavingFromEditor = false;
          return;
        }

        // Check if the content actually changed from the original
        if (editedContent === originalSnippetContent) {
          logger.debug('Snippet content unchanged from original, skipping save');
          isSavingFromEditor = false;
          return;
        }

        // Check if user reverted all changes (content matches oldContent)
        // This happens when using Monaco's "Revert this change" action
        if (editedContent === oldContent) {
          logger.debug('Content reverted to original (matches oldContent), skipping save');
          isSavingFromEditor = false;
          return;
        }

        // Read the current file content
        const fileResult = (await invoke('file:read', {
          workspaceId: wsId,
          path: absolutePath,
        })) as {
          success: boolean;
          data?: { content: string; stats: { size: number; modified: string } };
          error?: { code: string; message: string } | string;
        };

        if (!fileResult?.success || !fileResult.data?.content) {
          logger.error('Failed to read file for snippet edit', {
            filePath,
            error: fileResult?.error,
          });
          isSavingFromEditor = false;
          return;
        }

        const fullFileContent = fileResult.data.content;

        // Normalize line endings to LF for consistent comparison and saving
        // This ensures CRLF vs LF differences don't cause index mismatches
        const normalizedFileContent = fullFileContent.replace(/\r\n/g, '\n');
        const normalizedOriginalSnippet = originalSnippetContent.replace(/\r\n/g, '\n');
        const normalizedEditedContent = editedContent.replace(/\r\n/g, '\n');

        // Find the original snippet in the normalized file content
        let snippetIndex = normalizedFileContent.indexOf(normalizedOriginalSnippet);
        let snippetLength = normalizedOriginalSnippet.length;

        if (snippetIndex === -1) {
          // Try trimming trailing whitespace from both as a fallback
          const trimmedSnippet = normalizedOriginalSnippet.trimEnd();

          // Search for the trimmed snippet
          snippetIndex = normalizedFileContent.indexOf(trimmedSnippet);

          if (snippetIndex !== -1) {
            // Found with trimmed version - use the trimmed length for replacement
            snippetLength = trimmedSnippet.length;
            logger.debug('Found snippet with trimmed match', { snippetIndex, snippetLength });
          }
        }

        // If string matching failed, try using lineOffset for line-based positioning
        if (snippetIndex === -1 && lineOffset !== undefined && lineOffset > 0) {
          logger.debug('String matching failed, trying line-based positioning', { lineOffset });

          // Split file into lines to find the position
          const fileLines = normalizedFileContent.split('\n');
          const snippetLines = normalizedOriginalSnippet.split('\n');
          const snippetLineCount = snippetLines.length;

          // lineOffset is 1-based, array index is 0-based
          const startLineIndex = lineOffset - 1;
          const endLineIndex = startLineIndex + snippetLineCount;

          if (startLineIndex >= 0 && endLineIndex <= fileLines.length) {
            // Calculate the character index at the start of the snippet's first line
            let charIndex = 0;
            for (let i = 0; i < startLineIndex; i++) {
              charIndex += fileLines[i].length + 1; // +1 for newline
            }

            // Calculate the length of the lines we're replacing
            let lineBasedSnippetLength = 0;
            for (let i = startLineIndex; i < endLineIndex; i++) {
              lineBasedSnippetLength += fileLines[i].length;
              if (i < endLineIndex - 1) {
                lineBasedSnippetLength += 1; // +1 for newline between lines
              }
            }

            snippetIndex = charIndex;
            snippetLength = lineBasedSnippetLength;
            logger.info('Using line-based positioning for snippet edit', {
              lineOffset,
              startLineIndex,
              endLineIndex,
              snippetIndex,
              snippetLength,
            });
          } else {
            logger.warn('Line-based positioning out of bounds', {
              lineOffset,
              startLineIndex,
              endLineIndex,
              totalLines: fileLines.length,
            });
          }
        }

        if (snippetIndex === -1) {
          logger.warn(
            'Cannot apply snippet edit: original snippet not found in file. File may have changed.',
            {
              snippetPreview: originalSnippetContent.substring(0, 100),
              filePreview: fullFileContent.substring(0, 200),
              snippetLength: originalSnippetContent.length,
              fileLength: fullFileContent.length,
              lineOffset,
            },
          );
          toast.error('Cannot save edit: file content may have changed externally');
          isSavingFromEditor = false;
          return;
        }

        // Apply the edit to the NORMALIZED file content (with LF line endings)
        // This ensures indices match correctly
        contentToSave =
          normalizedFileContent.substring(0, snippetIndex) +
          normalizedEditedContent +
          normalizedFileContent.substring(snippetIndex + snippetLength);

        logger.info('Applying snippet edit to full file', {
          filePath,
          snippetIndex,
          originalLen: normalizedOriginalSnippet.length,
          editedLen: editedContent.length,
        });

        // Update the original snippet content to reflect the edit
        // This allows subsequent edits to work correctly
        originalSnippetContent = editedContent;
      } else {
        // Full file content - save directly
        // But first check if user reverted all changes
        if (editedContent === oldContent) {
          logger.debug('Full file content reverted to original, skipping save');
          isSavingFromEditor = false;
          return;
        }
        contentToSave = editedContent;
      }

      // Emit the event BEFORE the file write to ensure listeners track the save
      // before the file tracking store updates (which happens synchronously on file:write)
      logger.debug('Dispatching diff-editor:file-saved event (before write)', {
        filePath: absolutePath,
        relativePath: filePath,
        workspaceId: wsId,
      });
      window.dispatchEvent(
        new CustomEvent('diff-editor:file-saved', {
          detail: {
            filePath: absolutePath,
            relativePath: filePath,
            workspaceId: wsId,
          },
        }),
      );

      await invoke('file:write', {
        path: absolutePath,
        content: contentToSave,
        workspaceId: wsId,
      });
      logger.info('Saved modified content', {
        filePath,
        absolutePath,
        isSnippet: isSnippetContent,
      });

      // Keep the flag set for a short time to catch the file change event
      saveCooldownTimeout = setTimeout(() => {
        isSavingFromEditor = false;
      }, 500);
    } catch (err) {
      isSavingFromEditor = false;
      logger.error('Failed to save modified content', err as Error);
      // Show user-facing error notification
      toast.error('Failed to save changes. Please try again.');
    }
  }

  /**
   * Set up auto-save when content changes (only if not readOnly)
   */
  function setupAutoSave() {
    if (!editor || readOnly) return;

    const modifiedEditor = editor.getModifiedEditor();

    // Dispose previous listener if any
    if (contentChangeDisposable) {
      contentChangeDisposable.dispose();
    }

    // Listen for content changes and debounce save
    contentChangeDisposable = modifiedEditor.onDidChangeModelContent(() => {
      // Skip if disposing, read-only, or if we're programmatically refreshing content
      if (isDisposing || readOnly || isRefreshingContent) return;

      // Increment save generation to cancel any pending stale saves
      // This prevents race conditions when user reverts or makes rapid edits
      saveGeneration++;
      const currentGeneration = saveGeneration;

      // Clear previous debounce
      if (saveDebounceTimeout) {
        clearTimeout(saveDebounceTimeout);
      }

      // Debounce save by 500ms, passing the generation to detect stale saves
      saveDebounceTimeout = setTimeout(() => {
        void saveModifiedContent(currentGeneration).catch((err) => {
          logger.warn('saveModifiedContent failed (auto-save)', err);
        });
      }, 500);
    });
  }

  // Measure the content height after folding and set compact height to fit content
  function measureAndSetCompactHeight() {
    if (!editor || !compact) return;

    const measure = () => {
      if (!editor || isDisposing) return;

      try {
        // Get the modified editor's content height (this accounts for folded regions)
        const modifiedEditor = editor.getModifiedEditor();

        // Validate that the model exists and has valid content before measuring
        // This prevents "Illegal value for lineNumber" errors during revert/undo operations
        const model = modifiedEditor.getModel();
        if (!model || model.getLineCount() === 0) {
          logger.debug('[DiffViewer] Skipping measure - model not ready or empty');
          return;
        }

        const contentHeight = modifiedEditor.getContentHeight();

        // Add some padding for the editor chrome - no max height, let it grow to fit content
        const totalHeight = contentHeight + 8;
        compactHeight = Math.max(totalHeight, 80); // minimum 80px

        // Trigger a layout update with the new height
        // Wrap in try-catch to handle edge cases during model transitions
        try {
          editor.layout();
        } catch (layoutErr: any) {
          // Suppress "Illegal value for lineNumber" errors that can occur during rapid changes
          if (!layoutErr?.message?.includes('Illegal value for lineNumber')) {
            throw layoutErr;
          }
          logger.debug('[DiffViewer] Suppressed lineNumber error during layout');
        }
      } catch (err) {
        logger.warn('[DiffViewer] Failed to measure compact height:', err);
        compactHeight = 300; // fallback
      }
    };

    // Measure initially
    setTimeout(measure, 200);

    // Re-measure after folding completes (Monaco folds after ~1 second)
    setTimeout(measure, 1200);

    // Listen for content size changes (fold/unfold, content changes, etc.)
    // This ensures the container resizes when user expands/collapses hidden regions
    const modifiedEditor = editor.getModifiedEditor();
    if (contentSizeChangeDisposable) {
      contentSizeChangeDisposable.dispose();
    }
    contentSizeChangeDisposable = modifiedEditor.onDidContentSizeChange(() => {
      if (!isDisposing && editor) {
        measure();
      }
    });
  }

  // Track the last loaded change ID to prevent duplicate loads
  let lastLoadedChangeId: string | undefined = undefined;
  // Track the last refreshKey to detect external refresh requests
  let lastRefreshKey: number | undefined = undefined;

  // Watch for change prop updates - reload content when change ID or path changes
  // IMPORTANT: Only track specific primitive values (id, path) to avoid infinite loops
  // when the change object reference changes but content is the same
  $effect(() => {
    // Extract primitive values FIRST to create stable dependencies
    const changeId = change?.id;

    // Only reload if the ID actually changed (not just object reference)
    if (change && !isDisposing && changeId !== lastLoadedChangeId) {
      logger.info('Change ID changed - will reload content', {
        oldChangeId: lastLoadedChangeId,
        newChangeId: changeId,
        filePath: change?.relativePath || change?.file,
        isSavingFromEditor,
      });
      // Track this change ID to prevent duplicate loads
      lastLoadedChangeId = changeId;

      // Clear any pending timeout
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }

      // Reload content for the new change
      updateTimeout = setTimeout(() => {
        if (!isDisposing) {
          void loadDiffContent().catch((err) => {
            logger.warn('loadDiffContent failed (change update)', err);
          });
        }
      }, 10);
    }
  });

  // Watch for refreshKey changes to force reload (e.g., after partial staging)
  $effect(() => {
    const currentRefreshKey = refreshKey;
    if (currentRefreshKey !== undefined && currentRefreshKey !== lastRefreshKey) {
      const isFirstMount = lastRefreshKey === undefined;
      lastRefreshKey = currentRefreshKey;
      // Don't reload on first mount - only on subsequent refreshKey changes
      if (!isFirstMount && !isDisposing) {
        // Skip if an in-place refresh recently completed - the content is already up to date
        // This prevents double-refresh which destroys focus and scroll position
        const timeSinceInPlaceRefresh = Date.now() - lastInPlaceRefreshTimestamp;
        if (timeSinceInPlaceRefresh < IN_PLACE_REFRESH_SUPPRESSION_MS) {
          logger.info(
            'Refresh triggered by refreshKey change - SKIPPING (recent in-place refresh)',
            {
              refreshKey: currentRefreshKey,
              filePath: change?.relativePath || change?.file,
              timeSinceInPlaceRefresh,
            },
          );
          return;
        }
        logger.info('Refresh triggered by refreshKey change - will reload content', {
          refreshKey: currentRefreshKey,
          filePath: change?.relativePath || change?.file,
          isSavingFromEditor,
        });
        // Use the same debounce timer as changeId effect to batch concurrent loads
        // This prevents a duplicate load when both changeId and refreshKey change
        // during workspace switch (which causes stale generation discards)
        if (updateTimeout) {
          clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
          if (!isDisposing) {
            void loadDiffContent().catch((err) => {
              logger.warn('loadDiffContent failed (refreshKey)', err);
            });
          }
        }, 10);
      }
    }
  });

  async function loadDiffContent(forceFresh: boolean = false) {
    // Increment load generation to track which load is current
    loadGeneration++;
    const thisLoadGeneration = loadGeneration;

    logger.debug('loadDiffContent started', {
      changeId: change?.id,
      filePath: change?.relativePath || change?.file,
      stage: change?.stage,
      refreshKey,
      loadGeneration: thisLoadGeneration,
      forceFresh,
    });

    loading = true;
    error = null;
    contentTooLarge = false;
    contentSize = 0;
    loadTimedOut = false;
    isBinaryFile = false;
    noChangesAtStage = false;

    // Clear existing content first to ensure clean state
    oldContent = '';
    newContent = '';

    // Store this as the current load generation
    currentLoadGeneration = thisLoadGeneration;

    // Clear any previous timeout
    if (loadTimeoutId) {
      clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }

    // Set a timeout to prevent infinite loading - this will set state to show timeout UI
    loadTimeoutId = setTimeout(() => {
      if (loading) {
        logger.warn('Diff loading timed out', {
          file: change.relativePath || change.file,
          timeout: DIFF_LOAD_TIMEOUT_MS,
        });
        loadTimedOut = true;
        loading = false;
        error = null;
      }
    }, DIFF_LOAD_TIMEOUT_MS);

    try {
      // Log the change object to debug
      logger.debug('Loading diff for change', {
        change,
        relativePath: change.relativePath,
        file: change.file,
        stage: change.stage,
        workspaceId,
      });

      // Get workspace path - use the workspaceId prop to find the correct workspace
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      // Log workspace details for debugging remote workspaces
      logger.info('MonacoDiffViewer: workspace lookup', {
        workspaceId,
        foundWorkspace: !!workspace,
        isRemote: workspace?.isRemote,
        worktreePath: workspace?.worktreePath,
        repositoryPath: workspace?.repositoryPath,
        resolvedWorkspacePath: workspacePath,
      });

      if (!workspacePath) {
        throw new Error('No space path available');
      }

      // Helper to check and handle content size limits
      const checkContentSize = (old: string, newer: string): boolean => {
        const totalSize = (old?.length || 0) + (newer?.length || 0);
        if (totalSize > MAX_CONTENT_SIZE_BYTES) {
          contentTooLarge = true;
          contentSize = totalSize;
          logger.warn('Content too large to display in diff viewer', {
            size: totalSize,
            maxSize: MAX_CONTENT_SIZE_BYTES,
            file: change.relativePath || change.file,
          });
          return false;
        }
        return true;
      };

      // Helper to detect if content is raw git diff format (not actual file content)
      const isRawGitDiff = (content: string): boolean => {
        if (!content) return false;
        const trimmed = content.trim();
        // Check for git diff headers at the start of content
        return (
          trimmed.startsWith('diff --git ') ||
          trimmed.startsWith('index ') ||
          trimmed.startsWith('--- a/') ||
          trimmed.startsWith('+++ b/') ||
          /^@@\s+-\d+/.test(trimmed)
        );
      };

      // If content is already provided, use it (but skip if it's raw git diff format)
      // IMPORTANT: Only use provided content if BOTH oldContent AND newContent are explicitly set.
      // If only newContent is set (without oldContent), we should fetch git:diff to get the proper
      // old content from git. Otherwise, the entire file would appear as "new" which is incorrect
      // for modified files. The exception is for truly new/untracked files, but git:diff will
      // correctly return empty old content for those.
      // When forceFresh is true, always fetch from git to get the latest content
      const oldContentValue = change.content?.oldContent || '';
      const newContentValue = change.content?.newContent || '';

      // Check if this is full file content from git:diff (not snippet content from tool calls)
      const isFullFileContentFromGit = change.content?.isFullFileContent === true;

      // Only consider content as "provided" if BOTH are explicitly set (not just one)
      // This ensures we fetch git:diff for modified files where only newContent was populated
      // Skip provided content when forceFresh is true (e.g., after external file changes)
      // IMPORTANT: When isFullFileContent is true, ALWAYS fetch fresh from git to ensure
      // we show the latest state. The props content might be stale if the parent component
      // hasn't re-fetched after external file changes.
      const hasProvidedContent =
        !forceFresh &&
        !isFullFileContentFromGit && // Always fetch fresh for full file content
        change.content?.oldContent !== undefined &&
        change.content?.newContent !== undefined &&
        (oldContentValue.length > 0 || newContentValue.length > 0);

      // Skip provided content if it looks like raw git diff output
      const contentIsRawDiff = isRawGitDiff(oldContentValue) || isRawGitDiff(newContentValue);

      if (hasProvidedContent && !contentIsRawDiff) {
        // Check content size before using
        if (!checkContentSize(oldContentValue, newContentValue)) {
          loading = false;
          return;
        }

        // This branch is only for snippet content from tool calls (not full file content)
        // Full file content always goes through the else branch to fetch fresh from git
        isSnippetContent = true;
        // Store the original "new" content so we can find it in the file when saving edits
        // This must be stored BEFORE any edits are made
        originalSnippetContent = newContentValue;
        logger.debug('Using provided snippet content', {
          oldLen: oldContentValue.length,
          newLen: newContentValue.length,
        });

        // Make sure we're updating the state properly
        oldContent = oldContentValue;
        newContent = newContentValue;
      } else {
        // Fetching full file content from git - auto-save is safe
        isSnippetContent = false;
        originalSnippetContent = null; // Clear since we're not using snippet content
        if (isFullFileContentFromGit) {
          logger.debug('Fetching fresh content from git (isFullFileContent=true)', {
            filePath: change.relativePath || change.file,
            stage: change.stage,
          });
        }
        if (contentIsRawDiff) {
          logger.warn('Skipping provided content because it looks like raw git diff format', {
            oldContentPreview: oldContentValue.substring(0, 100),
            newContentPreview: newContentValue.substring(0, 100),
          });
        }
        // Fetch the git diff for this file
        let filePath = change.relativePath || change.file;

        // If file path is absolute, convert to relative
        if (filePath.startsWith('/')) {
          // First try: check if it starts with the current workspace path (with directory boundary check)
          const strippedPath = workspacePath
            ? stripWorkspacePrefix(filePath, workspacePath)
            : filePath;
          if (strippedPath !== filePath) {
            filePath = strippedPath;
          } else {
            // Second try: extract just the filename/relative part from any absolute path
            // This handles cases where the path is from a different workspace
            // Look for common workspace path patterns like ~/intent/*/project/* or just use the last component
            const workspacesMatch = filePath.match(/(?:intent|\.workspaces)\/[^/]+\/[^/]+\/(.+)$/);
            if (workspacesMatch) {
              filePath = workspacesMatch[1];
            } else {
              // Last resort: just use the basename
              const parts = filePath.split('/');
              filePath = parts[parts.length - 1];
            }
            logger.warn('Converted absolute path to relative', {
              original: change.relativePath || change.file,
              converted: filePath,
              workspacePath,
            });
          }
        }

        // Debug: log the change object to see what we're working with
        logger.debug('DiffViewer loadDiff: change details', {
          stage: change.stage,
          commitHash: change.commitHash,
          filePath,
          originalFile: change.file,
          relativePath: change.relativePath,
        });

        // Handle committed files differently - use commit hash to get diff
        if (change.stage === 'committed' && change.commitHash) {
          logger.debug('Loading diff for committed file', {
            workspaceId: workspaceId || workspace?.id,
            filePath,
            originalFilePath: change.relativePath || change.file,
            commitHash: change.commitHash,
            workspacePath,
          });

          // Get the file content at the commit and its parent
          try {
            // Get content at the commit
            logger.debug('Fetching new content at commit', { filePath, ref: change.commitHash });
            const newContentResult = (await invoke('git:show-file', {
              workspaceId: workspaceId || workspace?.id,
              filePath,
              ref: change.commitHash,
            })) as { success: boolean; data?: string; error?: string };

            logger.debug('New content result', {
              success: newContentResult?.success,
              error: newContentResult?.error,
              dataLength: newContentResult?.data?.length,
            });

            // Get content at the parent commit
            logger.debug('Fetching old content at parent commit', {
              filePath,
              ref: `${change.commitHash}^`,
            });
            const oldContentResult = (await invoke('git:show-file', {
              workspaceId: workspaceId || workspace?.id,
              filePath,
              ref: `${change.commitHash}^`,
            })) as { success: boolean; data?: string; error?: string };

            logger.debug('Old content result', {
              success: oldContentResult?.success,
              error: oldContentResult?.error,
              dataLength: oldContentResult?.data?.length,
            });

            // Check for errors
            if (!newContentResult?.success && newContentResult?.error) {
              logger.error('Failed to get new content', {
                error: newContentResult.error,
                filePath,
                ref: change.commitHash,
              });
              error = `Failed to load file at commit: ${newContentResult.error}`;
            } else if (!oldContentResult?.success && oldContentResult?.error) {
              // Old content might fail for new files (first commit), that's ok
              logger.debug('Could not get old content (may be new file)', {
                error: oldContentResult.error,
              });
              oldContent = '';
              newContent = newContentResult?.data || '';
            } else {
              oldContent = oldContentResult?.data || '';
              newContent = newContentResult?.data || '';
            }

            logger.debug('Loaded committed file diff', {
              hasOldContent: !!oldContent,
              hasNewContent: !!newContent,
              oldContentLength: oldContent.length,
              newContentLength: newContent.length,
            });
          } catch (err) {
            logger.error('Failed to load committed file diff', {
              error: err,
              filePath,
              commitHash: change.commitHash,
            });
            error = `Failed to load committed file diff: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          // Handle staged/unstaged files with git:diff
          const stagedValue = change.stage === 'staged';
          logger.info('MonacoDiffViewer: Calling git:diff for staged/unstaged file', {
            workspaceId: workspaceId || workspace?.id,
            paths: [filePath],
            changeStage: change.stage,
            stagedValue,
            workspacePath,
            isRemote: workspace?.isRemote,
          });

          const diffResult = (await invoke('git:diff', {
            workspaceId: workspaceId || workspace?.id,
            paths: [filePath],
            staged: stagedValue,
          })) as any;

          logger.info('MonacoDiffViewer: git:diff result', {
            success: diffResult?.success,
            dataLength: diffResult?.data?.length,
            error: diffResult?.error,
            firstChunk: diffResult?.data?.[0]
              ? {
                  file: diffResult.data[0].file,
                  hasOldContent: diffResult.data[0].oldContent !== undefined,
                  hasNewContent: diffResult.data[0].newContent !== undefined,
                  oldContentLength: diffResult.data[0].oldContent?.length,
                  newContentLength: diffResult.data[0].newContent?.length,
                  chunksLength: diffResult.data[0].chunks?.length,
                }
              : null,
          });

          if (diffResult?.success && diffResult?.data?.length > 0) {
            // The git:diff returns DiffChunk[] in data
            const diffChunk = diffResult.data[0];

            // Check if the chunk has valid oldContent and newContent properties
            // For modifications, both should be non-empty. If oldContent is empty but
            // newContent has data, it's likely a bug and we should use the fallback.
            const hasValidOldContent =
              diffChunk.oldContent !== undefined && diffChunk.oldContent !== '';
            const hasValidNewContent =
              diffChunk.newContent !== undefined && diffChunk.newContent !== '';
            // TrackedChange uses 'status' property, not 'type'
            const isModification = change.status === 'modified' || diffChunk.type === 'modified';

            // Use the diff chunk content if both are valid, OR if this is not a modification
            // (e.g., new file has empty oldContent, deleted file has empty newContent)
            if (hasValidOldContent && hasValidNewContent) {
              oldContent = diffChunk.oldContent || '';
              newContent = diffChunk.newContent || '';
            } else if (
              !isModification &&
              diffChunk.oldContent !== undefined &&
              diffChunk.newContent !== undefined
            ) {
              // For new/deleted files, empty content is expected
              oldContent = diffChunk.oldContent || '';
              newContent = diffChunk.newContent || '';
            } else if (diffChunk.chunks && diffChunk.chunks.length > 0) {
              // Parse the diff chunks to reconstruct old and new content
              // The chunks contain diff hunks with lines marked as addition/deletion/context
              logger.info('Reconstructing content from diff chunks (fallback path)', {
                chunksLength: diffChunk.chunks.length,
                file: diffChunk.file,
                stage: change.stage,
                isStaged: stagedValue,
              });

              // Try to reconstruct by reading both old (from git) and new (from file) content
              try {
                // For staged diff: old = HEAD, new = INDEX
                // For unstaged diff: old = INDEX (or HEAD if no staged changes), new = WORKING_DIR
                // Use :0:filename to get from index, HEAD:filename for HEAD
                const gitRef = stagedValue ? 'HEAD' : ':0';

                logger.info('Fetching old content from git', { gitRef, filePath });

                const oldContentResult = (await invoke('git:show-file', {
                  workspaceId: workspaceId || workspace?.id,
                  filePath,
                  ref: gitRef,
                })) as { success: boolean; data?: string; error?: string };

                if (oldContentResult?.success && oldContentResult?.data !== undefined) {
                  oldContent = oldContentResult.data;
                  logger.info('Got old content from git', {
                    gitRef,
                    contentLength: oldContent.length,
                  });
                } else {
                  // If index doesn't have the file, try HEAD as fallback
                  logger.warn('Failed to get content from git ref, trying HEAD', {
                    gitRef,
                    error: oldContentResult?.error,
                  });
                  if (gitRef !== 'HEAD') {
                    const headResult = (await invoke('git:show-file', {
                      workspaceId: workspaceId || workspace?.id,
                      filePath,
                      ref: 'HEAD',
                    })) as { success: boolean; data?: string; error?: string };

                    if (headResult?.success && headResult?.data !== undefined) {
                      oldContent = headResult.data;
                      logger.info('Got old content from HEAD fallback', {
                        contentLength: oldContent.length,
                      });
                    }
                  }
                }

                // Get new content based on stage
                if (stagedValue) {
                  // For staged diff, new content is from the index
                  const indexResult = (await invoke('git:show-file', {
                    workspaceId: workspaceId || workspace?.id,
                    filePath,
                    ref: ':0',
                  })) as { success: boolean; data?: string; error?: string };

                  if (indexResult?.success && indexResult?.data !== undefined) {
                    newContent = indexResult.data;
                  }
                } else {
                  // For unstaged diff, new content is from the working directory
                  const fileReadResult = (await invoke('file:read', {
                    workspaceId: workspaceId || workspace?.id,
                    path: `${workspacePath}/${filePath}`,
                  })) as
                    | { success: boolean; data?: { content: string } | string; error?: string }
                    | string
                    | null;

                  const currentContent =
                    typeof fileReadResult === 'string'
                      ? fileReadResult
                      : fileReadResult?.success && fileReadResult?.data
                        ? typeof fileReadResult.data === 'string'
                          ? fileReadResult.data
                          : fileReadResult.data.content
                        : null;

                  newContent = currentContent || '';
                }
              } catch (reconstructError) {
                logger.warn('Failed to reconstruct diff content', { error: reconstructError });
                // Fall back to showing current file on both sides (no diff visible)
                const fileReadResult = (await invoke('file:read', {
                  workspaceId: workspaceId || workspace?.id,
                  path: `${workspacePath}/${filePath}`,
                })) as
                  | { success: boolean; data?: { content: string } | string; error?: string }
                  | string
                  | null;

                const currentContent =
                  typeof fileReadResult === 'string'
                    ? fileReadResult
                    : fileReadResult?.success && fileReadResult?.data
                      ? typeof fileReadResult.data === 'string'
                        ? fileReadResult.data
                        : fileReadResult.data.content
                      : null;

                // Show identical content to indicate we couldn't determine the diff
                oldContent = currentContent || '';
                newContent = currentContent || '';
              }
            } else if (diffChunk.isBinary) {
              // Binary file - can't display as text diff
              logger.info('Binary file detected, showing binary file message', {
                file: diffChunk.file,
              });
              isBinaryFile = true;
              loading = false;
              return;
            } else {
              // Diff chunk has no usable content - this shouldn't happen normally
              // Show an error rather than misleading all-green diff
              logger.warn('Diff chunk has no content or chunks', { diffChunk });
              error = 'Unable to display diff: diff data is incomplete';
              loading = false;
              return;
            }
          } else {
            // No diff content returned - this likely means the file has no changes for this stage
            // For example, if viewing unstaged changes but the file was fully staged,
            // git diff (without --cached) returns empty
            logger.info('No diff changes found for this stage', {
              success: diffResult?.success,
              dataLength: diffResult?.data?.length,
              error: diffResult?.error,
              stage: change.stage,
              filePath,
            });

            // Set the flag to show a helpful message instead of empty/confusing diff
            noChangesAtStage = true;
            oldContent = '';
            newContent = '';
            loading = false;
            return;
          }
        }
      }

      // Check content size before rendering
      if (!checkContentSize(oldContent, newContent)) {
        // Clear content to free memory - we won't be rendering it
        oldContent = '';
        newContent = '';
        loading = false;
        return;
      }

      // Check if this load is still the current one (newer loads may have started)
      if (thisLoadGeneration !== currentLoadGeneration) {
        logger.info('Discarding stale load result', {
          thisLoadGeneration,
          currentLoadGeneration,
          changeId: change?.id,
        });
        return;
      }

      logger.debug('loadDiffContent completed', {
        changeId: change?.id,
        oldContentLength: oldContent.length,
        newContentLength: newContent.length,
        noChangesAtStage,
        hasEditor: !!editor,
        loadGeneration: thisLoadGeneration,
      });

      // Only update the diff if the editor already exists
      if (editor) {
        logger.debug('Calling updateDiff from loadDiffContent');
        updateDiff();
      } else {
        logger.debug('Editor not ready, updateDiff will be called when editor is created');
      }
    } catch (err) {
      logger.error('Failed to load diff content', err as Error);
      error = err instanceof Error ? err.message : 'Failed to load diff';
      oldContent = '';
      newContent = '';
    } finally {
      // Clear the timeout
      if (loadTimeoutId) {
        clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      loading = false;
    }
  }

  function updateDiff() {
    if (!editor || isDisposing || isUpdating) {
      logger.debug('updateDiff skipped', { hasEditor: !!editor, isDisposing, isUpdating });
      return;
    }

    logger.debug('updateDiff executing', {
      oldContentLength: (oldContent || '').length,
      newContentLength: (newContent || '').length,
      changeId: change?.id,
    });

    // Set updating flag to prevent concurrent updates
    isUpdating = true;

    // Ensure oldContent and newContent are strings before calling string methods
    const oldContentStr = String(oldContent || '');
    const newContentStr = String(newContent || '');

    // Cancel any pending update
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }

    // Save scroll position before updating
    const modifiedEditor = editor.getModifiedEditor();
    const originalEditor = editor.getOriginalEditor();
    const savedScrollTop = modifiedEditor.getScrollTop();
    const savedScrollLeft = modifiedEditor.getScrollLeft();

    // Try to update existing models in-place to preserve scroll position
    const currentModel = editor.getModel();
    if (currentModel?.original && currentModel?.modified) {
      const currentOriginalContent = currentModel.original.getValue();
      const currentModifiedContent = currentModel.modified.getValue();

      // If content hasn't changed, skip the update
      if (currentOriginalContent === oldContentStr && currentModifiedContent === newContentStr) {
        logger.debug('updateDiff: Content unchanged, skipping update');
        isUpdating = false;
        return;
      }

      // Update models in-place using applyEdits for minimal disruption
      // This preserves scroll position and cursor state
      try {
        // Update original model
        if (currentOriginalContent !== oldContentStr) {
          currentModel.original.setValue(oldContentStr);
        }

        // Update modified model
        if (currentModifiedContent !== newContentStr) {
          currentModel.modified.setValue(newContentStr);
        }

        logger.debug('updateDiff: Updated models in-place');

        // Restore scroll position after a short delay
        requestAnimationFrame(() => {
          if (editor && !isDisposing) {
            try {
              modifiedEditor.setScrollTop(savedScrollTop);
              modifiedEditor.setScrollLeft(savedScrollLeft);
              originalEditor.setScrollTop(savedScrollTop);
              originalEditor.setScrollLeft(savedScrollLeft);
              editor.layout();
              addOriginalLineNumberDecorations();
            } catch (err) {
              logger.warn('[DiffViewer] Error restoring scroll position:', err);
            }
          }
          isUpdating = false;
        });
        return;
      } catch (err) {
        logger.warn(
          '[DiffViewer] Failed to update models in-place, falling back to full replace:',
          err,
        );
        // Fall through to full model replacement
      }
    }

    // Full model replacement (for initial load or when in-place update fails)
    // Determine file language from extension
    // Handle special cases like .prettierrc (no extension but should be JSON)
    let ext = change.file ? change.file.split('.').pop()?.toLowerCase() || 'txt' : 'txt';

    // Check if this is a dotfile without extension
    const filename = change.file ? change.file.split('/').pop() || '' : '';
    if (filename && filename.startsWith('.') && !filename.includes('.', 1)) {
      // It's a dotfile without extension like .prettierrc, .eslintrc
      ext = filename.substring(1); // Remove the leading dot
    }

    const language = getLanguageFromExtension(ext);

    // Create unique URIs for the models using inmemory scheme
    // The inmemory:// scheme is configured to skip TypeScript diagnostics in monaco-workers.ts
    const timestamp = Date.now();
    // Sanitize the path to ensure it's a valid URI component
    // Remove leading slashes to prevent double slashes in the URI (e.g., inmemory://model/original//Users/...)
    // and encode special characters
    const sanitizedPath = encodeURIComponent(
      (change.relativePath || change.file || 'untitled').replace(/^\/+/, ''),
    );
    const originalUri = monaco.Uri.parse(
      `inmemory://model/original/${sanitizedPath}?t=${timestamp}`,
    );
    const modifiedUri = monaco.Uri.parse(
      `inmemory://model/modified/${sanitizedPath}?t=${timestamp}`,
    );

    // Don't manually dispose models - let Monaco handle it when we setModel
    // This prevents the "TextModel got disposed before DiffEditorWidget model got reset" error

    // Create new models - ensure content is never undefined
    // Use the already converted string values from above
    const originalModel = monaco.editor.createModel(oldContentStr, language, originalUri);
    const modifiedModel = monaco.editor.createModel(newContentStr, language, modifiedUri);

    try {
      logger.debug('updateDiff: Setting models', {
        originalModelValid: !!originalModel,
        modifiedModelValid: !!modifiedModel,
        originalValueLength: originalModel?.getValue()?.length,
        modifiedValueLength: modifiedModel?.getValue()?.length,
      });

      // First, clear the current model to avoid disposal conflicts
      // Use requestAnimationFrame to let Monaco finish its current render cycle
      // This prevents "Illegal value for lineNumber" errors when content changes significantly
      requestAnimationFrame(() => {
        if (!editor || isDisposing) {
          // Clean up models if we're disposing
          try {
            originalModel.dispose();
            modifiedModel.dispose();
          } catch {
            // Ignore disposal errors
          }
          isUpdating = false;
          return;
        }

        try {
          // Temporarily disable hideUnchangedRegions during model swap to prevent
          // the "isInHiddenArea" race condition where ViewLine.render tries to
          // access hidden-area data that is stale/undefined during the transition.
          editor.updateOptions({
            hideUnchangedRegions: { enabled: false },
          });

          editor.setModel(null);

          // Then set the new models
          editor.setModel({
            original: originalModel,
            modified: modifiedModel,
          });

          logger.debug('updateDiff: Models set successfully', {
            hasModel: !!editor.getModel(),
            originalModel: !!editor.getModel()?.original,
            modifiedModel: !!editor.getModel()?.modified,
          });

          // Update options - keep sleek styling
          editor.updateOptions({
            renderSideBySide: renderSideBySide,
            ignoreTrimWhitespace: false,
          });

          // Trigger layout after a short delay to let Monaco stabilize
          // Also restore scroll position and re-enable hideUnchangedRegions
          setTimeout(() => {
            if (editor && !isDisposing) {
              try {
                // Re-enable hideUnchangedRegions now that models are stable
                editor.updateOptions({
                  hideUnchangedRegions: {
                    enabled: foldUnchanged,
                    revealLineCount: 40,
                    minimumLineCount: 1,
                    contextLineCount: 3,
                  },
                });
                editor.layout();
                // Restore scroll position
                const modEditor = editor.getModifiedEditor();
                const origEditor = editor.getOriginalEditor();
                modEditor.setScrollTop(savedScrollTop);
                modEditor.setScrollLeft(savedScrollLeft);
                origEditor.setScrollTop(savedScrollTop);
                origEditor.setScrollLeft(savedScrollLeft);
                // Add original line number decorations after diff is computed
                addOriginalLineNumberDecorations();
              } catch (layoutErr) {
                logger.warn('[DiffViewer] Layout error (non-fatal):', layoutErr);
              }
            }
            isUpdating = false;
          }, 50);
        } catch (err) {
          logger.error('[DiffViewer] Error setting models in RAF:', err);
          // Restore hideUnchangedRegions so fold regions aren't permanently lost
          try {
            editor?.updateOptions({
              hideUnchangedRegions: {
                enabled: foldUnchanged,
                revealLineCount: 40,
                minimumLineCount: 1,
                contextLineCount: 3,
              },
            });
          } catch {
            // Ignore - editor may be in bad state
          }
          isUpdating = false;
        }
      });

      // Note: Monaco's diff editor handles diff highlighting natively with proper LCS algorithm.
      // We removed the custom addDiffDecorations call which was doing naive line-by-line
      // comparison that broke when lines were inserted or deleted.
    } catch (err) {
      logger.error('[DiffViewer] Error preparing models:', err);
      isUpdating = false;
    }
  }

  // Track decorations for original line numbers
  let originalLineNumberDecorations: monaco.editor.IEditorDecorationsCollection | null = null;

  /**
   * Add decorations showing original line numbers on deleted/changed lines.
   * This provides context for which lines in the original file were affected.
   */
  function addOriginalLineNumberDecorations() {
    if (!editor || isDisposing) return;

    // Get the line changes from the diff
    const lineChanges = editor.getLineChanges();
    if (!lineChanges || lineChanges.length === 0) {
      // Try again after a short delay (diff might not be computed yet)
      setTimeout(() => {
        if (editor && !isDisposing) {
          const changes = editor.getLineChanges();
          if (changes && changes.length > 0) {
            applyOriginalLineDecorations(changes);
          }
        }
      }, 200);
      return;
    }

    applyOriginalLineDecorations(lineChanges);
  }

  function applyOriginalLineDecorations(lineChanges: readonly monaco.editor.ILineChange[]) {
    if (!editor || isDisposing) return;

    const modifiedEditor = editor.getModifiedEditor();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];

    for (const change of lineChanges) {
      // For deletions (originalStartLineNumber to originalEndLineNumber are deleted)
      // These appear as inline-deleted view zones in the modified editor
      if (
        change.originalStartLineNumber > 0 &&
        change.originalEndLineNumber >= change.originalStartLineNumber
      ) {
        const origStart = change.originalStartLineNumber;
        const origEnd = change.originalEndLineNumber;

        // If this is a pure deletion (no corresponding modified lines)
        // or a modification, show the original line range
        if (change.modifiedStartLineNumber > 0) {
          // This is a modification - show original line number as subtle annotation
          const lineNum = change.modifiedStartLineNumber;
          const origRange = origStart === origEnd ? `${origStart}` : `${origStart}-${origEnd}`;

          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: false,
              glyphMarginClassName: 'original-line-number-glyph',
              glyphMarginHoverMessage: {
                value: `Original line${origStart !== origEnd ? 's' : ''}: ${origRange}`,
              },
              beforeContentClassName: 'original-line-indicator',
            },
          });
        }
      }
    }

    // Clear old decorations and apply new ones
    if (originalLineNumberDecorations) {
      originalLineNumberDecorations.clear();
    }
    if (decorations.length > 0) {
      originalLineNumberDecorations = modifiedEditor.createDecorationsCollection(decorations);
    }
  }

  // Note: Monaco's diff editor handles diff highlighting natively with proper LCS algorithm.
  // We removed the custom addDiffDecorations function which was doing naive line-by-line
  // comparison that broke when lines were inserted or deleted.

  /**
   * Refresh snippet content from file when external changes are detected.
   * This finds the current snippet in the file and updates the Monaco model.
   *
   * When another panel edits the same snippet, we need to:
   * 1. Find where our original snippet was in the file
   * 2. Check if it's been replaced with new content
   * 3. Update our Monaco model and originalSnippetContent to match
   */
  async function refreshSnippetFromFile() {
    if (!editor || isDisposing || !originalSnippetContent) {
      return;
    }

    const currentModel = editor.getModel();
    if (!currentModel?.modified) {
      return;
    }

    try {
      // Get the absolute file path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) return;

      let filePath = change?.relativePath || change?.file;
      if (!filePath) return;

      // Build absolute path
      const absolutePath = filePath.startsWith('/') ? filePath : `${workspacePath}/${filePath}`;

      // Read the current file content
      const fileResult = (await invoke('file:read', {
        workspaceId: workspaceId || workspace?.id,
        path: absolutePath,
      })) as {
        success: boolean;
        data?: { content: string; stats: { size: number; modified: string } };
        error?: { code: string; message: string } | string;
      };

      if (!fileResult?.success || !fileResult.data?.content) {
        logger.debug('refreshSnippetFromFile: Could not read file');
        return;
      }

      const fullFileContent = fileResult.data.content;

      // Find the original snippet in the file
      const snippetIndex = fullFileContent.indexOf(originalSnippetContent);

      if (snippetIndex === -1) {
        // The original snippet is no longer in the file - it was edited elsewhere
        // This means another panel edited the same snippet we're showing
        // We need to find what replaced it

        // Get the current content in our Monaco model
        const currentEditorContent = currentModel.modified.getValue();

        // Check if the current editor content is in the file
        // (This would mean another panel saved the same edit we have)
        const currentContentIndex = fullFileContent.indexOf(currentEditorContent);

        if (currentContentIndex !== -1) {
          // Our current content is in the file - update originalSnippetContent to match
          logger.info(
            'refreshSnippetFromFile: Current content found in file, updating originalSnippetContent',
          );
          originalSnippetContent = currentEditorContent;
          return;
        }

        // Neither original nor current content found - file was edited differently
        // We can't automatically reconcile, so log and return
        logger.debug(
          'refreshSnippetFromFile: Original snippet not found in file, may have been edited differently',
        );
        return;
      }

      // The original snippet is still in the file - check if our editor content matches
      const currentEditorContent = currentModel.modified.getValue();
      if (currentEditorContent !== originalSnippetContent) {
        // We have local edits that haven't been saved yet - don't overwrite them
        logger.debug('refreshSnippetFromFile: Local edits present, not refreshing');
        return;
      }

      // The snippet is unchanged in both file and editor - no update needed
      logger.debug('refreshSnippetFromFile: Snippet unchanged');
    } catch (err) {
      logger.warn('refreshSnippetFromFile: Error reading file', err);
    }
  }

  /**
   * Refresh content in-place without going through loading state.
   * This preserves scroll position and prevents component re-renders.
   * Used when external file changes are detected.
   */
  async function refreshContentInPlace() {
    if (!editor || isDisposing || !change) {
      logger.debug('refreshContentInPlace skipped', {
        hasEditor: !!editor,
        isDisposing,
        hasChange: !!change,
      });
      return;
    }

    logger.debug('refreshContentInPlace called', {
      isSnippetContent,
      isSavingFromEditor,
      hasOriginalSnippetContent: !!originalSnippetContent,
    });

    // For snippet content, we need special handling.
    // We can't just fetch full file content because that would replace the snippet.
    // Instead, we need to check if the snippet still exists in the file and update
    // our originalSnippetContent if the file was edited elsewhere.
    if (isSnippetContent) {
      // If WE just saved, skip entirely - our content is already correct
      if (isSavingFromEditor) {
        logger.debug('refreshContentInPlace: Skipping for snippet content (our own save)');
        return;
      }

      // For external changes, we need to update the snippet content if it changed.
      // Read the file and find the updated snippet location.
      logger.debug('refreshContentInPlace: Calling refreshSnippetFromFile for snippet content');
      await refreshSnippetFromFile();
      // Record timestamp to suppress redundant refreshKey loads
      lastInPlaceRefreshTimestamp = Date.now();
      return;
    }

    const currentModel = editor.getModel();
    if (!currentModel?.original || !currentModel?.modified) {
      logger.debug('refreshContentInPlace: No models available, falling back to loadDiffContent');
      void loadDiffContent(true).catch((err) => {
        logger.warn('loadDiffContent failed (refresh fallback)', err);
      });
      return;
    }

    try {
      // Save scroll position before updating
      const modifiedEditor = editor.getModifiedEditor();
      const originalEditor = editor.getOriginalEditor();
      const savedScrollTop = modifiedEditor.getScrollTop();
      const savedScrollLeft = modifiedEditor.getScrollLeft();

      // Get workspace path
      const workspace = workspaceId
        ? workspaceStore.findById(WorkspaceId(workspaceId))
        : workspaceStore.current;
      const workspacePath = workspace?.worktreePath || workspace?.repositoryPath;

      if (!workspacePath) {
        logger.warn('refreshContentInPlace: No workspace path available');
        return;
      }

      // Get file path
      let filePath = change.relativePath || change.file;
      if (!filePath) {
        logger.warn('refreshContentInPlace: No file path available');
        return;
      }

      // Convert absolute path to relative if needed
      if (filePath.startsWith('/')) {
        const strippedPath = workspacePath
          ? stripWorkspacePrefix(filePath, workspacePath)
          : filePath;
        if (strippedPath !== filePath) {
          filePath = strippedPath;
        } else {
          const workspacesMatch = filePath.match(/(?:intent|\.workspaces)\/[^/]+\/[^/]+\/(.+)$/);
          if (workspacesMatch) {
            filePath = workspacesMatch[1];
          }
        }
      }

      let fetchedOldContent: string | null = null;
      let fetchedNewContent: string | null = null;

      // Fetch fresh content based on change stage
      if (change.stage === 'committed' && change.commitHash) {
        // Get content at commit and parent
        const [newResult, oldResult] = await Promise.all([
          invoke('git:show-file', {
            workspaceId: workspaceId || workspace?.id,
            filePath,
            ref: change.commitHash,
          }) as Promise<{ success: boolean; data?: string; error?: string }>,
          invoke('git:show-file', {
            workspaceId: workspaceId || workspace?.id,
            filePath,
            ref: `${change.commitHash}^`,
          }) as Promise<{ success: boolean; data?: string; error?: string }>,
        ]);

        fetchedNewContent = newResult?.success ? (newResult.data ?? '') : null;
        fetchedOldContent = oldResult?.success ? (oldResult.data ?? '') : '';
      } else {
        // Staged/unstaged - use git:diff
        const stagedValue = change.stage === 'staged';
        const diffResult = (await invoke('git:diff', {
          workspaceId: workspaceId || workspace?.id,
          paths: [filePath],
          staged: stagedValue,
        })) as any;

        if (diffResult?.success && diffResult?.data?.length > 0) {
          const diffChunk = diffResult.data[0];
          fetchedOldContent = diffChunk.oldContent ?? '';
          fetchedNewContent = diffChunk.newContent ?? '';
        }
      }

      if (fetchedOldContent === null || fetchedNewContent === null) {
        logger.warn('refreshContentInPlace: Failed to fetch content');
        return;
      }

      // Check if content actually changed
      const currentOld = currentModel.original.getValue();
      const currentNew = currentModel.modified.getValue();

      if (currentOld === fetchedOldContent && currentNew === fetchedNewContent) {
        logger.debug('refreshContentInPlace: Content unchanged');
        return;
      }

      logger.info('refreshContentInPlace: Updating models in-place', {
        oldChanged: currentOld !== fetchedOldContent,
        newChanged: currentNew !== fetchedNewContent,
      });

      // Update models in-place using setValue
      // Set flag to prevent auto-save from being triggered by these programmatic changes
      isRefreshingContent = true;
      try {
        if (currentOld !== fetchedOldContent) {
          currentModel.original.setValue(fetchedOldContent);
        }
        if (currentNew !== fetchedNewContent) {
          currentModel.modified.setValue(fetchedNewContent);
        }
      } finally {
        isRefreshingContent = false;
      }

      // Update our state variables to keep them in sync (without triggering re-renders)
      // Use queueMicrotask to batch these updates
      queueMicrotask(() => {
        oldContent = fetchedOldContent!;
        newContent = fetchedNewContent!;
      });

      // Record successful in-place refresh timestamp to suppress redundant refreshKey loads
      lastInPlaceRefreshTimestamp = Date.now();

      // Restore scroll position after a short delay
      requestAnimationFrame(() => {
        if (editor && !isDisposing) {
          try {
            modifiedEditor.setScrollTop(savedScrollTop);
            modifiedEditor.setScrollLeft(savedScrollLeft);
            originalEditor.setScrollTop(savedScrollTop);
            originalEditor.setScrollLeft(savedScrollLeft);
            editor.layout();
            addOriginalLineNumberDecorations();
          } catch (err) {
            // Suppress errors - editor might be disposed
          }
        }
      });
    } catch (err: any) {
      // Suppress "Canceled" errors from Monaco
      if (!err?.message?.includes('Canceled')) {
        logger.warn('refreshContentInPlace error:', err);
      }
    }
  }

  function getLanguageFromExtension(ext: string): string {
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      ps1: 'powershell',
      html: 'html',
      htm: 'html',
      xml: 'xml',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      conf: 'ini',
      sql: 'sql',
      md: 'markdown',
      markdown: 'markdown',
      tex: 'latex',
      r: 'r',
      R: 'r',
      m: 'matlab',
      lua: 'lua',
      vim: 'vim',
      diff: 'diff',
      patch: 'diff',
      svelte: 'html',
      vue: 'html',
      // Common dotfiles
      prettierrc: 'json',
      eslintrc: 'json',
      babelrc: 'json',
      gitignore: 'plaintext',
      dockerignore: 'plaintext',
      env: 'plaintext',
    };

    return languageMap[ext.toLowerCase()] || 'plaintext';
  }

  // Format file size for display
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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
      toast.error('Failed to open file');
    }
  }

  // Reveal file in Finder/Explorer
  async function revealInFolder() {
    const filePath = change.relativePath || change.file;

    if (!filePath) {
      logger.error('Cannot reveal file: missing file path');
      toast.error('Cannot reveal file: missing file path');
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
        toast.error('Cannot reveal file: workspace path unknown');
        return;
      }
      absolutePath = `${workspacePath}/${filePath}`;
    }

    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch (err) {
      logger.error('Failed to reveal file:', err);
      toast.error('Failed to reveal file in folder');
    }
  }
</script>

<div
  class="diff-viewer-container"
  class:compact
  style:height={compact && compactHeight ? `${compactHeight}px` : undefined}
>
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
        {#each Array(16) as _, i}
          <div
            class="diff-skeleton-line"
            class:diff-skeleton-line--added={i % 5 === 2}
            class:diff-skeleton-line--removed={i % 7 === 3}
          >
            <Skeleton class="h-3 w-6 shrink-0" />
            <Skeleton class="h-3" style="width: {40 + ((i * 17) % 50)}%" />
          </div>
        {/each}
      </div>
    </div>
  {:else if contentTooLarge}
    <div class="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div class="text-subtle text-center">
        <!-- <Fa icon={faExclamationTriangle} class="mr-2 text-yellow-500" /> -->
        File too large to display diff ({formatFileSize(contentSize)})
      </div>
      <p class="text-sm text-subtle text-center max-w-md">
        This file exceeds the {formatFileSize(MAX_CONTENT_SIZE_BYTES)} limit for inline diff viewing.
        You can open it in an external editor instead.
      </p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={openInVSCode}>
          <Fa icon={faExternalLinkAlt} />
          Open in VS Code
        </Button>
        <Button variant="ghost" size="sm" onclick={revealInFolder}>
          <Fa icon={faFolderOpen} />
          Reveal in Finder
        </Button>
      </div>
    </div>
  {:else if loadTimedOut}
    <div class="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div class="text-subtle text-center">
        <Fa icon={faExclamationTriangle} class="mr-2 text-yellow-500" />
        Diff loading timed out
      </div>
      <p class="text-sm text-subtle text-center max-w-md">
        The diff took too long to load. This may happen with very large files or slow git
        operations. You can open the file in an external editor instead.
      </p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={openInVSCode}>
          <Fa icon={faExternalLinkAlt} />
          Open in VS Code
        </Button>
        <Button variant="ghost" size="sm" onclick={revealInFolder}>
          <Fa icon={faFolderOpen} />
          Reveal in Finder
        </Button>
      </div>
    </div>
  {:else if isBinaryFile}
    <div class="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div class="text-subtle text-center">Binary file cannot be displayed</div>
      <p class="text-sm text-subtle text-center max-w-md">
        This file is binary and cannot be shown as a text diff. You can open it in an external
        editor instead.
      </p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={openInVSCode}>
          <Fa icon={faExternalLinkAlt} />
          Open in VS Code
        </Button>
        <Button variant="ghost" size="sm" onclick={revealInFolder}>
          <Fa icon={faFolderOpen} />
          Reveal in Finder
        </Button>
      </div>
    </div>
  {:else if error}
    <div class="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div class="text-red-500">
        <Fa icon={faExclamationTriangle} />
        {error}
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={openInVSCode}>
          <Fa icon={faExternalLinkAlt} />
          Open in VS Code
        </Button>
        <Button variant="ghost" size="sm" onclick={revealInFolder}>
          <Fa icon={faFolderOpen} />
          Reveal in Finder
        </Button>
      </div>
    </div>
  {:else if noChangesAtStage}
    <div class="flex flex-col items-center justify-center h-full gap-3 p-6">
      <div class="text-subtle text-center">
        No {change.stage === 'staged' ? 'staged' : 'unstaged'} changes
      </div>
      <p class="text-sm text-subtle text-center max-w-md">
        This file has no {change.stage === 'staged' ? 'staged' : 'unstaged'} changes.
        {#if change.stage === 'unstaged'}
          All changes may have been staged.
        {:else}
          All changes may have been unstaged.
        {/if}
      </p>
      <div class="flex gap-2 mt-2">
        <Button variant="outline" size="sm" onclick={openInVSCode}>
          <Fa icon={faExternalLinkAlt} />
          Open in VS Code
        </Button>
      </div>
    </div>
  {:else}
    <div class="relative flex-1 min-h-0">
      <!-- Agent attribution indicator -->
      {#if change.attribution?.agent}
        <div class="absolute top-2 left-2 z-10">
          <AgentAttributionBadge
            attribution={change.attribution.agent}
            size="sm"
            class="bg-background/90 backdrop-blur-sm border border-border shadow-sm"
          />
        </div>
      {/if}
      {#if foldingStatus === 'folding'}
        <div
          class="absolute top-2 right-2 z-10 px-2 py-1 bg-primary/10 text-primary text-xs rounded animate-pulse"
        >
          Folding unchanged regions...
        </div>
      {:else if foldingStatus === 'folded'}
        <div class="absolute top-2 right-2 z-10 px-2 py-1 bg-muted text-subtle text-xs rounded">
          <Fa icon={faEye} size="sm" class="mr-1" />
          Unchanged regions folded
        </div>
      {/if}
      <div bind:this={container} class="diff-editor-container"></div>
    </div>
  {/if}
</div>

<style>
  .diff-viewer-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .diff-viewer-container.compact {
    /* Default height before measurement, will be overridden by inline style */
    height: 300px;
    transition: height 0.15s ease-out;
  }

  .diff-editor-container {
    flex: 1;
    min-height: 600px;
    height: 100%;
    overflow: hidden;
  }

  .compact .diff-editor-container {
    min-height: 0;
    height: 100%;
  }

  /* Hide Monaco's built-in diff editor headers and unnecessary chrome */
  :global(.diff-editor-container .monaco-diff-editor .editor-modified-header),
  :global(.diff-editor-container .monaco-diff-editor .editor-original-header),
  :global(.diff-editor-container .monaco-diff-editor .diffEditor-header),
  :global(.diff-editor-container .monaco-diff-editor .diff-editor-header) {
    display: none !important;
  }

  /* Hide gutter decorations for cleaner look */
  :global(.diff-editor-container .monaco-diff-editor .insert-sign),
  :global(.diff-editor-container .monaco-diff-editor .delete-sign) {
    display: none !important;
  }

  /* Hide the diff overview ruler/gutter */
  :global(.diff-editor-container .monaco-diff-editor .diffOverview) {
    display: none !important;
  }

  /* Sleek line number styling */
  :global(.diff-editor-container .monaco-editor .line-numbers) {
    color: hsl(var(--text-ghost)) !important;
    font-size: 12px !important;
  }

  /* ===== PIERRE-STYLE DIFF: SINGLE LINE NUMBER COLUMN ===== */

  /* In inline diff mode, Monaco renders deleted lines as view zones with their own
     line numbers. We need to hide these original line numbers while keeping the
     modified (new) line numbers visible.

     The inline diff structure has:
     - .view-zone elements for deleted lines (with their own line numbers)
     - Regular lines for the modified content

     We hide line numbers in the view zones (deleted lines) */

  /* Hide line numbers in inline-deleted view zones */
  :global(.diff-editor-container .monaco-diff-editor .view-zone .line-numbers),
  :global(.diff-editor-container .monaco-diff-editor .inline-deleted-text-view-zone .line-numbers),
  :global(.diff-editor-container .monaco-diff-editor .view-zones .line-numbers) {
    display: none !important;
  }

  /* Hide the entire margin for view zones (deleted lines) */
  :global(.diff-editor-container .monaco-diff-editor .view-zone .margin),
  :global(.diff-editor-container .monaco-diff-editor .view-zone .margin-view-overlays) {
    display: none !important;
  }

  /* Hide the inline-deleted margin view zones */
  :global(.diff-editor-container .monaco-diff-editor .inline-deleted-margin-view-zone) {
    display: none !important;
  }

  /* Hide the diff gutter completely (revert buttons) - disabled via renderGutterMenu: false */
  :global(.diff-editor-container .monaco-diff-editor .gutter) {
    display: none !important;
  }

  /* Hide other diff review elements we don't need */
  :global(.diff-editor-container .monaco-diff-editor .diff-review-actions),
  :global(.diff-editor-container .monaco-diff-editor .codicon-diff-review-close) {
    display: none !important;
  }

  /* Hide the diff gutter decorations (the colored bars) */
  :global(.diff-editor-container .monaco-diff-editor .diff-gutter),
  :global(.diff-editor-container .monaco-diff-editor .diffLineGutter) {
    display: none !important;
  }

  /* Line-level styling - NO background, just clean text */
  :global(.diff-editor-container .monaco-diff-editor .line-insert),
  :global(.diff-editor-container .monaco-editor .line-insert) {
    background-color: transparent !important;
    border: none !important;
  }

  :global(.diff-editor-container .monaco-diff-editor .line-delete),
  :global(.diff-editor-container .monaco-editor .line-delete) {
    background-color: transparent !important;
    border: none !important;
  }

  /* Character-level highlights - dark theme defaults */
  :global(.diff-editor-container .monaco-diff-editor .char-insert),
  :global(.diff-editor-container .monaco-editor .char-insert) {
    background-color: rgba(34, 197, 94, 0.2) !important;
    border: none;
  }

  :global(.diff-editor-container .monaco-diff-editor .char-delete),
  :global(.diff-editor-container .monaco-editor .char-delete) {
    background-color: rgba(239, 68, 68, 0.2) !important;
    border: none;
  }

  /* Inline deleted text styling - strikethrough with subtle background */
  :global(.diff-editor-container .monaco-editor .inline-deleted-text) {
    background-color: rgba(239, 68, 68, 0.15) !important;
    text-decoration: line-through !important;
    text-decoration-color: rgba(239, 68, 68, 0.6) !important;
  }

  /* ===== LIGHT THEME STYLES ===== */
  :global(.light .diff-editor-container .monaco-diff-editor .char-insert),
  :global(.light .diff-editor-container .monaco-editor .char-insert) {
    background-color: rgba(22, 163, 74, 0.25) !important;
  }

  :global(.light .diff-editor-container .monaco-diff-editor .char-delete),
  :global(.light .diff-editor-container .monaco-editor .char-delete) {
    background-color: rgba(220, 38, 38, 0.2) !important;
  }

  :global(.light .diff-editor-container .monaco-editor .inline-deleted-text) {
    background-color: rgba(220, 38, 38, 0.12) !important;
    text-decoration-color: rgba(220, 38, 38, 0.7) !important;
  }

  :global(.dark .diff-editor-container .monaco-editor .inline-deleted-text) {
    background-color: rgba(239, 68, 68, 0.15) !important;
  }

  /* Hide gutter margin zones for cleaner look */
  :global(.diff-editor-container .monaco-editor .inline-deleted-margin-view-zone),
  :global(.diff-editor-container .monaco-editor .inline-added-margin-view-zone),
  :global(.diff-editor-container .monaco-editor .gutter-delete),
  :global(.diff-editor-container .monaco-editor .gutter-insert) {
    display: none !important;
  }

  /* Unchanged region styling - minimal and clean */
  :global(.diff-editor-container .monaco-editor .diff-hidden-lines .center) {
    box-shadow: none !important;
    background-color: transparent !important;
    border-top: 1px dashed rgba(128, 128, 128, 0.3) !important;
    border-bottom: 1px dashed rgba(128, 128, 128, 0.3) !important;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace !important;
    font-size: 11px !important;
    color: hsl(var(--text-ghost)) !important;
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
