<script module lang="ts">
  /* eslint-disable max-lines */
  export { hashContent } from './diff-content-hash.js';
</script>

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
   */
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import {
    FileDiff,
    VirtualizedFileDiff,
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
  import { selectCodeFontFamilyCSS } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { selectIsDarkTheme } from '$lib/store/slices/theme/theme-selectors';
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { getSelectedTextWithinSurface } from '$lib/utils/selected-text';
  import { hashContent } from './diff-content-hash.js';

  type Props = PureDiffProps;

  /**
   * Maximum combined content size for diff computation (in bytes).
   * Files larger than this will show a "too large" message to prevent OOM.
   */
  const MAX_CONTENT_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

  // `hashContent` is now imported from the module-scope block above so the
  // content-hash LRU is shared across all DiffViewer instances (Wave 3 perf).

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
    // Cache keys
    oldCacheKey,
    newCacheKey,
    // Performance options
    maxHighlightLines = 5000,
    disableHighlighting = false,
    // Virtualization (multi-file lists only)
    virtualizer,
  }: Props = $props();

  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const isDarkTheme = selectIsDarkTheme();

  // Performance: Check if content is too large to render
  const contentTooLarge = $derived.by(() => {
    const oldSize = oldContent?.length ?? 0;
    const newSize = newContent?.length ?? 0;
    const patchSize = patch?.length ?? 0;
    const totalSize = oldSize + newSize + patchSize;
    return totalSize > MAX_CONTENT_SIZE_BYTES;
  });

  // Format file size for display

  // Performance: Calculate total line count to determine if highlighting should be disabled
  const shouldDisableHighlighting = $derived.by(() => {
    if (disableHighlighting) return true;

    // Count lines in content
    const oldLines = oldContent?.split('\n').length ?? 0;
    const newLines = newContent?.split('\n').length ?? 0;
    const totalLines = oldLines + newLines;

    return totalLines > maxHighlightLines;
  });

  // State
  let containerRef: HTMLDivElement | undefined = $state();
  let fileDiffInstance: FileDiff | undefined = $state();
  let collapsed = $state(false);

  const FOLDED_ROW_SELECTOR = "[data-separator='line-info'], [data-separator='line-info-basic']";
  const FOLDED_ROW_NATIVE_EXPAND_SELECTOR = '[data-expand-button], [data-unmodified-lines]';
  const FOLDED_ROW_EXPAND_BUTTON_SELECTOR = '[data-expand-button]:not([data-expand-all-button])';

  // Search state
  type SearchResult = { element: HTMLElement; text: string };

  const SEARCH_CONTENT_SELECTOR = [
    '[data-column-content]',
    '[data-content] [data-line]',
    '[data-content] [data-no-newline]',
    'pre [data-line]',
  ].join(',');
  const SEARCH_HIGHLIGHT_BACKGROUND = 'rgba(255, 213, 0, 0.4)';
  const SEARCH_CURRENT_BACKGROUND = 'rgba(59, 130, 246, 0.5)';
  const SEARCH_SCROLL_MARGIN_PX = 16;
  const SEARCH_DEBOUNCE_MS = 150;

  let searchOpen = $state(false);
  let searchQuery = $state('');
  let searchResults: SearchResult[] = $state([]);
  let currentSearchIndex = $state(0);
  let searchInputRef: HTMLInputElement | null = $state(null);
  let wrapperRef: HTMLDivElement | undefined = $state();
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchRefreshQueued = false;

  // Sync collapsed state with initialCollapsed prop
  $effect(() => {
    collapsed = initialCollapsed;
  });

  // Derive the diff metadata from inputs.
  // Stable cacheKey values (derived from content hashes, never the raw content)
  // are threaded through so the @pierre/diffs worker-pool LRU can hit on repeat
  // renders of the same file.
  const diffData = $derived.by(() => {
    // Skip expensive computation if content is too large
    if (contentTooLarge) return null;

    if (patch) {
      // Parse patch string. `cacheKeyPrefix` lets the parser key per-file
      // cache entries on a stable identifier rather than re-parsing each mount.
      const patchKey = `${fileName}:${hashContent(patch)}`;
      const parsed = parsePatchFiles(patch, patchKey);
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
      // Callers that prepend padding (e.g. partial-diff snippets with a
      // non-1 line offset) pass pre-built keys hashed from the un-padded
      // content so the worker AST cache stays warm across re-mounts.
      const oldKey = oldCacheKey ?? `${oldFileName || fileName}:${hashContent(oldContent)}`;
      const newKey = newCacheKey ?? `${fileName}:${hashContent(newContent)}`;
      const oldFile: FileContents = {
        name: oldFileName || fileName,
        contents: oldContent,
        lang: safeLang as any,
        cacheKey: oldKey,
      };
      const newFile: FileContents = {
        name: fileName,
        contents: newContent,
        lang: safeLang as any,
        cacheKey: newKey,
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

  // Cache concatenated unsafeCSS by the caller-provided suffix so we don't
  // re-stringify the template literal on every options rebuild.
  const UNSAFE_CSS_BASE = `
        pre[data-diffs] {
          --diffs-bg: hsl(var(--background)) !important;
          background: hsl(var(--background)) !important;
        }
        [data-column-number] {
          position: sticky;
          left: 0;
        }
        [data-gutter] [data-separator='line-info'],
        [data-gutter] [data-separator='line-info-basic'],
        [data-gutter] [data-separator='metadata'],
        [data-gutter] [data-separator='custom'] {
          contain: inline-size;
          min-width: 0;
        }
        [data-gutter] [data-separator-content],
        [data-gutter] [data-unmodified-lines] {
          max-width: 0;
          min-width: 0;
          overflow: hidden;
          padding-inline: 0;
          visibility: hidden;
        }
        [data-separator='line-info'],
        [data-separator='line-info-basic'] {
          height: 24px;
        }
        [data-gutter] [data-separator='line-info'] [data-separator-wrapper],
        [data-gutter] [data-separator='line-info-basic'] [data-separator-wrapper] {
          align-items: center;
          background: transparent;
          cursor: pointer;
          display: flex;
          justify-content: flex-end;
          min-width: 0;
          padding: 0;
          width: 100%;
        }
        [data-unified] [data-content] [data-separator='line-info'] [data-separator-wrapper],
        [data-unified] [data-content] [data-separator='line-info-basic'] [data-separator-wrapper],
        [data-deletions] [data-content] [data-separator='line-info'] [data-separator-wrapper],
        [data-deletions] [data-content] [data-separator='line-info-basic'] [data-separator-wrapper] {
          background-color: var(--diffs-bg-separator);
          display: flex;
          min-width: 0;
        }
        [data-content] [data-separator='line-info'] [data-separator-wrapper],
        [data-content] [data-separator='line-info-basic'] [data-separator-wrapper] {
          align-items: center;
          background: transparent;
          cursor: pointer;
          gap: 0.25rem;
        }
        [data-separator='line-info'][data-expand-index],
        [data-separator='line-info-basic'][data-expand-index],
        [data-separator='line-info'][data-expand-index] [data-separator-content],
        [data-separator='line-info-basic'][data-expand-index] [data-separator-content] {
          cursor: pointer;
        }
        [data-unified] [data-content] [data-separator-content],
        [data-deletions] [data-content] [data-separator-content] {
          min-width: 0;
        }
        [data-content] [data-separator='line-info'] [data-expand-button],
        [data-content] [data-separator='line-info-basic'] [data-expand-button] {
          display: none;
        }
        [data-gutter] [data-separator='line-info'] [data-expand-button],
        [data-gutter] [data-separator='line-info-basic'] [data-expand-button] {
          align-self: center;
          background: transparent;
          border-right: 0;
          border-radius: 999px;
          box-sizing: border-box;
          color: var(--diffs-fg-number);
          flex: 0 0 calc(12px + 1ch + 2px);
          font: inherit;
          height: 18px;
          justify-content: flex-end;
          margin-left: auto;
          min-width: calc(12px + 1ch + 2px);
          opacity: 0.72;
          padding-inline: 0 calc(1ch + 2px);
          position: relative;
        }
        [data-content] [data-separator='line-info'] [data-expand-button],
        [data-content] [data-separator='line-info-basic'] [data-expand-button] {
          border-right: 0;
        }
        [data-gutter] [data-separator='line-info'] [data-expand-button]:hover,
        [data-gutter] [data-separator='line-info-basic'] [data-expand-button]:hover,
        [data-content] [data-separator='line-info'] [data-expand-button]:hover,
        [data-content] [data-separator='line-info-basic'] [data-expand-button]:hover {
          background-color: var(--diffs-bg-separator);
          color: var(--diffs-fg);
          opacity: 1;
        }
        [data-gutter] [data-separator='line-info'] [data-expand-button] [data-icon],
        [data-gutter] [data-separator='line-info-basic'] [data-expand-button] [data-icon],
        [data-content] [data-separator='line-info'] [data-expand-button] [data-icon],
        [data-content] [data-separator='line-info-basic'] [data-expand-button] [data-icon] {
          display: none;
        }
        [data-gutter] [data-separator='line-info'] [data-expand-button]:not([data-expand-all-button])::before,
        [data-gutter] [data-separator='line-info-basic'] [data-expand-button]:not([data-expand-all-button])::before,
        [data-content] [data-separator='line-info'] [data-expand-button]:not([data-expand-all-button])::before,
        [data-content] [data-separator='line-info-basic'] [data-expand-button]:not([data-expand-all-button])::before {
          background: currentColor;
          content: '';
          display: block;
          height: 12px;
          width: 12px;
          -webkit-mask: var(--diffs-fold-expand-icon) center / contain no-repeat;
          mask: var(--diffs-fold-expand-icon) center / contain no-repeat;
        }
        [data-gutter] [data-separator='line-info'] [data-expand-up],
        [data-gutter] [data-separator='line-info-basic'] [data-expand-up],
        [data-content] [data-separator='line-info'] [data-expand-up],
        [data-content] [data-separator='line-info-basic'] [data-expand-up] {
          --diffs-fold-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.45' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 3.25h8'/%3E%3Cpath d='M8 5v8'/%3E%3Cpath d='M4.75 9.75 8 13l3.25-3.25'/%3E%3C/svg%3E");
        }
        [data-gutter] [data-separator='line-info'] [data-expand-down],
        [data-gutter] [data-separator='line-info-basic'] [data-expand-down],
        [data-content] [data-separator='line-info'] [data-expand-down],
        [data-content] [data-separator='line-info-basic'] [data-expand-down] {
          --diffs-fold-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.45' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12.75h8'/%3E%3Cpath d='M8 11V3'/%3E%3Cpath d='M4.75 6.25 8 3l3.25 3.25'/%3E%3C/svg%3E");
        }
        [data-gutter] [data-separator='line-info'] [data-expand-both],
        [data-gutter] [data-separator='line-info-basic'] [data-expand-both],
        [data-content] [data-separator='line-info'] [data-expand-both],
        [data-content] [data-separator='line-info-basic'] [data-expand-both] {
          --diffs-fold-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8h8'/%3E%3Cpath d='M8 6V3'/%3E%3Cpath d='M5.75 5.25 8 3l2.25 2.25'/%3E%3Cpath d='M8 10v3'/%3E%3Cpath d='M5.75 10.75 8 13l2.25-2.25'/%3E%3C/svg%3E");
        }
        [data-content] [data-separator='line-info'] [data-separator-content],
        [data-content] [data-separator='line-info-basic'] [data-separator-content] {
          background: transparent;
          color: var(--diffs-fg-number);
          font-size: 0.8125rem;
          height: 18px;
          line-height: 18px;
          padding: 0 0.5rem;
          text-decoration: none;
        }
        [data-expand-index] [data-separator-content]:hover,
        [data-expand-index] [data-unmodified-lines]:hover {
          text-decoration: none;
        }
      `;
  let lastUnsafeSuffix: string | undefined;
  let lastUnsafeCombined = UNSAFE_CSS_BASE;
  function getUnsafeCSS(suffix: string | undefined): string {
    if (suffix === lastUnsafeSuffix) return lastUnsafeCombined;
    lastUnsafeSuffix = suffix;
    lastUnsafeCombined = suffix ? `${UNSAFE_CSS_BASE}${suffix}` : UNSAFE_CSS_BASE;
    return lastUnsafeCombined;
  }

  // Build FileDiff options. Callers can pass a custom hunk separator in
  // `renderHunkSeparator`; otherwise preserve @pierre/diffs' built-in separator
  // structure so folded labels live outside the line-number gutter sizing path.
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
        : hunkSeparators,
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
      // Worker pool is passed at construction time (see `new FileDiff` below).
      theme: {
        dark: 'github-dark',
        light: 'github-light',
      },
      // Use the Redux-backed app theme setting instead of OS preference
      themeType: ($isDarkTheme ? 'dark' : 'light') as ThemeTypes,
      unsafeCSS: getUnsafeCSS(unsafeCSS),
    };
  }

  // Toggle collapse
  function toggleCollapse() {
    collapsed = !collapsed;
    onToggleCollapse?.(collapsed);
  }

  // === Search functions ===
  function openSearch() {
    const selectedText = getSelectedTextWithinSurface(wrapperRef, { extraRoots: getSearchRoots() });
    if (selectedText) {
      searchQuery = selectedText;
      currentSearchIndex = 0;
    }
    searchOpen = true;
    tick().then(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
    });
  }

  function closeSearch() {
    cancelSearchDebounce();
    searchOpen = false;
    searchQuery = '';
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = 0;
  }

  function resetSearchState() {
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = 0;
  }

  function cancelSearchDebounce() {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
  }

  function flushSearchDebounce() {
    if (searchDebounceTimer === null) return;
    cancelSearchDebounce();
    if (searchOpen && searchQuery.trim()) {
      performSearch(searchQuery);
    }
  }

  function scheduleSearch(query: string) {
    cancelSearchDebounce();
    currentSearchIndex = 0;

    if (!searchOpen || !query.trim()) {
      resetSearchState();
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      if (searchOpen && searchQuery.trim()) {
        performSearch(searchQuery);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  async function refreshSearchAfterDiffRender() {
    if (searchRefreshQueued) return;
    searchRefreshQueued = true;
    await tick();
    searchRefreshQueued = false;

    if (searchDebounceTimer !== null) return;
    if (searchOpen && searchQuery.trim()) {
      performSearch(searchQuery);
    } else if (searchOpen) {
      resetSearchState();
    }
  }

  function clearSearchHighlights() {
    // Remove all search highlights
    if (!containerRef) return;

    getSearchRoots().forEach((searchRoot) => {
      const highlights = searchRoot.querySelectorAll('.diff-search-highlight');
      highlights.forEach((el) => {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
          }
          parent.removeChild(el);
          parent.normalize();
        }
      });
    });
  }

  function getSearchRoots(): ParentNode[] {
    if (!containerRef) return [];

    const shadowRoots = Array.from(containerRef.querySelectorAll('diffs-container'))
      .map((diffsContainer) => diffsContainer.shadowRoot)
      .filter((root): root is ShadowRoot => root != null);

    return shadowRoots.length > 0 ? shadowRoots : [containerRef];
  }

  function getSearchContentElements(searchRoot: ParentNode): HTMLElement[] {
    const candidates = Array.from(searchRoot.querySelectorAll<HTMLElement>(SEARCH_CONTENT_SELECTOR));
    const elements: HTMLElement[] = [];

    for (const candidate of candidates) {
      if (elements.some((element) => element.contains(candidate))) continue;
      elements.push(candidate);
    }

    return elements;
  }

  function performSearch(query: string) {
    clearSearchHighlights();
    searchResults = [];
    currentSearchIndex = 0;

    if (!query || !containerRef) return;

    const results: SearchResult[] = [];
    getSearchRoots().forEach((searchRoot) => {
      getSearchContentElements(searchRoot).forEach((el) => {
        highlightTextInElement(el, query);
      });

      // Collect all highlighted elements from the shadow root in DOM order.
      // Filter out elements that are not rendered (e.g., folded or virtualized out).
      const highlighted = searchRoot.querySelectorAll<HTMLElement>('.diff-search-highlight');
      highlighted.forEach((el) => {
        if (isRenderedElement(el)) {
          results.push({ element: el, text: el.textContent || '' });
        }
      });
    });

    searchResults = results;
    if (results.length > 0) {
      navigateToResult(0);
    }
  }

  function highlightTextInElement(element: HTMLElement, query: string) {
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
    let idx = 0;

    while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
      matches.push({ start: idx, end: idx + query.length });
      idx += query.length;
    }

    // Apply highlights in reverse order to preserve original text offsets.
    for (let i = matches.length - 1; i >= 0; i--) {
      const start = getTextPosition(segments, matches[i].start, false);
      const end = getTextPosition(segments, matches[i].end, true);
      if (!start || !end) continue;

      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const span = document.createElement('span');
      span.className = 'diff-search-highlight';
      // Apply inline styles since we're inside Shadow DOM and scoped CSS won't apply.
      span.style.backgroundColor = SEARCH_HIGHLIGHT_BACKGROUND;
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
  }

  function getTextPosition(
    segments: { node: Text; start: number; end: number }[],
    offset: number,
    preferPrevious: boolean,
  ): { node: Text; offset: number } | null {
    const orderedSegments = preferPrevious ? [...segments].reverse() : segments;
    for (const segment of orderedSegments) {
      const withinSegment = preferPrevious
        ? offset > segment.start && offset <= segment.end
        : offset >= segment.start && offset < segment.end;
      if (withinSegment) {
        return { node: segment.node, offset: offset - segment.start };
      }
    }
    return null;
  }

  function isRenderedElement(element: HTMLElement): boolean {
    return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
  }

  function navigateToResult(index: number) {
    flushSearchDebounce();
    if (searchResults.length === 0) return;

    // Remove current highlight style from previous result (reset to normal highlight)
    searchResults.forEach((r) => {
      r.element.classList.remove('diff-search-current');
      r.element.style.backgroundColor = SEARCH_HIGHLIGHT_BACKGROUND;
    });

    // Wrap around
    if (index < 0) index = searchResults.length - 1;
    if (index >= searchResults.length) index = 0;

    currentSearchIndex = index;
    const result = searchResults[index];
    result.element.classList.add('diff-search-current');
    // Apply current highlight style inline (selection-like blue color, no border)
    result.element.style.backgroundColor = SEARCH_CURRENT_BACKGROUND;
    revealSearchResult(result.element);
  }

  function revealSearchResult(element: HTMLElement) {
    const scrollContainers = getScrollableAncestors(element);
    if (scrollContainers.length === 0) {
      element.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return;
    }

    scrollContainers.forEach((container) => scrollElementIntoContainer(element, container));
  }

  function getScrollableAncestors(element: HTMLElement): HTMLElement[] {
    const ancestors: HTMLElement[] = [];
    let current = getComposedParentElement(element);

    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) ancestors.push(current);
      current = getComposedParentElement(current);
    }

    return ancestors;
  }

  function getComposedParentElement(node: Node): HTMLElement | null {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
  }

  function isScrollableElement(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    return canScrollY || canScrollX;
  }

  function scrollElementIntoContainer(element: HTMLElement, container: HTMLElement) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const targetTop = elementRect.top - containerRect.top + container.scrollTop;
    const targetLeft = elementRect.left - containerRect.left + container.scrollLeft;
    const nextTop = Math.max(0, targetTop - container.clientHeight / 2 + elementRect.height / 2);
    let nextLeft = container.scrollLeft;

    if (elementRect.left < containerRect.left + SEARCH_SCROLL_MARGIN_PX) {
      nextLeft = Math.max(0, targetLeft - SEARCH_SCROLL_MARGIN_PX);
    } else if (elementRect.right > containerRect.right - SEARCH_SCROLL_MARGIN_PX) {
      nextLeft = Math.max(0, targetLeft - container.clientWidth + elementRect.width + SEARCH_SCROLL_MARGIN_PX);
    }

    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: nextTop, left: nextLeft, behavior: 'smooth' });
    } else {
      container.scrollTop = nextTop;
      container.scrollLeft = nextLeft;
    }
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) {
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
        scheduleSearch(query);
      } else if (!query) {
        cancelSearchDebounce();
        resetSearchState();
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

  function getComposedElementPath(event: MouseEvent): Element[] {
    return event.composedPath().filter((target): target is Element => target instanceof Element);
  }

  function closestInComposedPath(path: Element[], selector: string): Element | null {
    for (const element of path) {
      const match = element.closest(selector);
      if (match) return match;
    }
    return null;
  }

  function handleFoldedSeparatorRowClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    const elementPath = getComposedElementPath(event);
    if (!containerRef || !elementPath.includes(containerRef)) return;
    if (closestInComposedPath(elementPath, FOLDED_ROW_NATIVE_EXPAND_SELECTOR)) return;

    const foldedRow = closestInComposedPath(elementPath, FOLDED_ROW_SELECTOR);
    if (!foldedRow) return;

    const expandButton = foldedRow.querySelector<HTMLElement>(FOLDED_ROW_EXPAND_BUTTON_SELECTOR);
    if (!expandButton) return;

    event.preventDefault();
    expandButton.click();
  }

  onMount(() => {
    // Add keydown listener to the wrapper
    wrapperRef?.addEventListener('keydown', handleKeydown);
    return () => {
      wrapperRef?.removeEventListener('keydown', handleKeydown);
    };
  });

  $effect(() => {
    const currentContainer = containerRef;
    if (!currentContainer) return;

    currentContainer.addEventListener('click', handleFoldedSeparatorRowClick);

    return () => {
      currentContainer.removeEventListener('click', handleFoldedSeparatorRowClick);
    };
  });

  // Structural signature used to gate expensive `rerender()` calls. Callback
  // refs are applied via `setOptions` (cheap) regardless of signature, so the
  // FileDiff stays consistent even when consumers pass inline closures.
  let lastStructuralSig: string | null = null;
  // Track last rendered diff identity so we only call `render(...)` on real
  // structural changes, not on every reactive re-read inside the init effect.
  let lastDiffDataRef: typeof diffData | null = null;
  let lastContainerRef: HTMLElement | undefined;
  let lastVirtualizerRef: typeof virtualizer | undefined;

  function createFileDiffInstance(options: ReturnType<typeof buildFileDiffOptions>): FileDiff {
    // When a Virtualizer is supplied (multi-file diff list, e.g.
    // `ChatChangesPanel`), use `VirtualizedFileDiff` so the virtualizer
    // swaps off-screen files to height-preserving placeholders and only
    // on-screen files hold live hunk DOM. Otherwise fall back to the
    // plain `FileDiff` path used by single-diff callsites.
    return virtualizer
      ? new VirtualizedFileDiff(options, virtualizer, undefined, getDiffWorkerPool())
      : new FileDiff(options, getDiffWorkerPool());
  }

  // Initialize / update the FileDiff instance.
  // Reuses the same instance across prop changes — `FileDiff.render()` is only
  // invoked when the underlying diff data or container has actually changed.
  $effect(() => {
    if (!containerRef || !diffData) return;

    const sameDiff =
      diffData === lastDiffDataRef &&
      containerRef === lastContainerRef &&
      virtualizer === lastVirtualizerRef;
    if (sameDiff && fileDiffInstance) return;

    // Build options once per structural change and snapshot the signature so
    // the options-effect downstream knows it matches the current render.
    const options = buildFileDiffOptions();
    lastStructuralSig = getStructuralSignature();

    if (fileDiffInstance && virtualizer !== lastVirtualizerRef) {
      fileDiffInstance.cleanUp();
      fileDiffInstance = undefined;
    }

    if (!fileDiffInstance) {
      fileDiffInstance = createFileDiffInstance(options);
      lastVirtualizerRef = virtualizer;
    } else {
      fileDiffInstance.setOptions(options);
    }

    // Read annotations without subscribing — the dedicated annotations effect
    // below handles subsequent updates via the cheaper setLineAnnotations path.
    const initialAnnotations = untrack(() => annotations);

    fileDiffInstance!.render({
      fileDiff: diffData.fileDiff,
      oldFile: diffData.oldFile,
      newFile: diffData.newFile,
      containerWrapper: containerRef,
      lineAnnotations: initialAnnotations as any,
    });

    lastDiffDataRef = diffData;
    lastContainerRef = containerRef;
    lastVirtualizerRef = virtualizer;

    untrack(() => {
      refreshSearchAfterDiffRender();
    });
  });

  // Annotations effect: use `setLineAnnotations` (targeted update) instead of
  // the full `render()` path so annotation churn in chat doesn't blow the
  // worker-pool cache warmup on every tick.
  $effect(() => {
    const currentAnnotations = annotations;
    if (!fileDiffInstance || !lastDiffDataRef) return;
    untrack(() => {
      fileDiffInstance!.setLineAnnotations((currentAnnotations ?? []) as any);
      refreshSearchAfterDiffRender();
    });
  });

  // Compute a structural signature for the options that, when they change,
  // require a full `rerender()`. Callback identity is intentionally excluded
  // — callbacks are refreshed via `setOptions` on every effect run but do not
  // themselves drive a rerender.
  function getStructuralSignature(): string {
    return [
      viewMode,
      diffIndicators,
      showLineNumbers,
      overflow,
      typeof renderHunkSeparator === 'function' ? 'custom' : hunkSeparators,
      expandUnchanged,
      expansionLineCount,
      lineDiffType,
      maxLineDiffLength,
      enableLineSelection,
      enableHoverUtility,
      shouldDisableHighlighting,
      $isDarkTheme,
      unsafeCSS ?? '',
    ].join('|');
  }

  // Options effect: refreshes callback refs cheaply via setOptions, and only
  // triggers a full rerender if the structural signature has changed.
  $effect(() => {
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
      renderHunkSeparator,
      renderHoverUtility,
      renderAnnotation,
    ];

    if (!fileDiffInstance) return;

    const sig = getStructuralSignature();
    const options = buildFileDiffOptions();
    fileDiffInstance.setOptions(options);

    if (sig !== lastStructuralSig) {
      lastStructuralSig = sig;
      fileDiffInstance.rerender();
      untrack(() => {
        refreshSearchAfterDiffRender();
      });
    }
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

  // Keep FileDiff in sync with the Redux-backed app theme.
  $effect(() => {
    const dark = $isDarkTheme;
    if (fileDiffInstance) {
      fileDiffInstance.setThemeType(dark ? 'dark' : 'light');
      untrack(() => {
        refreshSearchAfterDiffRender();
      });
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    cancelSearchDebounce();
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

  {#if !collapsed}
    <div
      class="pure-diff-content"
      class:overflow-auto={overflow === 'scroll'}
      style={maxHeight ? `max-height: calc(${maxHeight} - 40px);` : ''}
    >
      <!-- Search bar -->
      {#if searchOpen}
        <div class="diff-search-bar">
          <PanelFindBar
            bind:query={searchQuery}
            bind:inputRef={searchInputRef}
            layout="inline"
            placeholder="Find in diff..."
            currentMatchIndex={currentSearchIndex}
            totalMatches={searchResults.length}
            emptyResultText="No results"
            onKeydown={handleSearchKeydown}
            onPrevious={() => navigateToResult(currentSearchIndex - 1)}
            onNext={() => navigateToResult(currentSearchIndex + 1)}
            onClose={closeSearch}
          />
        </div>
      {/if}

      {#if diffData}
        <div bind:this={containerRef} class="pure-diff-container" style:--diffs-font-family={$codeFontFamilyCSS}></div>
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

  .diff-search-bar {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    width: 100%;
    min-width: 100%;
    padding: 0.5rem 1rem;
    background: hsl(var(--background));
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
