<script lang="ts">
/* eslint-disable max-lines */
  /**
   * UnifiedDiffViewer - Monaco-based editable diff viewer
   *
   * This is the Monaco-based diff viewer for EDITABLE diffs. Use this when:
   * - The user needs to edit the diff content
   * - You need Monaco's full editing capabilities
   *
   * For READ-ONLY diff display, use `DiffViewer` from `$lib/components/ui/diff`
   * which is lighter weight and doesn't require Monaco.
   */

  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import * as monaco from 'monaco-editor';
  import { ensureMonacoInitialized, initializeMonaco } from '$lib/utils/monaco-workers';
  import { defineMonacoThemes, getActiveMonacoThemeName } from '$lib/utils/monaco-theme';
  import { themeManager } from '$lib/utils/theme';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faExternalLinkAlt, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    selectActiveWorkspace,
    selectWorkspaceById,
  } from '$lib/store/slices/workspace/workspace-selectors';

  const logger = createLogger('UnifiedDiffViewer');

  // Content size limit to prevent Monaco from freezing on large files
  const MAX_CONTENT_SIZE_BYTES = 50000 * 1024; // 50000KB

  // Note: Monaco error filtering is now handled centrally in monaco-workers.ts
  // via the setupMonacoErrorFilter() function called during worker configuration.

  interface Props {
    oldContent: string;
    newContent?: string;
    fileName?: string;
    language?: string;
    viewMode?: 'inline' | 'side-by-side';
    theme?: 'light' | 'dark';
    readOnly?: boolean;
    height?: string;
    hideUnchangedRegions?: boolean;
    lineWrapping?: boolean;
    provenance?: {
      author: string;
      timestamp: string;
      message?: string;
    };
    onSave?: (content: string) => void;
    onContentChange?: (content: string) => void;
    workspaceId?: string;
    filePath?: string;
  }

  let {
    oldContent = '',
    newContent = '',
    fileName = 'file',
    language = 'plaintext',
    viewMode = 'inline',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    theme = 'dark',
    readOnly = false,
    height = '400px',
    hideUnchangedRegions = false,
    lineWrapping = true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    provenance,
    onSave,
    onContentChange,
    workspaceId,
    filePath,
  }: Props = $props();

  const activeWorkspace = selectActiveWorkspace();
  const workspaceIdStore = writable(workspaceId ?? '');
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });
  const workspaceById = selectWorkspaceById(workspaceIdStore);

  function getResolvedWorkspace() {
    return workspaceId ? $workspaceById : $activeWorkspace;
  }

  // Warn about incompatible options - use $effect to react to prop changes
  $effect(() => {
    if (hideUnchangedRegions && viewMode === 'side-by-side') {
      logger.warn('hideUnchangedRegions only works in inline mode');
    }
  });

  // Content size tracking
  let contentTooLarge = $state(false);
  let contentSize = $state(0);

  // Helper to format file size
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Open file in VS Code
  async function openInVSCode() {
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
      const workspace = getResolvedWorkspace();
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
      const workspace = getResolvedWorkspace();
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

  // Svelte 5: bind:this updates the variable; use $state.raw to keep it reactive
  // without proxying DOM nodes.
  let container = $state.raw<HTMLDivElement | undefined>(undefined);
  let editor: monaco.editor.IStandaloneDiffEditor | null = null;
  let error: string | null = $state(null);
  let isDisposing = false;
  let initTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track models separately - Monaco does NOT dispose models when editor is disposed
  let originalModel: monaco.editor.ITextModel | null = null;
  let modifiedModel: monaco.editor.ITextModel | null = null;

  // Flag to prevent effect loop when content changes from editor
  let isUpdatingFromEditor = false;

  // Track last known content values to prevent unnecessary updates
  let lastOldContent: string | null = null;
  let lastNewContent: string | null = null;

  // Detect language from file extension (prioritize filename detection)
  let detectedLanguage = $derived(
    detectLanguage(fileName) !== 'plaintext' ? detectLanguage(fileName) : language || 'plaintext',
  );

  // Detect current theme using ThemeManager for consistency
  function detectCurrentTheme(): boolean {
    if (typeof window === 'undefined') return true;
    return themeManager.isDark();
  }

  let isDarkMode = $state(detectCurrentTheme());

  // Theme change listener cleanup function - set on mount
  let themeCleanup: (() => void) | undefined;

  // Calculate stats from the actual content
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let stats = $derived.by(() => {
    // Count actual line differences by comparing line by line
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let additions = 0;
    let deletions = 0;

    // Simple diff: count lines that are different
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= oldLines.length) {
        additions++;
      } else if (i >= newLines.length) {
        deletions++;
      } else if (oldLines[i] !== newLines[i]) {
        deletions++;
        additions++;
      }
    }

    return { additions, deletions };
  });

  function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      fish: 'shell',
      ps1: 'powershell',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      xml: 'xml',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      md: 'markdown',
      mdx: 'markdown',
      svelte: 'html',
      vue: 'html',
    };

    const detectedLang = languageMap[ext || ''] || 'plaintext';
    return detectedLang;
  }

  // Define custom Monaco themes that match the app's design
  function defineCustomThemes() {
    // Get CSS variable values from the document

    // Define shared themes
    defineMonacoThemes();
  }

  // Note: defineCustomThemes() is called in onMount before initializeEditor()

  async function initializeEditor() {
    if (!container || isDisposing) return;

    // Clear any pending initialization
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }

    try {
      // Check content size before creating editor
      const totalSize = (oldContent?.length || 0) + (newContent?.length || 0);
      if (totalSize > MAX_CONTENT_SIZE_BYTES) {
        logger.warn('Content too large for Monaco editor', {
          fileName,
          size: totalSize,
          limit: MAX_CONTENT_SIZE_BYTES,
        });
        contentTooLarge = true;
        contentSize = totalSize;
        return;
      }

      // Ensure Monaco is initialized before creating editor
      await ensureMonacoInitialized();
      await initializeMonaco();

      // Re-check container is still valid and in DOM after async operations
      // Monaco's isInShadowDOM checks container.parentNode which throws if detached
      if (!container || isDisposing || !container.isConnected) return;

      // Clean up existing editor and models
      if (editor) {
        isDisposing = true;
        try {
          editor.dispose();
        } catch {
          // Silently handle disposal errors
        }
        editor = null;
        isDisposing = false;
      }

      // Dispose existing models to prevent memory leaks
      // Models are NOT automatically disposed when the diff editor is disposed
      if (originalModel) {
        try {
          originalModel.dispose();
        } catch {
          // Silently handle disposal errors
        }
        originalModel = null;
      }
      if (modifiedModel) {
        try {
          modifiedModel.dispose();
        } catch {
          // Silently handle disposal errors
        }
        modifiedModel = null;
      }

      // Final check before creating editor
      if (!container || !container.isConnected) return;

      // Re-detect theme right before creating editor (async operations above may have allowed theme to change)
      isDarkMode = detectCurrentTheme();

      // Create diff editor (respects custom/preset themes)
      const editorTheme = getActiveMonacoThemeName(isDarkMode);
      editor = monaco.editor.createDiffEditor(container, {
        theme: editorTheme,
        readOnly: readOnly || false,
        renderSideBySide: viewMode === 'side-by-side',
        automaticLayout: true,
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        fontSize: 13,
        fontWeight: '500',
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        renderWhitespace: 'selection',
        renderGutterMenu: false,
        guides: { indentation: false }, // Disable indent guides to work around Monaco 0.54.0 crash (indent is not iterable)
        wordWrap: lineWrapping ? 'on' : 'off',
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        // Only enable hideUnchangedRegions if prop is true AND we're in inline mode
        ...(hideUnchangedRegions && viewMode === 'inline'
          ? {
              hideUnchangedRegions: {
                enabled: true,
                revealLineCount: 3,
                minimumLineCount: 3,
                contextLineCount: 3,
              },
            }
          : {}),
      });

      // Set the diff models with syntax highlighting
      // Assign to component-level variables so they can be disposed later
      // Use inmemory:// URI scheme so TypeScript worker errors are suppressed (see monaco-workers.ts)
      const timestamp = Date.now();
      const originalUri = monaco.Uri.parse(
        `inmemory://unified-diff/original/${fileName}?t=${timestamp}`,
      );
      const modifiedUri = monaco.Uri.parse(
        `inmemory://unified-diff/modified/${fileName}?t=${timestamp}`,
      );
      originalModel = monaco.editor.createModel(oldContent, detectedLanguage, originalUri);
      modifiedModel = monaco.editor.createModel(newContent, detectedLanguage, modifiedUri);

      // Track the initial content values to prevent effect loops
      lastOldContent = oldContent;
      lastNewContent = newContent;

      // Listen for changes to the modified (new) version
      if (!readOnly && modifiedModel) {
        const model = modifiedModel; // Capture for closure
        model.onDidChangeContent(() => {
          // Set flag to prevent effect from re-updating the editor
          isUpdatingFromEditor = true;
          const newValue = model.getValue();
          // Update tracked value to match what's in the editor
          lastNewContent = newValue;
          // Notify parent of content changes - parent can update the prop if needed
          onContentChange?.(newValue);
          // Reset flag after microtask to allow effect to complete
          queueMicrotask(() => {
            isUpdatingFromEditor = false;
          });
        });
      }

      editor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      // Note: Monaco's diff editor already computes and highlights differences correctly.
      // We removed the custom addDiffDecorations call which was doing naive line-by-line
      // comparison (comparing line i to line i) which breaks when lines are inserted/deleted.

      // Set up save handler if not read-only
      if (!readOnly && onSave && modifiedModel) {
        const model = modifiedModel; // Capture for closure
        const modifiedEditor = editor.getModifiedEditor();
        modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const content = model.getValue();
          onSave(content);
        });
      }

      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to initialize diff viewer';
      // Fall back to simple text view
      createFallbackDiffView();
    }
  }

  function createFallbackDiffView() {
    if (!container) return;

    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Create structure using DOM API
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'display: flex; height: 100%; font-family: monospace; font-size: 13px; background: var(--background); color: var(--foreground);';

    // Original content pane
    const originalPane = document.createElement('div');
    originalPane.style.cssText =
      'flex: 1; overflow: auto; border-right: 1px solid var(--border); padding: 1rem;';

    const originalLabel = document.createElement('div');
    originalLabel.style.cssText = 'color: var(--muted-foreground); margin-bottom: 0.5rem;';
    originalLabel.textContent = 'Original';
    originalPane.appendChild(originalLabel);

    const originalPre = document.createElement('pre');
    originalPre.style.cssText = 'margin: 0; white-space: pre-wrap; word-wrap: break-word;';
    originalPre.textContent = oldContent;
    originalPane.appendChild(originalPre);

    // Modified content pane
    const modifiedPane = document.createElement('div');
    modifiedPane.style.cssText = 'flex: 1; overflow: auto; padding: 1rem;';

    const modifiedLabel = document.createElement('div');
    modifiedLabel.style.cssText = 'color: var(--muted-foreground); margin-bottom: 0.5rem;';
    modifiedLabel.textContent = 'Modified';
    modifiedPane.appendChild(modifiedLabel);

    const modifiedPre = document.createElement('pre');
    modifiedPre.style.cssText = 'margin: 0; white-space: pre-wrap; word-wrap: break-word;';
    modifiedPre.textContent = newContent;
    modifiedPane.appendChild(modifiedPre);

    wrapper.appendChild(originalPane);
    wrapper.appendChild(modifiedPane);
    container.appendChild(wrapper);

    error = null;
  }

  // Note: Monaco's diff editor handles diff highlighting natively with proper LCS algorithm.
  // We removed the custom addDiffDecorations function which was doing naive line-by-line
  // comparison that broke when lines were inserted or deleted.

  // Track previous viewMode to detect actual changes
  let previousViewMode: typeof viewMode | null = null;

  // Reinitialize editor when viewMode changes
  $effect(() => {
    // Access viewMode to create dependency
    const mode = viewMode;

    // Skip if viewMode hasn't actually changed (e.g., on HMR)
    if (previousViewMode === mode) {
      return;
    }

    // Skip on initial mount - editor will be initialized by onMount
    if (previousViewMode === null) {
      previousViewMode = mode;
      return;
    }

    previousViewMode = mode;

    if (editor && container && !isDisposing) {
      // Debounce the recreation to avoid rapid disposal
      if (initTimeout) {
        clearTimeout(initTimeout);
      }

      initTimeout = setTimeout(() => {
        if (editor) {
          isDisposing = true;
          try {
            editor.dispose();
          } catch {
            // Silently handle disposal errors
          }
          editor = null;
          isDisposing = false;
        }
        initializeEditor();
      }, 100); // Longer delay to prevent rapid recreation
    }
  });

  // Update wordWrap when lineWrapping prop changes
  $effect(() => {
    const wrap = lineWrapping;
    if (editor) {
      editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
    }
  });

  // Update hideUnchangedRegions when prop changes
  $effect(() => {
    const hide = hideUnchangedRegions;
    const mode = viewMode;
    if (editor && mode === 'inline') {
      editor.updateOptions({
        hideUnchangedRegions: hide
          ? {
              enabled: true,
              revealLineCount: 3,
              minimumLineCount: 3,
              contextLineCount: 3,
            }
          : { enabled: false },
      });
    }
  });

  // Update editor when content changes
  $effect(() => {
    // Create reactive dependencies on content props
    const old = oldContent;
    const newC = newContent;

    // Skip if the change came from the editor itself to prevent infinite loop
    // Also skip if component is being disposed or editor not ready
    if (isUpdatingFromEditor || isDisposing || !editor) {
      return;
    }

    // Check if content actually changed from what we last set
    // This prevents loops when the parent re-renders with the same values
    if (old === lastOldContent && newC === lastNewContent) {
      return;
    }

    try {
      // Update content if changed
      const model = editor.getModel();
      if (model && model.original && model.modified) {
        let needsDecorationUpdate = false;

        // Only update original if it changed from what's in the model
        if (model.original.getValue() !== old) {
          model.original.setValue(old);
          needsDecorationUpdate = true;
        }
        // Only update modified if it changed from what's in the model
        if (model.modified.getValue() !== newC) {
          model.modified.setValue(newC);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          needsDecorationUpdate = true;
        }

        // Update tracked values AFTER successful update
        lastOldContent = old;
        lastNewContent = newC;

        // Note: Monaco's diff editor automatically recomputes diffs when content changes.
        // No need for manual decoration updates.
      }
    } catch {
      // Silently handle content update errors
    }
  });

  onMount(() => {
    // Define Monaco themes before initializing editor
    if (typeof window !== 'undefined' && monaco) {
      defineCustomThemes();
    }

    initializeEditor();

    // Set up theme change listeners
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      const handleChange = () => {
        const newTheme = detectCurrentTheme();
        isDarkMode = newTheme;
        // Update Monaco theme when system theme changes
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(newTheme));
        }
      };

      mediaQuery.addEventListener('change', handleChange);

      // Listen to ThemeManager's theme-changed event for custom/preset theme support
      const handleThemeChanged = (event: Event) => {
        const customEvent = event as CustomEvent<{ theme: string; isDark: boolean }>;
        isDarkMode = customEvent.detail.isDark;
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(customEvent.detail.isDark));
        }
      };
      window.addEventListener('theme-changed', handleThemeChanged);

      // Also watch for class changes on html element
      const observer = new MutationObserver(() => {
        const newTheme = detectCurrentTheme();
        isDarkMode = newTheme;
        if (editor) {
          monaco.editor.setTheme(getActiveMonacoThemeName(newTheme));
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      themeCleanup = () => {
        mediaQuery.removeEventListener('change', handleChange);
        window.removeEventListener('theme-changed', handleThemeChanged);
        observer.disconnect();
      };
    }
  });

  onDestroy(() => {
    // Clean up theme listeners
    themeCleanup?.();

    // Clear any pending timeouts
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }

    if (editor && !isDisposing) {
      isDisposing = true;
      try {
        editor.dispose();
      } catch {
        // Silently handle disposal errors
      }
      editor = null;
      isDisposing = false;
    }

    // Dispose models separately - Monaco does NOT dispose them with the editor
    if (originalModel) {
      try {
        originalModel.dispose();
      } catch {
        // Silently handle disposal errors
      }
      originalModel = null;
    }
    if (modifiedModel) {
      try {
        modifiedModel.dispose();
      } catch {
        // Silently handle disposal errors
      }
      modifiedModel = null;
    }
  });
