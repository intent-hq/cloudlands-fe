<script lang="ts">
/* eslint-disable max-lines */
  /**
   * TreeCanvas - Canvas-based tree visualization for better performance
   * Uses caching for instant re-loads
   * Supports zoom, breadcrumb navigation, and color modes
   */
  import type { FileType, ProcessedDataItem, ColorEncoding } from './types';
  import {
  packData,
  LOOSE_FILES_ID,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
} from './tree-processing';
  import { truncateString } from './utils';
  import { navigateToFile } from '$lib/utils/workspace-navigation';
  import {
  layoutCache,
  type CachedPosition,
} from './layout-cache';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import languageColors from './language-colors';
  import Fa from 'svelte-fa';
  import {
  faSearch,
  faFile,
  faFolder,
  faExternalLinkAlt,
} from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('TreeCanvas');

  const MIN_RADIUS_FOR_CURVED_TEXT = 60; // Only curve text for larger circles

  interface Props {
    data: FileType | null;
    filesChanged?: string[]; // Local uncommitted changes (staged + unstaged)
    filesCommitted?: string[]; // Files in unpushed commits
    filesPR?: string[]; // Files in open PRs
    maxDepth?: number;
    colorEncoding?: ColorEncoding;
    customFileColors?: Record<string, string>;
    width?: number;
    height?: number;
    repoName?: string;
  }

  let {
    data,
    filesChanged = [],
    filesCommitted = [],
    filesPR = [],
    maxDepth = 30,
    colorEncoding: externalColorEncoding = 'type',
    customFileColors = {},
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    repoName = 'Repository',
  }: Props = $props();

  // All highlighted files (for layout purposes)
  const allHighlightedFiles = $derived([
    ...new Set([...filesChanged, ...filesCommitted, ...filesPR]),
  ]);

  // Color mode toggle - 'changes' highlights changed files, 'type' colors by extension
  const hasAnyChanges = $derived(allHighlightedFiles.length > 0);
  let showChangesMode = $state(false);

  // Auto-switch to changes mode when any changes exist
  $effect(() => {
    if (hasAnyChanges) {
      showChangesMode = true;
    }
  });

  // Effective color encoding based on toggle
  const colorEncoding = $derived(showChangesMode ? 'type' : externalColorEncoding);

  // Change type colors
  const CHANGE_COLORS = {
    local: '#8b5cf6', // Purple for local uncommitted changes
    committed: '#22c55e', // Green for committed but unpushed
    pr: '#3b82f6', // Blue for files in PRs
  };

  // Zoom state - tracks which folder we're zoomed into
  // Persist in sessionStorage to survive navigation
  // Note: We intentionally capture repoName at initialization for a stable storage key
  // svelte-ignore state_referenced_locally
  const ZOOM_STORAGE_KEY = `viz-zoom-${repoName}`;

  function loadPersistedZoom(): {
    path: string | null;
    transform: { x: number; y: number; scale: number };
  } {
    try {
      const stored = sessionStorage.getItem(ZOOM_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return { path: null, transform: { x: 0, y: 0, scale: 1 } };
  }

  function persistZoom(path: string | null, transform: { x: number; y: number; scale: number }) {
    try {
      sessionStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify({ path, transform }));
    } catch {}
  }

  const initialZoom = loadPersistedZoom();
  let zoomedPath = $state<string | null>(initialZoom.path);

  // Focused path for detailed loading - set after zoom animation completes
  let focusedPath = $state<string | null>(initialZoom.path);

  // Breadcrumb path segments
  const breadcrumbs = $derived.by(() => {
    if (!zoomedPath) return [{ path: '', label: repoName, muted: false }];
    const parts = zoomedPath.split('/');
    const crumbs: { path: string; label: string; muted: boolean }[] = [
      { path: '', label: repoName, muted: false },
    ];
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      // Check if this is the loose files container
      const isLoose = part === LOOSE_FILES_ID || part.startsWith('__structure_loose');
      crumbs.push({
        path: currentPath,
        label: isLoose ? 'direct children' : part,
        muted: isLoose,
      });
    }
    return crumbs;
  });

  // Animated zoom transform for smooth visual zooming
  const zoomTransform = tweened(initialZoom.transform, { duration: 300, easing: cubicOut });

  // Track if user is actively zooming (to prevent re-centering mid-animation)
  let isActivelyZooming = $state(false);

  // Persist zoom state when it changes
  $effect(() => {
    const transform = $zoomTransform;
    persistZoom(zoomedPath, transform);
  });

  // Caches for position and order stability (used by packData)
  let cachedPositions: Record<string, [number, number]> = {};
  let cachedOrders: Record<string, number> = {};

  // Layout state - computed with caching
  let layoutPositions = $state<CachedPosition[]>([]);
  let computedFileTypes = $state<string[]>([]);
  let pendingComputation: number | null = null;

  // Animation state - single global timestamp for scale-in animation
  // Stagger by depth for a nice "expanding" effect from center outward
  const ANIMATION_DURATION = 400; // ms per node
  const STAGGER_PER_DEPTH = 30; // ms delay per depth level
  let animationStartTime: number | null = null;
  let animationFrameId: number | null = null;
  let maxDepthInLayout = 0;

  // Easing function for smooth animation (ease-out cubic)
  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  // Get the animated scale for a node based on its depth (0 to 1)
  function getNodeAnimationScale(depth: number, now: number): number {
    if (animationStartTime === null) return 1; // No animation, fully visible

    // Stagger start time by depth (deeper nodes start later)
    const nodeStartTime = animationStartTime + depth * STAGGER_PER_DEPTH;
    const elapsed = now - nodeStartTime;

    if (elapsed < 0) return 0; // Animation hasn't started for this depth yet
    if (elapsed >= ANIMATION_DURATION) return 1; // Animation complete

    return easeOutCubic(elapsed / ANIMATION_DURATION);
  }

  // Check if animation is complete (all depths finished)
  function isAnimationComplete(now: number): boolean {
    if (animationStartTime === null) return true;
    const totalDuration = ANIMATION_DURATION + maxDepthInLayout * STAGGER_PER_DEPTH;
    return now - animationStartTime >= totalDuration;
  }

  // Animation loop
  function animationLoop() {
    const now = performance.now();
    draw();

    if (!isAnimationComplete(now)) {
      animationFrameId = requestAnimationFrame(animationLoop);
    } else {
      animationFrameId = null;
      animationStartTime = null; // Clear so future draws skip animation checks
    }
  }

  // Start animation when layout first loads
  function startAnimation() {
    animationStartTime = performance.now();
    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(animationLoop);
    }
  }

  // Trigger animation on initial layout load (not on every change)
  let hasAnimatedInitialLoad = false;
  $effect(() => {
    const positions = layoutPositions;
    if (positions.length === 0) return;

    // Calculate max depth for stagger timing
    maxDepthInLayout = Math.max(...positions.map((p) => p.depth), 0);

    // Only animate on first load
    if (!hasAnimatedInitialLoad) {
      hasAnimatedInitialLoad = true;
      startAnimation();
    }
  });

  // Convert cached positions to ProcessedDataItem-like objects for rendering
  const packedData = $derived<ProcessedDataItem[]>(
    layoutPositions.map(
      (pos) =>
        ({
          data: {
            path: pos.path,
            name: pos.name,
            label: pos.label,
            color: pos.color,
            extension: pos.extension,
            size: 0,
            sortOrder: pos.sortOrder,
          },
          x: pos.x,
          y: pos.y,
          r: pos.r,
          depth: pos.depth,
          height: 0,
          parent: null,
          children: pos.hasChildren ? ([] as ProcessedDataItem[]) : undefined,
        }) as unknown as ProcessedDataItem,
    ),
  );

  // When showChangesMode is on, highlight changes with colors
  const doHighlight = $derived(showChangesMode && allHighlightedFiles.length > 0);
  // Always mute non-highlighted files when there are changes (even when showChangesMode is off)
  const hasChanges = $derived(allHighlightedFiles.length > 0);

  // Filter to only real file nodes for hover detection
  // Files are leaf nodes (no children), folders have children
  const fileNodes = $derived(
    packedData.filter(
      (item) =>
        item.depth > 0 &&
        item.depth <= maxDepth &&
        item.data.path !== LOOSE_FILES_ID &&
        !item.data.path.startsWith('__consolidated') &&
        !item.children, // Leaf nodes are files
    ),
  );

  // Folder nodes for click-to-zoom (sorted by depth descending so deeper folders are checked first)
  const folderNodes = $derived(
    packedData
      .filter(
        (item) =>
          item.depth > 0 &&
          item.depth <= maxDepth &&
          item.data.path !== LOOSE_FILES_ID &&
          !item.data.path.startsWith('__consolidated') &&
          item.children, // Has children = is folder
      )
      .sort((a, b) => b.depth - a.depth), // Deeper folders first for correct click detection
  );

  // Track hovered folder separately from hovered file
  let hoveredFilePath = $state<string | null>(null);
  let hoveredFolderPath = $state<string | null>(null);
  let mousePos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  let hoveredFileItem = $derived(
    fileNodes.find((item) => item.data.path === hoveredFilePath) || null,
  );
  let hoveredFolderItem = $derived(
    folderNodes.find((item) => item.data.path === hoveredFolderPath) || null,
  );

  // Combined hovered path for ancestor calculation (file takes priority for labels)
  const hoveredPath = $derived(hoveredFilePath || hoveredFolderPath);

  // Get folder children for hover preview (up to 5 items, files and folders)
  const hoveredFolderChildrenInfo = $derived.by(() => {
    if (!hoveredFolderPath) return { items: [], moreCount: 0 };
    const prefix = hoveredFolderPath + '/';

    // Collect all direct children (files and folders)
    const directChildren: { name: string; isFolder: boolean }[] = [];
    const seenNames = new Set<string>();

    // Check folders first
    for (const folder of folderNodes) {
      if (folder.data.path.startsWith(prefix)) {
        const relativePath = folder.data.path.slice(prefix.length);
        const firstPart = relativePath.split('/')[0];
        if (firstPart && !relativePath.includes('/') && !seenNames.has(firstPart)) {
          seenNames.add(firstPart);
          directChildren.push({ name: firstPart, isFolder: true });
        }
      }
    }

    // Then files
    for (const file of fileNodes) {
      if (file.data.path.startsWith(prefix)) {
        const relativePath = file.data.path.slice(prefix.length);
        if (!relativePath.includes('/')) {
          const name = relativePath;
          if (!seenNames.has(name)) {
            seenNames.add(name);
            directChildren.push({ name, isFolder: false });
          }
        }
      }
    }

    // Sort: folders first, then files
    directChildren.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const moreCount = Math.max(0, directChildren.length - 5);
    return { items: directChildren.slice(0, 5), moreCount };
  });

  // Parse hovered path into name and directory
  const hoveredItemInfo = $derived.by(() => {
    const path = hoveredFilePath || hoveredFolderPath;
    if (!path) return null;
    const parts = path.split('/');
    const name = parts.pop() || path;
    const dir = parts.join('/');
    return { name, dir, isFile: !!hoveredFilePath };
  });

  // Get ancestor paths for hovered item (for showing ancestor labels)
  const hoveredAncestorPaths = $derived.by(() => {
    if (!hoveredPath) return new Set<string>();
    const parts = hoveredPath.split('/');
    const ancestors = new Set<string>();
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      ancestors.add(currentPath);
    }
    return ancestors;
  });

  // Search state
  let searchQuery = $state('');
  let searchOpen = $state(false);
  let searchSelectedIndex = $state(0);
  let searchInputRef: HTMLInputElement | undefined = $state(undefined);
  let searchDropdownRef: HTMLDivElement | undefined = $state(undefined);

  // Fuzzy search results
  const searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const allItems = [...folderNodes, ...fileNodes];

    // Score and filter items
    const scored = allItems
      .map((item) => {
        const path = item.data.path.toLowerCase();
        const name = item.data.name?.toLowerCase() || '';
        let score = 0;

        // Exact name match = highest score
        if (name === query) score = 100;
        // Name starts with query
        else if (name.startsWith(query)) score = 80;
        // Name contains query
        else if (name.includes(query)) score = 60;
        // Path contains query
        else if (path.includes(query)) score = 40;
        // Fuzzy match - check if all chars appear in order
        else {
          let queryIdx = 0;
          for (const char of path) {
            if (char === query[queryIdx]) {
              queryIdx++;
              if (queryIdx === query.length) {
                score = 20;
                break;
              }
            }
          }
        }

        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return scored.map((r) => r.item);
  });

  // Reset selection when results change
  $effect(() => {
    if (searchResults.length > 0) {
      searchSelectedIndex = 0;
    }
  });

  function handleSearchKeyDown(e: KeyboardEvent) {
    if (!searchOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (searchResults.length > 0) {
          searchSelectedIndex = Math.min(searchSelectedIndex + 1, searchResults.length - 1);
          tick().then(scrollToSelectedSearchItem);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (searchResults.length > 0) {
          searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0);
          tick().then(scrollToSelectedSearchItem);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults[searchSelectedIndex]) {
          handleSearchSelect(searchResults[searchSelectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeSearch();
        break;
    }
  }

  function scrollToSelectedSearchItem() {
    if (!searchDropdownRef) return;
    const items = searchDropdownRef.querySelectorAll('[data-search-index]');
    const selected = items[searchSelectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // File path to highlight (from search selection)
  let highlightedFilePath = $state<string | null>(null);

  function handleSearchSelect(item: ProcessedDataItem) {
    const isFolder = !!item.children;
    if (isFolder) {
      zoomToFolder(item.data.path);
    } else {
      // For files: zoom to parent folder and highlight the file
      const parentPath = item.data.path.split('/').slice(0, -1).join('/');
      if (parentPath) {
        zoomToFolder(parentPath);
      }
      highlightedFilePath = item.data.path;
      // Clear highlight after a delay
      setTimeout(() => {
        highlightedFilePath = null;
      }, 3000);
    }
    closeSearch();
  }

  function handleSearchView(item: ProcessedDataItem, e: MouseEvent) {
    e.stopPropagation();
    const isFolder = !!item.children;
    if (isFolder) {
      zoomToFolder(item.data.path);
    } else {
      navigateToFile(item.data.path);
    }
    closeSearch();
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = '';
    searchSelectedIndex = 0;
  }

  function openSearch() {
    searchOpen = true;
    tick().then(() => searchInputRef?.focus());
  }

  function handleSearchBlur() {
    // Close if input is empty
    if (!searchQuery.trim()) {
      closeSearch();
    }
  }

  // Paths that match current search query (for label highlighting)
  const searchMatchPaths = $derived(new Set(searchResults.map((r) => r.data.path)));

  // Currently focused search item path (for highlighting on the canvas)
  const searchFocusedPath = $derived(
    searchOpen && searchResults.length > 0 ? searchResults[searchSelectedIndex]?.data.path : null,
  );

  function getChangeType(path: string): 'local' | 'committed' | 'pr' | null {
    if (filesChanged.includes(path)) return 'local';
    if (filesCommitted.includes(path)) return 'committed';
    if (filesPR.includes(path)) return 'pr';
    return null;
  }

  // Compute layout hash for caching - include focusedPath for different detail levels
  function getLayoutHash(): string {
    const base = layoutCache.hashData(data, colorEncoding, width, height, maxDepth);
    return focusedPath ? `${base}:focus:${focusedPath}` : base;
  }

  // Compute layout synchronously (force simulation runs inside packData)
  function computeLayout() {
    if (!data || width <= 0 || height <= 0) {
      layoutPositions = [];
      return;
    }

    const hash = getLayoutHash();

    // Check cache first - instant load
    const cached = layoutCache.get(hash);
    if (cached) {
      layoutPositions = cached.positions;
      computedFileTypes = cached.fileTypes;
      return;
    }

    // Compute layout - pass focusedPath for detailed loading of that subtree
    const result = packData(
      data,
      colorEncoding,
      customFileColors,
      width,
      height,
      cachedPositions,
      cachedOrders,
      filesChanged,
      focusedPath,
    );

    // Convert to cached format
    const positions: CachedPosition[] = result.packedData.map((item) => ({
      path: item.data.path,
      x: item.x,
      y: item.y,
      r: item.r,
      depth: item.depth,
      color: item.data.color || '#71717a',
      label: item.data.label,
      name: item.data.name,
      extension: item.data.extension,
      hasChildren: !!item.children?.length,
      sortOrder: item.data.sortOrder || 0,
    }));

    // Debug: count files vs folders in packed data
    const files = positions.filter((p) => !p.hasChildren && p.extension);
    const folders = positions.filter((p) => p.hasChildren);
    const noExt = positions.filter((p) => !p.hasChildren && !p.extension);
    // Find files in focused path
    const focusedFiles = focusedPath
      ? files.filter((f) => f.path.startsWith(focusedPath + '/'))
      : [];
    logger.debug('Packed data:', {
      total: positions.length,
      files: files.length,
      folders: folders.length,
      noExtension: noExt.length,
      focusedPath,
      focusedFiles: focusedFiles.length,
    });

    // Cache for next time
    layoutCache.set(hash, {
      positions,
      fileTypes: result.fileTypes,
      colorExtent: result.colorExtent,
      timestamp: Date.now(),
    });

    layoutPositions = positions;
    computedFileTypes = result.fileTypes;

    // If we have a zoomed path restored from session, re-center on it
    // Skip if user is actively zooming to avoid interrupting animation
    if (zoomedPath && positions.length > 0 && !isActivelyZooming) {
      const folder = positions.find((p) => p.path === zoomedPath && p.hasChildren);
      if (folder) {
        const padding = 20;
        const targetSize = Math.min(width, height) - padding * 2;
        const newScale = targetSize / (folder.r * 2);
        const tx = width / 2 - folder.x * newScale;
        const ty = height / 2 - folder.y * newScale;
        // Set immediately without animation
        zoomTransform.set({ x: tx, y: ty, scale: newScale }, { duration: 0 });
      }
    }
  }

  // Debounced layout computation using requestIdleCallback
  function requestLayout() {
    if (pendingComputation !== null) {
      cancelIdleCallback(pendingComputation);
    }

    // Use requestIdleCallback for non-blocking computation (max 100ms delay)
    pendingComputation = requestIdleCallback(
      () => {
        computeLayout();
        pendingComputation = null;
      },
      { timeout: 100 },
    );
  }

  // Trigger layout computation when structural inputs change
  $effect(() => {
    // Create reactive dependencies by reading values into local vars
    const _data = data;
    const _width = width;
    const _height = height;
    const _focusedPath = focusedPath;

    if (_data && _width > 0 && _height > 0) {
      logger.debug('Layout deps changed, requesting layout. focusedPath:', _focusedPath);
      requestLayout();
    }
  });

  // Cleanup on unmount
  $effect(() => {
    return () => {
      if (pendingComputation !== null) {
        cancelIdleCallback(pendingComputation);
      }
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  });

  let canvas: HTMLCanvasElement | null = $state(null);
  let container: HTMLDivElement | null = $state(null);

  // Cache resolved CSS colors
  let cssColors = $state<Record<string, string>>({});

  function resolveCSSColors() {
    if (!container) return;
    const style = getComputedStyle(container);
    cssColors = {
      border: style.getPropertyValue('--color-border').trim() || '#27272a',
      muted: style.getPropertyValue('--color-muted').trim() || '#27272a',
      mutedForeground: style.getPropertyValue('--color-muted-foreground').trim() || '#a1a1aa',
      foreground: style.getPropertyValue('--color-foreground').trim() || '#fafafa',
      sidebar: style.getPropertyValue('--color-sidebar').trim() || '#09090b',
      primary: style.getPropertyValue('--color-primary').trim() || '#8b5cf6',
    };
  }

  function isHighlighted(path: string): boolean {
    return allHighlightedFiles.includes(path);
  }

  function getFillColor(item: ProcessedDataItem): string {
    const baseColor = item.data.color || '#71717a';
    if (doHighlight) {
      const changeType = getChangeType(item.data.path);
      if (changeType) {
        return CHANGE_COLORS[changeType];
      }
      return baseColor;
    }
    return baseColor;
  }

  // Draw curved text along an arc
  function drawCurvedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    radius: number,
    strokeColor: string,
    fillColor: string,
    scale: number = 1,
  ) {
    // Measure total text width
    const chars = text.split('');
    const charWidths = chars.map((c) => ctx.measureText(c).width);
    const totalWidth = charWidths.reduce((a, b) => a + b, 0);

    // Calculate the angle span needed for the text
    const angleSpan = totalWidth / radius;

    // Start angle (centered at top of circle)
    let angle = -Math.PI / 2 - angleSpan / 2;

    ctx.save();

    // Draw each character along the arc
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const charWidth = charWidths[i];

      // Position for this character
      const charAngle = angle + charWidth / 2 / radius;
      const charX = cx + Math.cos(charAngle) * radius;
      const charY = cy + Math.sin(charAngle) * radius;

      ctx.save();
      ctx.translate(charX, charY);
      ctx.rotate(charAngle + Math.PI / 2); // Rotate to follow arc tangent

      // Background stroke - scale-adjusted
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 4 / scale;
      ctx.lineJoin = 'round';
      ctx.strokeText(char, 0, 0);

      // Foreground
      ctx.fillStyle = fillColor;
      ctx.fillText(char, 0, 0);

      ctx.restore();

      // Move to next character position
      angle += charWidth / radius;
    }

    ctx.restore();
  }

  // Draw the visualization
  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Apply zoom transform
    const { x: tx, y: ty, scale } = $zoomTransform;
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    // Viewport culling - calculate visible area in canvas coordinates
    // This allows us to skip rendering nodes outside the viewport
    const viewportLeft = -tx / scale;
    const viewportTop = -ty / scale;
    const viewportRight = (width - tx) / scale;
    const viewportBottom = (height - ty) / scale;
    const viewportPadding = 50 / scale; // Extra padding for labels

    // Check if a circle is visible in the viewport
    function isVisible(x: number, y: number, r: number): boolean {
      return (
        x + r >= viewportLeft - viewportPadding &&
        x - r <= viewportRight + viewportPadding &&
        y + r >= viewportTop - viewportPadding &&
        y - r <= viewportBottom + viewportPadding
      );
    }

    const borderColor = cssColors.border || '#27272a';
    const sidebarColor = cssColors.sidebar || '#09090b';
    const mutedFgColor = cssColors.mutedForeground || '#a1a1aa';
    const fgColor = cssColors.foreground || '#fafafa';

    // Current time for animations
    const now = performance.now();

    // Layer 1: Parent circles (backgrounds)
    for (const item of packedData) {
      const { x, y, r, depth, data: nodeData, children } = item;
      if (depth <= 0 || depth > maxDepth || nodeData.path === LOOSE_FILES_ID) continue;
      if (!children) continue; // Only parents

      // Apply animation scale (staggered by depth)
      const animScale = getNodeAnimationScale(depth, now);
      const animatedR = r * animScale;
      if (animatedR < 0.1) continue; // Skip nearly invisible circles

      if (!isVisible(x, y, animatedR)) continue; // Viewport culling

      const isHoveredFolder = hoveredFolderPath === nodeData.path;

      ctx.beginPath();
      ctx.arc(x, y, animatedR, 0, Math.PI * 2);
      ctx.fillStyle = cssColors.muted;
      ctx.globalAlpha = (isHoveredFolder ? 0.3 : 0.15) * animScale;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isHoveredFolder ? 'rgba(139, 92, 246, 0.6)' : borderColor;
      ctx.lineWidth = (isHoveredFolder ? 2 : 1) / scale; // Keep stroke width consistent
      ctx.stroke();
    }

    // Layer 2: File circles (leaf nodes without children)
    const MIN_FILE_SCREEN_RADIUS = 0.5; // Minimum visible radius for files (only when zoomed in)
    const HOVER_SCREEN_RADIUS = 4; // Larger radius when hovered

    let filesDrawn = 0;
    let filesSkippedVisibility = 0;
    let filesSkippedDepth = 0;
    let filesSkippedFolder = 0;

    for (const item of packedData) {
      const { x, y, r, depth, data: nodeData, children } = item;
      if (depth <= 0 || depth > maxDepth || nodeData.path === LOOSE_FILES_ID) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        filesSkippedDepth++;
        continue;
      }
      if (children) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        filesSkippedFolder++;
        continue;
      }

      // Apply animation scale (staggered by depth)
      const animScale = getNodeAnimationScale(depth, now);
      if (animScale < 0.01) continue; // Skip nearly invisible circles

      // Skip files smaller than 1px on screen
      const screenRadius = r * scale * animScale;
      if (screenRadius < 1) {
        filesSkippedVisibility++;
        continue;
      }

      if (!isVisible(x, y, r * animScale)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        filesSkippedVisibility++;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      filesDrawn++;

      const isHovered = hoveredFilePath === nodeData.path;
      const fillColor = getFillColor(item);
      const highlighted = isHighlighted(nodeData.path);

      // Calculate final radius:
      // - When zoomed in (scale > 2), apply minimum visible radius
      // - Highlighted files get 4px minimum
      // - Hovered files get 4px minimum
      let finalRadius = r * animScale;
      if (scale > 2)
        finalRadius = Math.max(finalRadius, (MIN_FILE_SCREEN_RADIUS / scale) * animScale);
      if (highlighted && hasChanges) finalRadius = Math.max(finalRadius, (4 / scale) * animScale);
      if (isHovered) finalRadius = Math.max(finalRadius, (HOVER_SCREEN_RADIUS / scale) * animScale);

      ctx.beginPath();
      ctx.arc(x, y, finalRadius, 0, Math.PI * 2);
      // When highlight mode is on, use mutedForeground for non-changed files
      ctx.fillStyle = doHighlight && !highlighted ? mutedFgColor : fillColor;
      ctx.globalAlpha = doHighlight && !highlighted ? 0.3 : 1;
      ctx.fill();

      // Add subtle stroke to make files more visible
      ctx.strokeStyle = doHighlight && !highlighted ? mutedFgColor : fillColor;
      ctx.lineWidth = 0.5 / scale;
      ctx.globalAlpha = doHighlight && !highlighted ? 0.2 : 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Debug: log file drawing stats when zoomed
    if (scale > 2) {
      const filesInFocused = zoomedPath
        ? packedData.filter((p) => !p.children && p.data.path.startsWith(zoomedPath + '/'))
        : [];
      // Check which focused files passed visibility
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const focusedFilesVisible = filesInFocused.filter((f) => {
        const dr = Math.max(f.r, MIN_FILE_SCREEN_RADIUS / scale);
        return isVisible(f.x, f.y, dr);
      });
    }

    // Layer 3: Parent labels - only show when hovering their descendants
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of packedData) {
      const { x, y, r, depth, data: nodeData, children } = item;
      if (depth <= 0 || depth > maxDepth || nodeData.path === LOOSE_FILES_ID) continue;
      if (!children || depth === maxDepth) continue;

      // Apply animation scale for label visibility (staggered by depth)
      const animScale = getNodeAnimationScale(depth, now);
      const animatedR = r * animScale;
      if (animScale < 0.5) continue; // Don't show labels until circle is half-sized

      if (!isVisible(x, y, animatedR)) continue; // Viewport culling

      // Show labels based on hover state:
      // - When hovering: only show hovered folder + ancestors of hovered item
      // - When not hovering: show labels for large folders
      const isAncestorOfHovered = hoveredAncestorPaths.has(nodeData.path);
      const isHoveredFolder = hoveredFolderPath === nodeData.path;
      const isHovering = hoveredFilePath || hoveredFolderPath;
      const isSearchMatch = searchMatchPaths.has(nodeData.path);
      // Use screen radius for all size-based decisions
      const screenRadius = animatedR * scale;
      const isLargeEnough = screenRadius >= 40; // 40px on screen
      const shouldShowLabel = isHovering
        ? isHoveredFolder || isAncestorOfHovered
        : isSearchMatch || isLargeEnough;

      if (!shouldShowLabel) continue;
      if (!nodeData.label) continue;
      // Only skip if label is way too long for the circle (use screen radius)
      if (
        nodeData.label.length > screenRadius * 0.15 &&
        !isSearchMatch &&
        !isHoveredFolder &&
        !isAncestorOfHovered
      )
        continue;

      // Truncate based on screen radius
      const maxChars =
        screenRadius < 60 ? Math.floor(screenRadius / 5) + 3 : Math.floor(screenRadius * 0.3);
      const label = truncateString(nodeData.label, maxChars);

      // Font size relative to screen radius (clamped between 10-16px on screen)
      const baseFontSize = Math.min(Math.max(screenRadius * 0.12, 10), 16);
      const fontSize = baseFontSize / scale;
      ctx.font = `${fontSize}px system-ui, sans-serif`;

      // Apply label opacity based on animation progress
      const labelOpacity = Math.min(1, (animScale - 0.5) * 2); // Fade in from 0.5 to 1

      // Use screen radius threshold for curved text
      if (screenRadius >= MIN_RADIUS_FOR_CURVED_TEXT) {
        // Draw curved text along the top arc
        ctx.globalAlpha = labelOpacity;
        drawCurvedText(ctx, label, x, y, animatedR + 4 / scale, sidebarColor, mutedFgColor, scale);
        ctx.globalAlpha = 1;
      } else {
        // Draw straight text above the circle
        const labelY = y - animatedR - (baseFontSize + 4) / scale;

        // Background stroke
        ctx.strokeStyle = sidebarColor;
        ctx.lineWidth = 4 / scale;
        ctx.lineJoin = 'round';
        ctx.globalAlpha = labelOpacity;
        ctx.strokeText(label, x, labelY);

        // Foreground
        ctx.fillStyle = mutedFgColor;
        ctx.fillText(label, x, labelY);
        ctx.globalAlpha = 1;
      }
    }

    // Layer 4: File labels - skip when hovering a file (we show hover-specific labels)
    const hasSearchMatches = searchMatchPaths.size > 0;
    if (!hoveredFileItem) {
      for (const item of packedData) {
        const { x, y, r, depth, data: nodeData, children } = item;
        if (depth <= 0 || depth > maxDepth || nodeData.path === LOOSE_FILES_ID) continue;
        if (!isVisible(x, y, r)) continue; // Viewport culling

        const highlighted = isHighlighted(nodeData.path);
        const isSearchMatch = searchMatchPaths.has(nodeData.path);
        const isHighlightedFile = highlightedFilePath === nodeData.path;
        const isParent = !!children;

        // Use screen radius for size decisions
        const screenRadius = r * scale;
        const isLargeEnough = screenRadius >= 44; // 44px on screen

        // Skip folders here (they have their own label logic)
        if (isParent) continue;

        // When searching, only show search matches
        if (hasSearchMatches) {
          if (!isSearchMatch && !isHighlightedFile) continue;
        } else {
          // Normal mode: show if large enough, highlighted, or search match
          if (!isLargeEnough && !highlighted && !isSearchMatch && !isHighlightedFile) continue;
        }

        // Truncate based on screen radius - allow more chars for larger bubbles
        const maxChars = Math.floor(screenRadius * 0.3) + 5;
        const label =
          highlighted || isSearchMatch || isHighlightedFile
            ? nodeData.label || ''
            : truncateString(nodeData.label || '', maxChars);

        // Draw label in screen space for crisp text
        const screenX = x * scale + $zoomTransform.x;
        const screenY = (y + r) * scale + $zoomTransform.y;
        const baseFontSize = Math.min(Math.max(screenRadius * 0.22, 10), 14);

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to screen space

        ctx.font = `${baseFontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelY = screenY + 4;

        // Background stroke
        ctx.strokeStyle = sidebarColor;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(label, screenX, labelY);

        // Foreground
        ctx.fillStyle = isSearchMatch || isHighlightedFile ? cssColors.primary : fgColor;
        ctx.fillText(label, screenX, labelY);

        ctx.restore();
      }
    }

    // Layer 4.5: Highlighted file ring (from search selection)
    if (highlightedFilePath) {
      const highlightedItem = fileNodes.find((f) => f.data.path === highlightedFilePath);
      if (highlightedItem) {
        const { x, y, r } = highlightedItem;
        ctx.beginPath();
        ctx.arc(x, y, r + 3 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = cssColors.primary;
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    }

    // Layer 4.6: Search focus highlight ring (while navigating search results)
    if (searchFocusedPath) {
      // Check both files and folders since search can match either
      const focusedItem =
        fileNodes.find((f) => f.data.path === searchFocusedPath) ||
        folderNodes.find((f) => f.data.path === searchFocusedPath);
      if (focusedItem) {
        const { x, y, r } = focusedItem;
        // Pulsing ring effect for search focus
        ctx.beginPath();
        ctx.arc(x, y, r + 4 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = cssColors.primary || '#8b5cf6';
        ctx.lineWidth = 2.5 / scale;
        ctx.stroke();
        // Outer glow
        ctx.beginPath();
        ctx.arc(x, y, r + 7 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = cssColors.primary || '#8b5cf6';
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 3 / scale;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Layer 5: Hover highlight - show file label and highlight ring
    if (hoveredFileItem) {
      const { x, y, r, data: nodeData } = hoveredFileItem;
      const screenRadius = r * scale;

      // Hover ring
      ctx.beginPath();
      ctx.arc(x, y, r + 2 / scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // Draw hover label in screen space for crisp text
      const label = nodeData.label || nodeData.name;
      const screenX = x * scale + $zoomTransform.x;
      const screenY = (y - r) * scale + $zoomTransform.y;
      const baseFontSize = Math.min(Math.max(screenRadius * 0.25, 11), 14);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to screen space

      ctx.font = `${baseFontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const labelY = screenY - 4;

      ctx.strokeStyle = sidebarColor;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(label, screenX, labelY);

      ctx.fillStyle = fgColor;
      ctx.fillText(label, screenX, labelY);

      ctx.restore();
    }

    ctx.restore();
  }

  // Resolve CSS colors when container is ready
  $effect(() => {
    if (!container) return;
    resolveCSSColors();
  });

  // Redraw when data changes or zoom changes
  $effect(() => {
    // Dependencies
    packedData;
    hoveredFileItem;
    hoveredFolderItem;
    hoveredAncestorPaths;
    doHighlight;
    hasChanges;
    cssColors;
    $zoomTransform;

    draw();
  });

  // Setup canvas with proper DPR
  $effect(() => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    draw();
  });

  // Convert screen coordinates to canvas coordinates (accounting for zoom)
  function screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const { x: tx, y: ty, scale } = $zoomTransform;
    return {
      x: (screenX - tx) / scale,
      y: (screenY - ty) / scale,
    };
  }

  const MIN_HOVER_RADIUS = 2; // Elements must be at least 2px radius to be hover targets

  function handleMouseMove(event: MouseEvent) {
    if (!canvas) {
      hoveredFilePath = null;
      hoveredFolderPath = null;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    mousePos = { x: screenX, y: screenY };
    const { x, y } = screenToCanvas(screenX, screenY);
    const { scale } = $zoomTransform;

    // Check for file hover - skip files smaller than 2px
    let foundFile: ProcessedDataItem | null = null;
    let closestDist = Infinity;
    for (const file of fileNodes) {
      // Skip tiny files - not hover targets
      if (file.r * scale < MIN_HOVER_RADIUS) continue;

      const dx = file.x - x;
      const dy = file.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= file.r + 2 / scale && distance < closestDist) {
        foundFile = file;
        closestDist = distance;
      }
    }

    // Check for folder hover - skip folders smaller than 2px
    let foundFolder: ProcessedDataItem | null = null;
    for (const folder of folderNodes) {
      // Skip tiny folders - not hover targets
      if (folder.r * scale < MIN_HOVER_RADIUS) continue;

      const dx = folder.x - x;
      const dy = folder.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= folder.r) {
        foundFolder = folder;
        break; // folderNodes are sorted by depth, so first match is deepest
      }
    }

    // File takes priority if found
    if (foundFile) {
      hoveredFilePath = foundFile.data.path;
      hoveredFolderPath = null;
      return;
    }

    // Otherwise show folder hover
    hoveredFilePath = null;
    hoveredFolderPath = foundFolder?.data.path || null;
  }

  function handleMouseLeave() {
    hoveredFilePath = null;
    hoveredFolderPath = null;
  }

  // Zoom to a specific folder with smooth visual animation
  function zoomToFolder(folderPath: string | null) {
    if (folderPath === null || folderPath === '') {
      // Zoom out to root
      zoomedPath = null;
      focusedPath = null;
      isActivelyZooming = true;
      zoomTransform.set({ x: 0, y: 0, scale: 1 }).then(() => {
        isActivelyZooming = false;
      });
      return;
    }

    // Find the folder in current packed data
    const folder = packedData.find((item) => item.data.path === folderPath && item.children);
    if (!folder) return;

    zoomedPath = folderPath;

    // Animate to folder position
    const { x: fx, y: fy, r: fr } = folder;
    const padding = 20;
    const targetSize = Math.min(width, height) - padding * 2;
    const scale = targetSize / (fr * 2);
    const tx = width / 2 - fx * scale;
    const ty = height / 2 - fy * scale;

    isActivelyZooming = true;
    zoomTransform.set({ x: tx, y: ty, scale }).then(() => {
      isActivelyZooming = false;
    });
  }


  function handleClick(_event: MouseEvent) {
    // Click on whatever is currently hovered (shown in hover card)
    if (hoveredFilePath) {
      navigateToFile(hoveredFilePath);
    } else if (hoveredFolderPath) {
      zoomToFolder(hoveredFolderPath);
    } else if (zoomedPath) {
      // Click outside any item while zoomed - zoom out to parent
      const parentPath = zoomedPath.split('/').slice(0, -1).join('/');
      zoomToFolder(parentPath || null);
    }
  }

  // Get siblings at the current zoom level
  function getSiblingsAtCurrentLevel(): string[] {
    if (!zoomedPath) {
      // At root - get first level folders
      return packedData
        .filter((item) => item.depth === 1 && item.children)
        .map((item) => item.data.path)
        .sort();
    }
    // Get siblings of current zoomed folder
    const parentPath = zoomedPath.split('/').slice(0, -1).join('/');
    return packedData
      .filter((item) => {
        if (!item.children) return false;
        const itemParent = item.data.path.split('/').slice(0, -1).join('/');
        return itemParent === parentPath;
      })
      .map((item) => item.data.path)
      .sort();
  }

  // Navigate to next/previous sibling
  function navigateToSibling(direction: 'next' | 'prev') {
    const siblings = getSiblingsAtCurrentLevel();
    if (siblings.length === 0) return;

    const currentPath = zoomedPath || '';
    const currentIndex = siblings.indexOf(currentPath);

    let nextIndex: number;
    if (currentIndex === -1) {
      // Not zoomed or not found - go to first
      nextIndex = direction === 'next' ? 0 : siblings.length - 1;
    } else if (direction === 'next') {
      nextIndex = (currentIndex + 1) % siblings.length;
    } else {
      nextIndex = (currentIndex - 1 + siblings.length) % siblings.length;
    }

    zoomToFolder(siblings[nextIndex]);
  }

  function handleGlobalKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const isInInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // "/" opens search if not already in an input
    if (e.key === '/' && !searchOpen && !isInInput) {
      e.preventDefault();
      openSearch();
    }

    // "n" / "N" cycles through siblings
    if ((e.key === 'n' || e.key === 'N') && !isInInput && !searchOpen) {
      e.preventDefault();
      navigateToSibling(e.shiftKey ? 'prev' : 'next');
    }

    // Escape zooms out one level when zoomed in
    if (e.key === 'Escape' && !searchOpen && zoomedPath) {
      e.preventDefault();
      const parentPath = zoomedPath.split('/').slice(0, -1).join('/');
      zoomToFolder(parentPath || null);
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={container}
  class="relative flex flex-col max-w-full overflow-hidden"
  style="width: {width}px;"
>
  <!-- Breadcrumb navigation -->
  {#if zoomedPath}
    <div class="flex items-center gap-1 px-2 py-1.5 text-xs text-subtle overflow-x-auto">
      {#each breadcrumbs as crumb, i (`crumb-${i}-${crumb.path}`)}
        {#if i > 0}
          <span class="opacity-40">/</span>
        {/if}
        <button
          class="hover:text-foreground transition-colors truncate max-w-[120px] cursor-pointer {i ===
          breadcrumbs.length - 1
            ? crumb.muted
              ? 'text-muted-foreground'
              : 'text-foreground font-medium'
            : ''} {crumb.muted ? 'italic' : ''}"
          onclick={() => zoomToFolder(crumb.path)}
        >
          {crumb.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="relative">
    <canvas
      bind:this={canvas}
      class="cursor-pointer"
      style="width: {width}px; height: {height}px;"
      onmousemove={handleMouseMove}
      onmouseleave={handleMouseLeave}
      onclick={handleClick}
      aria-label="Codebase visualization"
    ></canvas>

    <!-- Hover card -->
    {#if hoveredItemInfo}
      {@const cardX = Math.min(mousePos.x + 12, width - 220)}
      {@const cardY = Math.min(mousePos.y + 12, height - 120)}
      <div
        class="absolute pointer-events-none bg-popover/95 backdrop-blur-sm border border-border rounded-md shadow-lg px-3 py-2 text-xs max-w-[220px] z-10"
        style="left: {cardX}px; top: {cardY}px;"
      >
        <div class="flex items-start gap-1.5">
          <i
            class="fa fa-{hoveredItemInfo.isFile
              ? 'file-o'
              : 'folder-o'} text-ghost mt-0.5 shrink-0"
          ></i>
          <div class="min-w-0">
            <div class="font-medium text-foreground break-words">{hoveredItemInfo.name}</div>
            {#if hoveredItemInfo.dir}
              <div class="text-subtle text-ui break-words line-clamp-3">
                {hoveredItemInfo.dir}
              </div>
            {/if}
          </div>
        </div>
        {#if !hoveredItemInfo.isFile && hoveredFolderChildrenInfo.items.length > 0}
          <div class="mt-1.5 pt-1.5 border-t border-border/50 text-subtle space-y-0.5">
            {#each hoveredFolderChildrenInfo.items as child, childIdx (`child-${childIdx}-${child.name}`)}
              <div class="flex items-center gap-1.5 truncate">
                <i
                  class="fa fa-{child.isFolder
                    ? 'folder-o'
                    : 'file-o'} text-ui shrink-0 opacity-30"
                ></i>
                <span class="truncate">{child.name}</span>
              </div>
            {/each}
            {#if hoveredFolderChildrenInfo.moreCount > 0}
              <div class="text-ui opacity-60">+ {hoveredFolderChildrenInfo.moreCount} more</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Search overlay - top left corner -->
    <div class="absolute top-2 left-2 z-20">
      {#if searchOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="bg-popover/95 backdrop-blur-sm border border-border rounded-md shadow-lg w-72"
          onkeydown={handleSearchKeyDown}
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Fa icon={faSearch} class="text-ghost w-3 h-3" />
            <input
              bind:this={searchInputRef}
              bind:value={searchQuery}
              type="text"
              placeholder="Search files and folders..."
              class="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground focus:outline-none! focus:ring-0!"
              onblur={handleSearchBlur}
            />
            <button
              class="text-muted-foreground hover:text-foreground text-xs"
              onclick={closeSearch}
            >
              ESC
            </button>
          </div>
          {#if searchResults.length > 0}
            <div bind:this={searchDropdownRef} class="max-h-64 overflow-y-auto py-1">
              {#each searchResults as item, idx (item.data.path)}
                {@const isFolder = !!item.children}
                {@const changeType = getChangeType(item.data.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  data-search-index={idx}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors group cursor-pointer {idx ===
                  searchSelectedIndex
                    ? 'bg-muted/20'
                    : 'hover:bg-muted-foreground/10'}"
                  onclick={() => handleSearchSelect(item)}
                  onmouseenter={() => (searchSelectedIndex = idx)}
                >
                  <Fa
                    icon={isFolder ? faFolder : faFile}
                    class="w-3 h-3 shrink-0 {isFolder ? 'text-amber-500' : 'text-muted-foreground'}"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate font-medium">{item.data.name}</span>
                      {#if changeType}
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          style="background-color: {changeType === 'local'
                            ? CHANGE_COLORS.local
                            : changeType === 'committed'
                              ? CHANGE_COLORS.committed
                              : CHANGE_COLORS.pr}"
                        ></span>
                      {/if}
                    </div>
                    <div class="text-ui text-subtle truncate">
                      {item.data.path}
                    </div>
                  </div>
                  <button
                    class="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0"
                    onclick={(e) => handleSearchView(item, e)}
                    title={isFolder ? 'Focus folder' : 'Open file'}
                  >
                    <Fa icon={faExternalLinkAlt} class="w-3 h-3" />
                  </button>
                </div>
              {/each}
            </div>
          {:else if searchQuery}
            <div class="px-3 py-4 text-center text-sm text-subtle">
              No results for "{searchQuery}"
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs bg-background/70 text-muted-foreground hover:bg-background/90 hover:text-foreground transition-all cursor-pointer"
          onclick={openSearch}
        >
          <Fa icon={faSearch} class="w-3 h-3" />
          <span>Search</span>
          <kbd class="text-ui px-1 py-0.5 rounded bg-muted ml-1">/</kbd>
        </button>
      {/if}
    </div>

    <!-- Legend overlay - bottom right corner -->
    <div class="absolute bottom-2 right-2 flex flex-col items-end gap-1.5">
      <!-- File type legend when not highlighting changes -->
      {#if !showChangesMode && computedFileTypes.length > 0}
        <div
          class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs bg-background/70 text-subtle"
        >
          {#each computedFileTypes.slice(0, 8) as ext (ext)}
            <span class="flex items-center gap-1">
              <span
                class="w-2 h-2 rounded-full"
                style="background-color: {languageColors[ext] || '#71717a'}"
              ></span>
              <span>.{ext}</span>
            </span>
          {/each}
          {#if computedFileTypes.length > 8}
            <span class="opacity-50">+{computedFileTypes.length - 8}</span>
          {/if}
        </div>
      {/if}

      <!-- Changes toggle -->
      {#if allHighlightedFiles.length > 0}
        <button
          class="flex items-center gap-3 px-2.5 py-1.5 rounded text-xs cursor-pointer border {showChangesMode
            ? 'bg-background/95 text-foreground shadow-sm border-border'
            : 'bg-background/70 text-muted-foreground hover:bg-background/90 border-border/10'}"
          onclick={() => (showChangesMode = !showChangesMode)}
          title={showChangesMode ? 'Click to show file types' : 'Click to highlight changes'}
        >
          <span class="opacity-60"
            >{showChangesMode ? 'Highlighting changed files' : 'Highlight changed files'}</span
          >
          {#if filesChanged.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.local}"
              ></span>
              <span>{filesChanged.length} local</span>
            </span>
          {/if}
          {#if filesCommitted.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.committed}"
              ></span>
              <span>{filesCommitted.length} unpushed</span>
            </span>
          {/if}
          {#if filesPR.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.pr}"
              ></span>
              <span>{filesPR.length} in PR</span>
            </span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>
