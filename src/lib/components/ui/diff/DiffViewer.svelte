<script lang="ts">
  /**
   * DiffViewer - The canonical diff viewer component
   *
   * This is the primary diff viewer for the application. Use this component
   * for all read-only diff displays. Built on @pierre/diffs for high-quality
   * syntax highlighting and diff rendering.
   *
   * Features:
   * - Unified or split (side-by-side) view
   * - Syntax highlighting via Shiki (offloaded to worker pool)
   * - Inline change highlighting (word/char level)
   * - Line selection and click handlers
   * - Line annotations for comments/guides
   * - Collapsible with preview
   * - Dark/light theme support
   * - Expandable unchanged regions
   * - Search within diff (Cmd+F)
   * - Sticky line numbers and change gutter for horizontal scrolling
   *
   * For Monaco-based editable diffs, see UnifiedDiffViewer in $lib/components/editor/
   */
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import {
    FileDiff,
    parsePatchFiles,
    parseDiffFromFile,
    type FileContents,
    type HunkData,
    type ExpansionDirections,
    type ThemeTypes,
  } from '@pierre/diffs';
  import type { PureDiffProps } from './types.js';
  import DiffHeader from './DiffHeader.svelte';
  import { getDiffWorkerPool, getSafeDiffLanguage } from '$lib/utils/diff-highlighter-preloader';
  import { themeManager } from '$lib/utils/theme';
  import { codeFontSettings } from '$lib/stores/code-font-settings.store.svelte';
  import Fa from 'svelte-fa';
  import {
    faSearch,
    faXmark,
    faChevronUp,
    faChevronDown,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';

  type Props = PureDiffProps;

  /**
   * Maximum combined content size for diff computation (in bytes).
   * Files larger than this will show a "too large" message to prevent OOM.
   */
  const MAX_CONTENT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

  let {
    // Input
    patch,
    oldContent,
    newContent,
    // File info
    fileName = 'file',
    oldFileName,
    language,
    // View mode
    viewMode = 'unified',
    // Display options
    showHeader = true,
    showStats = true,
    showLineNumbers = true,
    diffIndicators = 'bars',
    overflow = 'scroll',
    maxHeight,
    // Hunk/context options
    hunkSeparators = 'line-info',
    expandUnchanged = false,
    expansionLineCount = 20,
    // Inline change highlighting
    lineDiffType = 'word-alt',
    maxLineDiffLength = 500,
    // Collapse/expand
    collapsible = false,
    initialCollapsed = false,
    previewLines = 5,
    // Line annotations
    annotations = [],
    renderAnnotation,
    // Line selection
    enableLineSelection = false,
    selectedLines = null,
    onLineSelected,
    // Callbacks
    onLineClick,
    onLineNumberClick,
    onLineEnter,
    onLineLeave,
    onToggleCollapse,
    // Actions
    actions = [],
    // Hover utility
    enableHoverUtility = false,
    renderHoverUtility,
    // Custom hunk separators
    renderHunkSeparator,
    // Styling
    class: className = '',
    style = '',
    unsafeCSS,
    // Performance options
    maxHighlightLines = 5000,
    disableHighlighting = false,
  }: Props = $props();

  // Performance: Check if content is too large to render
  const contentTooLarge = $derived.by(() => {
    const oldSize = oldContent?.length ?? 0;
    const newSize = newContent?.length ?? 0;
    const patchSize = patch?.length ?? 0;
    const totalSize = oldSize + newSize + patchSize;
    return totalSize > MAX_CONTENT_SIZE_BYTES;
  });

  // Format file size for display
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Performance: Calculate total line count to determine if highlighting should be disabled
  const shouldDisableHighlighting = $derived.by(() => {
    if (disableHighlighting) return true;

    // Count lines in content
    const oldLines = oldContent?.split('\n').length ?? 0;
    const newLines = newContent?.split('\n').length ?? 0;
    const totalLines = oldLines + newLines;

    return totalLines > maxHighlightLines;
  });

  // Detect current theme using ThemeManager for consistency with the app
  function detectCurrentTheme(): boolean {
    if (typeof window === 'undefined') return true;
    return themeManager.isDark();
  }

  // State
  let containerRef: HTMLDivElement | undefined = $state();
  let fileDiffInstance: FileDiff | undefined = $state();
  let collapsed = $state(false);
  let isDarkMode = $state(detectCurrentTheme());

  // Search state
  let searchOpen = $state(false);
  let searchQuery = $state('');
  let searchResults: { element: HTMLElement; text: string }[] = $state([]);
  let currentSearchIndex = $state(0);
  let searchInputRef: HTMLInputElement | undefined = $state();
  let wrapperRef: HTMLDivElement | undefined = $state();

  // Sync collapsed state with initialCollapsed prop
  $effect(() => {
    collapsed = initialCollapsed;
  });

  // Derive the diff metadata from inputs
  const diffData = $derived.by(() => {
    // Skip expensive computation if content is too large
    if (contentTooLarge) return null;

    if (patch) {
      // Parse patch string
      const parsed = parsePatchFiles(patch);
      if (parsed.length > 0 && parsed[0].files.length > 0) {
        const fileDiff = parsed[0].files[0];
        // Validate the language extracted from the patch file extension.
        // If the language is not supported by Shiki, fall back to plain text
        // to avoid "Unknown language" errors.
        if (fileDiff.lang) {
          fileDiff.lang = getSafeDiffLanguage(fileDiff.lang);
        }
        // Also allow explicitly passed language prop to override the detected language
        if (language) {
          const safeLang = getSafeDiffLanguage(language);
          if (safeLang) {
            fileDiff.lang = safeLang;
          }
        }
        return { fileDiff, oldFile: undefined, newFile: undefined };
      }
      return null;
    } else if (oldContent !== undefined && newContent !== undefined) {
      // Generate diff from content
      // Use getSafeDiffLanguage to validate language - unsupported languages fall back to plain text
      const safeLang = getSafeDiffLanguage(language);
      const oldFile: FileContents = {
        name: oldFileName || fileName,
        contents: oldContent,
        lang: safeLang as any,
      };
      const newFile: FileContents = {
        name: fileName,
        contents: newContent,
        lang: safeLang as any,
      };
      const fileDiff = parseDiffFromFile(oldFile, newFile);
      return { fileDiff, oldFile, newFile };
    }
    return null;
  });

  // Calculate stats from diff
  const stats = $derived.by(() => {
    if (!diffData?.fileDiff) return { additions: 0, deletions: 0 };
    let additions = 0;
    let deletions = 0;
    for (const hunk of diffData.fileDiff.hunks) {
      additions += hunk.additionCount;
      deletions += hunk.deletionCount;
    }
    return { additions, deletions };
  });

  // Default hunk separator with chevron
  function defaultHunkSeparator(hunk: HunkData, instance: FileDiff) {
    const lineCount = hunk.lines ?? 0;

    // Outer wrapper spans grid columns (for split view)
    const wrapper = document.createElement('div');
    wrapper.style.gridColumn = 'span 2';
    wrapper.className = 'hunk-separator-wrapper';

    // Inner content with sticky positioning
    const container = document.createElement('div');
    container.className = 'hunk-separator-default';

    const chevron = document.createElement('span');
    chevron.className = 'hunk-separator-chevron';
    chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5 5.3-5 5.4z"/></svg>';

    const text = document.createElement('span');
    text.className = 'hunk-separator-text';
    text.textContent = `${lineCount} unmodified line${lineCount !== 1 ? 's' : ''}`;

    container.appendChild(chevron);
    container.appendChild(text);
    container.onclick = () => instance.expandHunk(hunk.hunkIndex, 'both');

    wrapper.appendChild(container);
    return wrapper;
  }

  // Build FileDiff options function - returns fresh options each time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildFileDiffOptions(): any {
    return {
      diffStyle: viewMode,
      diffIndicators,
      disableLineNumbers: !showLineNumbers,
      overflow,
      hunkSeparators: renderHunkSeparator
        ? (hunk: HunkData, instance: FileDiff) =>
            renderHunkSeparator(hunk, (dir: ExpansionDirections) =>
              instance.expandHunk(hunk.hunkIndex, dir),
            )
        : (hunk: HunkData, instance: FileDiff) => defaultHunkSeparator(hunk, instance),
      expandUnchanged,
      // disableBackground: true,
      expansionLineCount,
      lineDiffType,
      maxLineDiffLength,
      disableFileHeader: true, // We render our own header
      enableLineSelection,
      onLineSelected,
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      enableHoverUtility,
      renderHoverUtility,
      renderAnnotation,
      // Performance: Disable highlighting for large files to avoid blocking the main thread
      // When disabled, the diff will render with plain text (no syntax colors)
      disableHighlighting: shouldDisableHighlighting,
      // Use worker pool for syntax highlighting to avoid blocking the main thread
      workerPool: getDiffWorkerPool(),
      theme: {
        dark: 'github-dark',
        light: 'github-light',
      },
      // Use the app's theme setting instead of OS preference
      themeType: (isDarkMode ? 'dark' : 'light') as ThemeTypes,
      unsafeCSS: `
        pre[data-diffs] {
          --diffs-bg: hsl(var(--background)) !important;
          background: hsl(var(--background)) !important;
        }
        [data-column-number] {
          position: sticky;
          left: 0;
        }
        ${unsafeCSS || ''}
      `,
    };
  }

  // Toggle collapse
  function toggleCollapse() {
    collapsed = !collapsed;
    onToggleCollapse?.(collapsed);
  }

  // === Search functions ===
  function openSearch() {
    searchOpen = true;
    tick().then(() => searchInputRef?.focus());
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = '';
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = 0;
  }

  function clearSearchHighlights() {
    // Remove all search highlights
    if (!containerRef) return;

    // Access shadow root if present (for @pierre/diffs custom element)
    const diffsContainer = containerRef.querySelector('diffs-container');
    const searchRoot = diffsContainer?.shadowRoot || containerRef;

    const highlights = searchRoot.querySelectorAll('.diff-search-highlight');
    highlights.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
  }

  function performSearch(query: string) {
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = 0;

    if (!query || !containerRef) return;

    // The @pierre/diffs library uses a custom element <diffs-container> with Shadow DOM
    // We need to access the shadow root to find the code content
    const diffsContainer = containerRef.querySelector('diffs-container');
    const searchRoot = diffsContainer?.shadowRoot || containerRef;

    // Search within code content - [data-column-content] contains the actual code
    let codeElements = searchRoot.querySelectorAll('[data-column-content]');

    // If no elements found with that selector, try alternatives
    if (codeElements.length === 0) {
      codeElements = searchRoot.querySelectorAll('[data-line] [data-column-content], pre [data-line]');
    }

    // Highlight matches in each code element
    codeElements.forEach((el) => {
      highlightTextInElement(el as HTMLElement, query);
    });

    // Collect all highlighted elements from the shadow root
    // Filter out elements that are not visible (e.g., in collapsed sections or hidden)
    const results: { element: HTMLElement; text: string }[] = [];
    const highlighted = searchRoot.querySelectorAll('.diff-search-highlight');
    highlighted.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;

      // Only include visible elements
      if (isVisible) {
        results.push({ element: htmlEl, text: el.textContent || '' });
      }
    });

    searchResults = results;
    if (results.length > 0) {
      navigateToResult(0);
    }
  }

  function highlightTextInElement(element: HTMLElement, query: string) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodesToHighlight: { node: Text; start: number; end: number }[] = [];
    const lowerQuery = query.toLowerCase();

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || '';
      const lowerText = text.toLowerCase();
      let idx = 0;

      while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
        nodesToHighlight.push({ node, start: idx, end: idx + query.length });
        idx += query.length;
      }
    }

    // Apply highlights in reverse order to preserve indices
    for (let i = nodesToHighlight.length - 1; i >= 0; i--) {
      const { node, start, end } = nodesToHighlight[i];
      const text = node.textContent || '';

      const before = text.slice(0, start);
      const match = text.slice(start, end);
      const after = text.slice(end);

      const span = document.createElement('span');
      span.className = 'diff-search-highlight';
      // Apply inline styles since we're inside Shadow DOM and scoped CSS won't apply
      span.style.backgroundColor = 'rgba(255, 213, 0, 0.4)';
      span.textContent = match;

      const parent = node.parentNode;
      if (parent) {
        if (after) {
          parent.insertBefore(document.createTextNode(after), node.nextSibling);
        }
        parent.insertBefore(span, node.nextSibling);
        if (before) {
          node.textContent = before;
        } else {
          parent.removeChild(node);
        }
      }
    }
  }

  function navigateToResult(index: number) {
    if (searchResults.length === 0) return;

    // Remove current highlight style from previous result (reset to normal highlight)
    searchResults.forEach((r) => {
      r.element.classList.remove('diff-search-current');
      r.element.style.backgroundColor = 'rgba(255, 213, 0, 0.4)';
    });

    // Wrap around
    if (index < 0) index = searchResults.length - 1;
    if (index >= searchResults.length) index = 0;

    currentSearchIndex = index;
    const result = searchResults[index];
    result.element.classList.add('diff-search-current');
    // Apply current highlight style inline (selection-like blue color, no border)
    result.element.style.backgroundColor = 'rgba(59, 130, 246, 0.5)';
    result.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigateToResult(currentSearchIndex - 1);
      } else {
        navigateToResult(currentSearchIndex + 1);
      }
    } else if (e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      if (e.shiftKey) {
        navigateToResult(currentSearchIndex - 1);
      } else {
        navigateToResult(currentSearchIndex + 1);
      }
    }
  }

  // React to search query changes
  $effect(() => {
    // Only track searchOpen and searchQuery, not the state changes inside
    const isOpen = searchOpen;
    const query = searchQuery;

    untrack(() => {
      if (isOpen && query) {
        performSearch(query);
      } else if (!query) {
        clearSearchHighlights();
        searchResults = [];
      }
    });
  });

  // Handle keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl+F for search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      openSearch();
    }
  }

  onMount(() => {
    // Add keydown listener to the wrapper
    wrapperRef?.addEventListener('keydown', handleKeydown);
    return () => {
      wrapperRef?.removeEventListener('keydown', handleKeydown);
    };
  });

  // Track if this is the first render
  let isFirstRender = true;

  // Initialize FileDiff instance on first render
  $effect(() => {
    if (!containerRef || !diffData) return;

    // Track annotations to re-render when they change
    const _annotations = annotations;

    const options = buildFileDiffOptions();

    if (!fileDiffInstance) {
      fileDiffInstance = new FileDiff(options);
      isFirstRender = true;
    }

    // Render the diff - use containerWrapper for the DOM target
    fileDiffInstance!.render({
      fileDiff: diffData.fileDiff,
      oldFile: diffData.oldFile,
      newFile: diffData.newFile,
      containerWrapper: containerRef,
      lineAnnotations: _annotations as any,
    });

    isFirstRender = false;
  });

  // Separate effect to handle option changes - need to rerender after setOptions
  $effect(() => {
    // Track all the reactive props that affect options
    const _deps = [
      viewMode,
      diffIndicators,
      showLineNumbers,
      overflow,
      hunkSeparators,
      expandUnchanged,
      expansionLineCount,
      lineDiffType,
      maxLineDiffLength,
      enableLineSelection,
      enableHoverUtility,
      renderHoverUtility,
    ];

    // Skip if no instance yet or first render (handled by other effect)
    if (!fileDiffInstance || isFirstRender) return;

    const options = buildFileDiffOptions();
    fileDiffInstance.setOptions(options);
    fileDiffInstance.rerender();
  });

  // Update selected lines when prop changes
  $effect(() => {
    if (fileDiffInstance && enableLineSelection) {
      // Guard against invalid selection ranges
      if (selectedLines && selectedLines.start && selectedLines.end) {
        fileDiffInstance.setSelectedLines(selectedLines);
      } else {
        fileDiffInstance.setSelectedLines(null);
      }
    }
  });

  // Theme change listener cleanup function
  let themeCleanup: (() => void) | undefined;

  // Set up theme change listeners on mount
  onMount(() => {
    if (typeof window !== 'undefined') {
      // Listen for custom theme-changed event from the app's ThemeManager
      const handleThemeChange = () => {
        const newTheme = detectCurrentTheme();
        if (newTheme !== isDarkMode) {
          isDarkMode = newTheme;
          // Update the FileDiff theme
          if (fileDiffInstance) {
            fileDiffInstance.setThemeType(newTheme ? 'dark' : 'light');
          }
        }
      };

      window.addEventListener('theme-changed', handleThemeChange);

      // Also watch for class changes on html element (backup for direct class manipulation)
      const observer = new MutationObserver(() => {
        const newTheme = detectCurrentTheme();
        if (newTheme !== isDarkMode) {
          isDarkMode = newTheme;
          if (fileDiffInstance) {
            fileDiffInstance.setThemeType(newTheme ? 'dark' : 'light');
          }
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      themeCleanup = () => {
        window.removeEventListener('theme-changed', handleThemeChange);
        observer.disconnect();
      };
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    themeCleanup?.();
    fileDiffInstance?.cleanUp();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={wrapperRef}
  class="pure-diff {className}"
  style="{maxHeight ? `max-height: ${maxHeight};` : ''} {style}"
  data-view-mode={viewMode}
  data-collapsed={collapsed}
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#if showHeader}
    <DiffHeader
      {fileName}
      {oldFileName}
      additions={showStats ? stats.additions : undefined}
      deletions={showStats ? stats.deletions : undefined}
      {collapsible}
      {collapsed}
      {actions}
      onToggle={toggleCollapse}
    />
  {/if}

  <!-- Search bar -->
  {#if searchOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="diff-search-bar" onkeydown={handleSearchKeydown}>
      <div class="diff-search-input-wrapper">
        <Fa icon={faSearch} class="diff-search-icon" />
        <input
          bind:this={searchInputRef}
          bind:value={searchQuery}
          type="text"
          placeholder="Find in diff..."
          class="diff-search-input"
        />
        {#if searchResults.length > 0}
          <span class="diff-search-count">
            {currentSearchIndex + 1} / {searchResults.length}
          </span>
        {:else if searchQuery}
          <span class="diff-search-count diff-search-no-results">No results</span>
        {/if}
      </div>
      <div class="diff-search-actions">
        <button
          type="button"
          class="diff-search-nav-btn"
          onclick={() => navigateToResult(currentSearchIndex - 1)}
          disabled={searchResults.length === 0}
          title="Previous match (Shift+Enter)"
        >
          <Fa icon={faChevronUp} />
        </button>
        <button
          type="button"
          class="diff-search-nav-btn"
          onclick={() => navigateToResult(currentSearchIndex + 1)}
          disabled={searchResults.length === 0}
          title="Next match (Enter)"
        >
          <Fa icon={faChevronDown} />
        </button>
        <button type="button" class="diff-search-close-btn" onclick={closeSearch} title="Close (Esc)">
          <Fa icon={faXmark} />
        </button>
      </div>
    </div>
  {/if}

  {#if !collapsed}
    <div
      class="pure-diff-content"
      class:overflow-auto={overflow === 'scroll'}
      style={maxHeight ? `max-height: calc(${maxHeight} - 40px);` : ''}
    >
      {#if diffData}
        <div bind:this={containerRef} class="pure-diff-container" style:--diffs-font-family={codeFontSettings.fontFamilyCSS}></div>
      {:else}
        <div class="pure-diff-empty">
          <p class="text-subtle text-sm">No diff content available</p>
        </div>
      {/if}
    </div>
  {:else if collapsible && previewLines > 0}
    <!-- Preview when collapsed -->
    <div class="pure-diff-preview">
      <button type="button" class="pure-diff-preview-button" onclick={toggleCollapse}>
        Click to expand ({stats.additions} additions, {stats.deletions} deletions)
      </button>
    </div>
  {/if}
</div>

<style>
  /* Import shared diff styles */
  @import './diff-shared-styles.css';

  .pure-diff {
    position: relative;
    border-radius: 0.5rem;
    border: 1px solid var(--border, hsl(var(--border)));
    overflow: hidden;
    background: var(--background, hsl(var(--background)));
  }

  .pure-diff-content {
    overflow-x: auto;
  }

  .pure-diff-container {
    min-width: 100%;
    /* Diff container CSS variables */
    --diffs-font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --diffs-font-size: 13px;
    --diffs-line-height: 1.5;
    --diffs-bg-separator-override: hsl(var(--sidebar) / 0.3);
    --diffs-bg-addition-emphasis-override: #00bd7d33;
    --diffs-bg-deletion-emphasis-override: #f0644933;
    --diffs-addition-color-override: #00bc7d;
    --diffs-bg-context-override: hsl(var(--sidebar) / 0.5);
  }

  /* Component-specific: remove border-radius on hunk-separator-actions */
  .pure-diff-container :global(.hunk-separator-actions) {
    border-radius: 0;
  }

  .pure-diff-empty {
    padding: 2rem;
    text-align: center;
  }

  .pure-diff-preview {
    padding: 0.5rem;
    border-top: 1px solid var(--border, hsl(var(--border)));
  }

  .pure-diff-preview-button {
    width: 100%;
    padding: 0.5rem 1rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--muted-foreground, hsl(var(--muted-foreground)));
    background: var(--muted, hsl(var(--muted)));
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .pure-diff-preview-button:hover {
    background: var(--accent, hsl(var(--accent)));
  }

  /* === Search bar styles === */
  .diff-search-bar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: hsl(var(--background));
    border-left: 1px solid hsl(var(--border));
    border-bottom: 1px solid hsl(var(--border));
    box-shadow: -2px 2px 8px hsl(var(--background) / 0.5);
  }

  .diff-search-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: hsl(var(--muted) / 0.5);
    border: 1px solid hsl(var(--border));
    padding: 0.25rem 0.5rem;
  }

  .diff-search-input-wrapper :global(.diff-search-icon) {
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .diff-search-input {
    width: 140px;
    border: none;
    background: transparent;
    font-size: 0.8125rem;
    color: hsl(var(--foreground));
    outline: none;
    min-width: 0;
  }

  .diff-search-input::placeholder {
    color: hsl(var(--muted-foreground));
  }

  .diff-search-count {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }

  .diff-search-no-results {
    color: hsl(var(--destructive));
  }

  .diff-search-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
  }

  .diff-search-nav-btn,
  .diff-search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: all 0.15s;
  }

  .diff-search-nav-btn:hover:not(:disabled),
  .diff-search-close-btn:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  .diff-search-nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* === Search highlight styles === */
  .pure-diff-container :global(.diff-search-highlight) {
    background: hsl(50 100% 50% / 0.4);
    border-radius: 2px;
    padding: 0 1px;
  }

  .pure-diff-container :global(.diff-search-highlight.diff-search-current) {
    background: hsl(30 100% 50% / 0.6);
    outline: 2px solid hsl(30 100% 50%);
  }

  /* === Sticky line numbers and gutter for horizontal scrolling === */
  /* Target the diff table structure from @pierre/diffs */
  .pure-diff-container :global(pre[data-diffs]) {
    overflow-x: auto;
  }

  /* Make line number columns sticky */
  .pure-diff-container :global([data-column-number]) {
    position: sticky;
    left: 0;
    z-index: 2;
    background: inherit;
  }

  /* Make the gutter/indicator column sticky (comes before line numbers) */
  .pure-diff-container :global([data-column-gutter]),
  .pure-diff-container :global([data-diffs-indicator]) {
    position: sticky;
    left: 0;
    z-index: 3;
    background: inherit;
  }

  /* For split view, handle both sides */
  .pure-diff-container :global([data-diffs-split-grid]) {
    overflow-x: auto;
  }

  /* In split view, the left side gutter/numbers should be sticky at left:0 */
  .pure-diff-container :global([data-side="deletions"] [data-column-gutter]),
  .pure-diff-container :global([data-side="deletions"] [data-diffs-indicator]) {
    position: sticky;
    left: 0;
    z-index: 3;
    background: inherit;
  }

  .pure-diff-container :global([data-side="deletions"] [data-column-number]) {
    position: sticky;
    left: 4px; /* Account for indicator width */
    z-index: 2;
    background: inherit;
  }

  /* Handle table-based diffs (unified view) */
  .pure-diff-container :global(table) {
    border-collapse: separate;
    border-spacing: 0;
  }

  .pure-diff-container :global(td[data-column-gutter]),
  .pure-diff-container :global(td:first-child) {
    position: sticky;
    left: 0;
    z-index: 2;
  }

  /* Ensure proper background inheritance for sticky elements */
  .pure-diff-container :global(tr[data-line-type="change-addition"]) :global([data-column-number]),
  .pure-diff-container :global(tr[data-line-type="change-addition"]) :global([data-column-gutter]) {
    background: var(--diffs-bg-addition, hsl(142 76% 36% / 0.1));
  }

  .pure-diff-container :global(tr[data-line-type="change-deletion"]) :global([data-column-number]),
  .pure-diff-container :global(tr[data-line-type="change-deletion"]) :global([data-column-gutter]) {
    background: var(--diffs-bg-deletion, hsl(0 84% 60% / 0.1));
  }

  .pure-diff-container :global(tr[data-line-type="context"]) :global([data-column-number]),
  .pure-diff-container :global(tr[data-line-type="context"]) :global([data-column-gutter]) {
    background: hsl(var(--background));
  }
</style>