</script>

<div class="diff-viewer-container h-full">
  <!-- Error Display -->
  {#if error}
    <div class="error-message">
      <p>Error loading diff viewer: {error}</p>
      <p class="error-hint">
        The diff content is available but the editor failed to initialize. This is usually due to
        Monaco Editor web worker issues in Electron.
      </p>
    </div>
  {:else if contentTooLarge}
    <div class="content-too-large" style="height: {height}">
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
          <h3 class="text-lg font-medium mb-2">File Too Large</h3>
          <p class="text-sm">
            This file is too large to display inline ({formatFileSize(contentSize)}). Open it in an
            external application instead.
          </p>
          {#if workspaceId && filePath}
            <div class="mt-4 flex items-center justify-center gap-2">
              <Button variant="secondary" size="sm" onclick={openInVSCode}>
                <Fa icon={faExternalLinkAlt} class="mr-2" />
                Open in VS Code
              </Button>
              <Button variant="ghost" size="sm" onclick={revealInFolder}>
                <Fa icon={faFolderOpen} class="mr-2" />
                Reveal in Finder
              </Button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <!-- Monaco Diff Editor Container -->
    <div bind:this={container} class="monaco-container" style="height: {height}"></div>
  {/if}
</div>

<style>
  .diff-viewer-container {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    overflow: hidden;
    background: var(--background);
  }

  .monaco-container {
    flex: 1;
    min-height: 400px;
    width: 100%;
  }

  .error-message {
    padding: 1rem;
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 4px;
    color: #c33;
    font-size: 0.875rem;
  }

  .error-message p {
    margin: 0.5rem 0;
  }

  .error-hint {
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .content-too-large {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: var(--background);
  }

  :global(.monaco-diff-editor),
  :global(.monaco-editor .margin),
  :global(.monaco-editor-background) {
    background: var(--color-background) !important;
  }

  /* Override specific Monaco token colors - Dark Mode */
  :global(.dark .monaco-editor .mtk1) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk2) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk3) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk4) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk5) {
    color: #9cdcfe !important;
  }
  :global(.dark .monaco-editor .mtk6) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk7) {
    color: #ce9178 !important;
  }
  :global(.dark .monaco-editor .mtk8) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk9) {
    color: #569cd6 !important;
  }
  :global(.dark .monaco-editor .mtk10) {
    color: #6a9955 !important;
  }
  :global(.dark .monaco-editor .mtk11) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk12) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk13) {
    color: #4ec9b0 !important;
  }
  :global(.dark .monaco-editor .mtk14) {
    color: #dcdcaa !important;
  }
  :global(.dark .monaco-editor .mtk15) {
    color: #b5cea8 !important;
  }
  :global(.dark .monaco-editor .mtk16) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk17) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk18) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk19) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk20) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk21) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk22) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk23) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk24) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk25) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk26) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk27) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk28) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk29) {
    color: #d4d4d4 !important;
  }
  :global(.dark .monaco-editor .mtk30) {
    color: #d4d4d4 !important;
  }

  /* Override specific Monaco token colors - Light Mode (uses .light class on html element) */
  :global(.light .monaco-editor .mtk1) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk2) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk3) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk4) {
    color: #374151 !important;
  }
  :global(.light .monaco-editor .mtk5) {
    color: #374151 !important;
  }
  :global(.light .monaco-editor .mtk6) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk7) {
    color: #047857 !important;
  }
  :global(.light .monaco-editor .mtk8) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk9) {
    color: #7c3aed !important;
  }
  :global(.light .monaco-editor .mtk10) {
    color: #6b7280 !important;
  }
  :global(.light .monaco-editor .mtk11) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk12) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk13) {
    color: #b45309 !important;
  }
  :global(.light .monaco-editor .mtk14) {
    color: #1d4ed8 !important;
  }
  :global(.light .monaco-editor .mtk15) {
    color: #c2410c !important;
  }
  :global(.light .monaco-editor .mtk16) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk17) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk18) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk19) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk20) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk21) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk22) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk23) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk24) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk25) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk26) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk27) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk28) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk29) {
    color: #1f2937 !important;
  }
  :global(.light .monaco-editor .mtk30) {
    color: #1f2937 !important;
  }

  /* Additional light mode token variations for better color differentiation (uses .light class on html element) */
  /* Punctuation and delimiters */
  :global(.light .monaco-editor .mtk2) {
    color: #6b7280 !important;
  }
  /* Operators */
  :global(.light .monaco-editor .mtk3) {
    color: #7c3aed !important;
  }
  /* Brackets and braces */
  :global(.light .monaco-editor .mtk4) {
    color: #6b7280 !important;
  }
  /* Identifiers and variables */
  :global(.light .monaco-editor .mtk5) {
    color: #374151 !important;
  }
  /* Whitespace */
  :global(.light .monaco-editor .mtk6) {
    color: #97999d !important;
  }
  /* String literals */
  :global(.light .monaco-editor .mtk7) {
    color: #047857 !important;
  }
  /* Escape sequences */
  :global(.light .monaco-editor .mtk8) {
    color: #dc2626 !important;
  }
  /* Keywords */
  :global(.light .monaco-editor .mtk9) {
    color: #7c3aed !important;
  }
  /* Comments */
  :global(.light .monaco-editor .mtk10) {
    color: #6b7280 !important;
  }
  /* Numeric literals */
  :global(.light .monaco-editor .mtk11) {
    color: #c2410c !important;
  }
  /* Boolean literals */
  :global(.light .monaco-editor .mtk12) {
    color: #7c3aed !important;
  }
  /* Type names */
  :global(.light .monaco-editor .mtk13) {
    color: #b45309 !important;
  }
  /* Function names */
  :global(.light .monaco-editor .mtk14) {
    color: #1d4ed8 !important;
  }
  /* Constants */
  :global(.light .monaco-editor .mtk15) {
    color: #c2410c !important;
  }
  /* Attributes */
  :global(.light .monaco-editor .mtk16) {
    color: #b45309 !important;
  }
  /* Tags */
  :global(.light .monaco-editor .mtk17) {
    color: #7c3aed !important;
  }
  /* Tag names */
  :global(.light .monaco-editor .mtk18) {
    color: #b45309 !important;
  }
  /* Attribute names */
  :global(.light .monaco-editor .mtk19) {
    color: #b45309 !important;
  }
  /* Attribute values */
  :global(.light .monaco-editor .mtk20) {
    color: #047857 !important;
  }
  /* Regex */
  :global(.light .monaco-editor .mtk21) {
    color: #dc2626 !important;
  }
  /* Regex groups */
  :global(.light .monaco-editor .mtk22) {
    color: #ea580c !important;
  }
  /* Markup */
  :global(.light .monaco-editor .mtk23) {
    color: #1f2937 !important;
  }
  /* Markup tags */
  :global(.light .monaco-editor .mtk24) {
    color: #7c3aed !important;
  }
  /* Markup attributes */
  :global(.light .monaco-editor .mtk25) {
    color: #b45309 !important;
  }
  /* Markup strings */
  :global(.light .monaco-editor .mtk26) {
    color: #047857 !important;
  }
  /* Invalid */
  :global(.light .monaco-editor .mtk27) {
    color: #b91c1c !important;
  }
  /* Deprecated */
  :global(.light .monaco-editor .mtk28) {
    color: #ea580c !important;
  }
  /* Namespace */
  :global(.light .monaco-editor .mtk29) {
    color: #b45309 !important;
  }
  /* Module */
  :global(.light .monaco-editor .mtk30) {
    color: #1d4ed8 !important;
  }

  /* Semantic token colors for better syntax highlighting - Dark Mode */
  :global(.monaco-editor .mtk.keyword) {
    color: #569cd6 !important;
  }
  :global(.monaco-editor .mtk.string) {
    color: #ce9178 !important;
  }
  :global(.monaco-editor .mtk.comment) {
    color: #6a9955 !important;
  }
  :global(.monaco-editor .mtk.number) {
    color: #b5cea8 !important;
  }
  :global(.monaco-editor .mtk.type) {
    color: #4ec9b0 !important;
  }
  :global(.monaco-editor .mtk.function) {
    color: #dcdcaa !important;
  }
  :global(.monaco-editor .mtk.variable) {
    color: #9cdcfe !important;
  }

  /* Semantic token colors for better syntax highlighting - Light Mode (uses .light class on html element) */
  :global(.light .monaco-editor .mtk.keyword) {
    color: #7c3aed !important;
  }
  :global(.light .monaco-editor .mtk.string) {
    color: #047857 !important;
  }
  :global(.light .monaco-editor .mtk.comment) {
    color: #6b7280 !important;
  }
  :global(.light .monaco-editor .mtk.number) {
    color: #c2410c !important;
  }
  :global(.light .monaco-editor .mtk.type) {
    color: #b45309 !important;
  }
  :global(.light .monaco-editor .mtk.function) {
    color: #1d4ed8 !important;
  }
  :global(.light .monaco-editor .mtk.variable) {
    color: #374151 !important;
  }

  /* Diff highlighting styles */
  :global(.diff-deleted-line) {
    background-color: rgba(244, 67, 54, 0.2) !important;
  }

  :global(.diff-added-line) {
    background-color: rgba(76, 175, 80, 0.2) !important;
  }

  :global(.diff-deleted-glyph) {
    background-color: rgba(244, 67, 54, 0.3) !important;
    color: #f44336 !important;
  }

  :global(.diff-added-glyph) {
    background-color: rgba(76, 175, 80, 0.3) !important;
    color: #4caf50 !important;
  }

  /* Light theme diff highlighting - stronger colors on white background */
  :global(.light .diff-deleted-line) {
    background-color: rgba(220, 38, 38, 0.12) !important;
  }

  :global(.light .diff-added-line) {
    background-color: rgba(22, 163, 74, 0.12) !important;
  }

  :global(.light .diff-deleted-glyph) {
    background-color: rgba(220, 38, 38, 0.2) !important;
    color: #dc2626 !important;
  }

  :global(.light .diff-added-glyph) {
    background-color: rgba(22, 163, 74, 0.2) !important;
    color: #16a34a !important;
  }
</style>
