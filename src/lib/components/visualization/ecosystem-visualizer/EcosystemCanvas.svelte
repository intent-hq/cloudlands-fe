<script lang="ts">
/* eslint-disable max-lines */
  /**
   * EcosystemCanvas - Canvas-based organic visualization
   * Uses force simulation for layout and smooth blob shapes for folders
   * Features: pan/zoom, search, folder navigation
   */
  import type { FileNode, ProcessedNode, BlobShape, EcosystemSettings } from './types';
  import { DEFAULT_ECOSYSTEM_SETTINGS } from './types';
  import {
  processTree,
  getLeafNodes,
  findNodeAtPosition,
} from './tree-processor';
  import { runForceSimulation } from './force-simulation';
  import {
  computeBlobShapes,
  drawBlobToCanvas,
} from './blob-shapes';
  import {
  tick,
  untrack,
} from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import * as m from '$shared/paraglide/messages.js';

  // Change type colors matching repo-visualizer
  const CHANGE_COLORS = {
    local: '#8b5cf6', // Purple for local uncommitted changes
    committed: '#22c55e', // Green for committed but unpushed
    pr: '#3b82f6', // Blue for files in PRs
  };

  interface Props {
    data: FileNode;
    width?: number;
    height?: number;
    filesChanged?: string[]; // Local uncommitted changes
    filesCommitted?: string[]; // Committed but unpushed
    filesPR?: string[]; // Files in open PRs
    onFileClick?: (path: string) => void;
    repoName?: string;
    settings?: Partial<EcosystemSettings>;
  }

  let {
    data,
    width = 600,
    height = 600,
    filesChanged = [],
    filesCommitted = [],
    filesPR = [],
    onFileClick,
    repoName = 'Repository',
    settings = {},
  }: Props = $props();

  // Merge settings with defaults
  const effectiveSettings = $derived({ ...DEFAULT_ECOSYSTEM_SETTINGS, ...settings });

  // All highlighted files
  const allHighlightedFiles = $derived([
    ...new Set([...filesChanged, ...filesCommitted, ...filesPR]),
  ]);
  const hasAnyChanges = $derived(allHighlightedFiles.length > 0);

  // Toggle for showing changes vs file types
  let showChangesMode = $state(false);

  // Auto-enable changes mode when there are changes
  $effect(() => {
    if (hasAnyChanges) {
      showChangesMode = true;
    }
  });

  // Effective hasChanges based on toggle
  const hasChanges = $derived(showChangesMode && hasAnyChanges);

  // Get change type for a file path
  function getChangeType(path: string): 'local' | 'committed' | 'pr' | null {
    if (filesChanged.includes(path)) return 'local';
    if (filesCommitted.includes(path)) return 'committed';
    if (filesPR.includes(path)) return 'pr';
    return null;
  }

  // Get fill color for a node
  function getFillColor(node: ProcessedNode): string {
    const changeType = getChangeType(node.path);
    if (changeType) {
      return CHANGE_COLORS[changeType];
    }
    return node.color;
  }

  // Set for O(1) highlight lookups
  const highlightedFilesSet = $derived(new Set(allHighlightedFiles));

  // Check if a file is highlighted (O(1) with Set)
  function isHighlighted(path: string): boolean {
    return highlightedFilesSet.has(path);
  }

  // Get the change type color for a file
  function getChangeTypeColor(path: string): string {
    if (filesChanged.includes(path)) return CHANGE_COLORS.local;
    if (filesCommitted.includes(path)) return CHANGE_COLORS.committed;
    if (filesPR.includes(path)) return CHANGE_COLORS.pr;
    return '#8b5cf6'; // Default purple
  }

  let canvas: HTMLCanvasElement | null = $state(null);
  let container: HTMLDivElement | null = $state(null);

  // ==================== PAN/ZOOM STATE ====================
  // Animated zoom transform for smooth visual zooming (matches repo-visualizer)
  const zoomTransform = tweened({ x: 0, y: 0, scale: 1 }, { duration: 300, easing: cubicOut });
  let isPanning = $state(false);
  let lastPanPoint = $state({ x: 0, y: 0 });

  // Zoom constraints
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 5;
  const ZOOM_SENSITIVITY = 0.001;

  // Calculate the max visible folder depth based on zoom level
  // Zoomed out = show fewer folder levels, zoomed in = show more
  function getVisibleDepthForZoom(scale: number, baseMaxDepth: number): number {
    // At scale 1 (default), show ~4 levels
    // At MIN_SCALE (0.5), show ~2 levels
    // At MAX_SCALE (5), show all levels up to baseMaxDepth
    const baseDepth = 2;
    const depthRange = baseMaxDepth - baseDepth;
    // Map scale from [MIN_SCALE, MAX_SCALE] to [0, 1]
    const normalizedScale = (scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE);
    // Apply easing curve (sqrt) so depth increases faster initially
    const depth = baseDepth + Math.sqrt(normalizedScale) * depthRange;
    return Math.floor(Math.min(depth, baseMaxDepth));
  }

  // ==================== SEARCH STATE ====================
  let searchQuery = $state('');
  let searchOpen = $state(false);
  let searchSelectedIndex = $state(0);
  let searchInputRef: HTMLInputElement | undefined = $state(undefined);

  // ==================== ZOOM/BREADCRUMB STATE ====================
  let zoomedPath = $state<string | null>(null);
  const breadcrumbs = $derived.by(() => {
    if (!zoomedPath) return [{ path: '', label: repoName }];
    const parts = zoomedPath.split('/');
    // Check if first part is same as repoName (avoid duplication)
    const startIndex = parts[0] === repoName ? 1 : 0;
    const crumbs: { path: string; label: string }[] = [{ path: '', label: repoName }];
    let currentPath = startIndex === 1 ? parts[0] : '';
    for (let i = startIndex; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      crumbs.push({ path: currentPath, label: part });
    }
    return crumbs;
  });
  let nodes: ProcessedNode[] = $state([]);
  let blobs: BlobShape[] = $state([]);
  let hoveredNode: ProcessedNode | null = $state(null);
  let mousePosition = $state({ x: 0, y: 0 });

  // Cached leaf nodes for draw - updated when nodes change
  const cachedLeafNodes = $derived(getLeafNodes(nodes));

  // Cached blob bounds for viewport culling - computed once when blobs change
  const cachedBlobBounds = $derived(
    blobs.map((blob) => {
      if (blob.hull.length === 0) return { centerX: 0, centerY: 0, radius: 0 };
      const centerX = blob.hull.reduce((sum, p) => sum + p[0], 0) / blob.hull.length;
      const centerY = blob.hull.reduce((sum, p) => sum + p[1], 0) / blob.hull.length;
      let maxDistSq = 0;
      for (const p of blob.hull) {
        const dx = p[0] - centerX;
        const dy = p[1] - centerY;
        maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy);
      }
      return { centerX, centerY, radius: Math.sqrt(maxDistSq) };
    }),
  );

  // Debounce timer for dimension changes
  let reflowTimeout: ReturnType<typeof setTimeout> | null = null;
  // Track if we have initial nodes (to distinguish data change vs dimension change)
  let processedNodes: ProcessedNode[] | null = null;

  // CSS colors cache
  let cssColors = $state({
    border: '#27272a',
    muted: '#27272a',
    mutedFg: '#a1a1aa',
    fg: '#fafafa',
    bg: '#09090b',
    accent: '#8b5cf6',
  });

  // ==================== SEARCH LOGIC ====================
  // Flatten all nodes for search (files and folders)
  const allSearchableNodes = $derived.by(() => {
    const results: ProcessedNode[] = [];
    function collect(nodeList: ProcessedNode[]) {
      for (const node of nodeList) {
        results.push(node);
        if (node.children) collect(node.children);
      }
    }
    collect(nodes);
    return results;
  });

  // Fuzzy search
  function fuzzyMatch(text: string, query: string): number {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (lowerText.includes(lowerQuery)) return 1;
    let score = 0;
    let queryIdx = 0;
    for (const char of lowerText) {
      if (queryIdx < lowerQuery.length && char === lowerQuery[queryIdx]) {
        score++;
        queryIdx++;
      }
    }
    return queryIdx === lowerQuery.length ? score / lowerQuery.length : 0;
  }

  const searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return [];
    return allSearchableNodes
      .map((node) => ({
        node,
        score: Math.max(fuzzyMatch(node.name, searchQuery), fuzzyMatch(node.path, searchQuery)),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r) => r.node);
  });

  // Search paths for highlighting on canvas
  const searchMatchPaths = $derived(new Set(searchResults.map((n) => n.path)));
  const searchFocusedPath = $derived(
    searchOpen && searchResults.length > 0 ? searchResults[searchSelectedIndex]?.path : null,
  );

  function openSearch() {
    searchOpen = true;
    tick().then(() => searchInputRef?.focus());
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = '';
    searchSelectedIndex = 0;
  }

  function handleSearchSelect(node: ProcessedNode) {
    if (node.isFolder) {
      zoomToFolder(node.path);
    } else {
      // For files: zoom to parent folder and highlight
      const parentPath = node.path.split('/').slice(0, -1).join('/');
      if (parentPath) {
        zoomToFolder(parentPath);
      }
    }
    closeSearch();
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchSelectedIndex = Math.min(searchSelectedIndex + 1, searchResults.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0);
    } else if (e.key === 'Enter' && searchResults[searchSelectedIndex]) {
      e.preventDefault();
      handleSearchSelect(searchResults[searchSelectedIndex]);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }

  // ==================== ZOOM FUNCTIONS ====================
  /**
   * Find a folder node in the processed nodes by path
   */
  function findFolderNode(path: string): ProcessedNode | null {
    function search(nodeList: ProcessedNode[]): ProcessedNode | null {
      for (const node of nodeList) {
        if (node.path === path && node.isFolder) return node;
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    }
    return search(nodes);
  }

  // Track the last focus path used for tree processing
  let lastFocusPath: string | null = null;

  /**
   * Reprocess tree with focus-aware pruning for a specific path
   * This loads more detail in the focused subtree
   */
  /**
   * Get the depth of a path in the tree
   */
  function getPathDepth(path: string | null): number {
    if (!path) return 0;
    return path.split('/').length;
  }

  /**
   * Zoom to a folder with smooth animation (matches repo-visualizer behavior)
   * Layout stays fixed - only the view transform changes
   */
  function zoomToFolder(folderPath: string | null) {
    if (folderPath === null || folderPath === '') {
      // Zoom out to root
      zoomedPath = null;
      zoomTransform.set({ x: 0, y: 0, scale: 1 });
      return;
    }

    // Find the folder node in layout
    const folder = findFolderNode(folderPath);
    if (!folder) return;

    zoomedPath = folderPath;

    // Find the blob for this folder to get accurate bounding box
    const folderBlob = blobs.find((b) => b.path === folderPath);

    let centerX = folder.x;
    let centerY = folder.y;
    let folderRadius: number;

    if (folderBlob && folderBlob.hull && folderBlob.hull.length >= 3) {
      // Use hull bounds for accurate centering
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [px, py] of folderBlob.hull) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      centerX = (minX + maxX) / 2;
      centerY = (minY + maxY) / 2;
      folderRadius = Math.max(maxX - minX, maxY - minY) / 2;
    } else {
      // Fallback to effectiveRadius or estimate
      folderRadius = folder.effectiveRadius || folder.r * 3;
    }

    // Calculate transform to center and fit the folder with generous padding
    const padding = 60; // More padding for comfortable viewing
    const targetSize = Math.min(width, height) - padding * 2;
    // Limit max zoom to prevent going too close
    const idealScale = targetSize / (folderRadius * 2);
    const scale = Math.min(idealScale, 8); // Cap at 8x zoom
    const tx = width / 2 - centerX * scale;
    const ty = height / 2 - centerY * scale;

    zoomTransform.set({ x: tx, y: ty, scale });
  }

  function handleBreadcrumbClick(path: string) {
    zoomToFolder(path || null);
  }

  // ==================== PAN/ZOOM HANDLERS ====================
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const currentTransform = $zoomTransform;
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentTransform.scale * (1 + delta)));

    // Zoom towards cursor
    const rect = canvas!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleFactor = newScale / currentTransform.scale;
    // Set immediately (no animation for wheel zoom)
    zoomTransform.set(
      {
        x: mouseX - (mouseX - currentTransform.x) * scaleFactor,
        y: mouseY - (mouseY - currentTransform.y) * scaleFactor,
        scale: newScale,
      },
      { duration: 0 },
    );
  }

  function handlePanStart(e: MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle button or shift+left click
      isPanning = true;
      lastPanPoint = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handlePanMove(e: MouseEvent) {
    if (!isPanning) return;
    const currentTransform = $zoomTransform;
    const dx = e.clientX - lastPanPoint.x;
    const dy = e.clientY - lastPanPoint.y;
    // Set immediately (no animation for panning)
    zoomTransform.set(
      { ...currentTransform, x: currentTransform.x + dx, y: currentTransform.y + dy },
      { duration: 0 },
    );
    lastPanPoint = { x: e.clientX, y: e.clientY };
  }

  function handlePanEnd() {
    isPanning = false;
  }

  // Keyboard shortcut for search and navigation
  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const isInInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // "/" opens search if not already in an input (like repo-visualizer)
    if (e.key === '/' && !searchOpen && !isInInput) {
      e.preventDefault();
      openSearch();
      return;
    }

    // Cmd/Ctrl+F for search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }

    // Escape closes search or zooms out
    if (e.key === 'Escape') {
      if (searchOpen) {
        closeSearch();
      } else if (zoomedPath) {
        e.preventDefault();
        const parentPath = zoomedPath.split('/').slice(0, -1).join('/');
        zoomToFolder(parentPath || null);
      }
      return;
    }

    // "n" / "N" cycles through siblings (like repo-visualizer)
    // Works even when not zoomed - navigates top-level folders
    if ((e.key === 'n' || e.key === 'N') && !isInInput && !searchOpen) {
      e.preventDefault();
      navigateToSibling(e.shiftKey ? 'prev' : 'next');
      return;
    }

    // Arrow key navigation between sibling folders (and not in input)
    if (!isInInput && !searchOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      navigateToSibling(e.key === 'ArrowLeft' ? 'prev' : 'next');
    }
  }

  /**
   * Navigate to next/previous sibling folder at current zoom level
   * If not zoomed, cycles through top-level folders (matching repo-visualizer)
   */
  function navigateToSibling(direction: 'prev' | 'next') {
    const siblings = getSiblingsAtCurrentLevel();
    if (siblings.length === 0) return;

    const currentPath = zoomedPath || '';
    const currentIndex = siblings.indexOf(currentPath);

    let nextIndex: number;
    if (currentIndex === -1) {
      // Not zoomed or not found - go to first or last
      nextIndex = direction === 'next' ? 0 : siblings.length - 1;
    } else if (direction === 'next') {
      nextIndex = (currentIndex + 1) % siblings.length;
    } else {
      nextIndex = (currentIndex - 1 + siblings.length) % siblings.length;
    }

    zoomToFolder(siblings[nextIndex]);
  }

  /**
   * Get sibling folder paths at the current zoom level
   * If not zoomed, returns first-level folders (depth === 1)
   */
  function getSiblingsAtCurrentLevel(): string[] {
    // If not zoomed, return first-level folders (children of root)
    if (!zoomedPath) {
      return nodes
        .filter((n: ProcessedNode) => n.isFolder && n.depth === 1)
        .map((n: ProcessedNode) => n.path)
        .sort();
    }
    const parentPath = zoomedPath.split('/').slice(0, -1).join('/');

    // Find all folders at this level
    return nodes
      .filter((n: ProcessedNode) => {
        if (!n.isFolder) return false;
        const nodeParent = n.path.split('/').slice(0, -1).join('/');
        return nodeParent === parentPath;
      })
      .map((n: ProcessedNode) => n.path)
      .sort();
  }

  function resolveCSSColors() {
    if (!container) return;
    const style = getComputedStyle(container);
    cssColors = {
      border: style.getPropertyValue('--color-border').trim() || '#27272a',
      muted: style.getPropertyValue('--color-muted').trim() || '#27272a',
      mutedFg: style.getPropertyValue('--color-muted-foreground').trim() || '#a1a1aa',
      fg: style.getPropertyValue('--color-foreground').trim() || '#fafafa',
      bg: style.getPropertyValue('--color-sidebar').trim() || '#09090b',
      accent: style.getPropertyValue('--color-primary').trim() || '#8b5cf6',
    };
  }

  /**
   * Reflow layout - repositions nodes for new dimensions without changing sizes
   */
  function reflowLayout() {
    const s = effectiveSettings;
    const focusDepth = getPathDepth(lastFocusPath);

    // Reprocess tree - layout is fixed, just recalculate for new dimensions
    processedNodes = processTree(data, width, height, {
      minFileRadius: s.minFileRadius,
      maxFileRadius: s.maxFileRadius,
      maxNodes: s.maxNodes,
      maxDepth: s.maxDepth,
      focusPath: lastFocusPath,
    });

    // Run force simulation to reposition
    runForceSimulation(processedNodes, {
      width,
      height,
      collisionPadding: s.collisionPadding,
      folderPadding: s.folderPadding,
      blobPadding: s.blobPadding,
    }).then(({ nodes: resultNodes, scaleRatio }) => {
      nodes = resultNodes;
      const currentScale = $zoomTransform.scale;
      // Draw blobs for all folders (including top-level) for visual hierarchy
      // Pass scaleRatio for elliptical hull constraints in landscape viewports
      blobs = computeBlobShapes(resultNodes, {
        basePadding: s.blobPadding,
        depthPaddingFactor: s.depthPaddingFactor,
        minDepthPaddingFactor: s.minDepthPaddingFactor,
        wobbleAmplitude: s.wobbleAmplitude,
        hullSubdivisions: s.hullSubdivisions,
        hullSmoothing: s.hullSmoothing,
        minDepth: 1,
        onlyLeafFolders: false,
        scaleRatio,
        zoomScale: currentScale,
        focusDepth,
      });
      // Reset zoom to identity since force simulation already fits to viewport
      zoomTransform.set({ x: 0, y: 0, scale: 1 }, { duration: 0 });
      draw();
    });
  }

  /**
   * Debounced reflow - delays layout recalculation while dimensions are changing
   */
  function debouncedReflow() {
    if (reflowTimeout) {
      clearTimeout(reflowTimeout);
    }
    reflowTimeout = setTimeout(() => {
      reflowLayout();
      reflowTimeout = null;
    }, 150); // 150ms debounce
  }

  // Track last data to detect data changes vs dimension changes
  let lastDataRef: FileNode | null = null;
  // Use individual setting values for comparison (avoid JSON.stringify)
  let lastSettingsKey = '';

  // Create a stable settings key for comparison
  function getSettingsKey(s: EcosystemSettings): string {
    return `${s.minFileRadius}-${s.maxFileRadius}-${s.maxNodes}-${s.maxDepth}-${s.collisionPadding}-${s.folderPadding}-${s.blobPadding}-${s.depthPaddingFactor}-${s.minDepthPaddingFactor}-${s.wobbleAmplitude}-${s.hullSubdivisions}-${s.hullSmoothing}`;
  }

  // Process data when it changes (full reprocess with new sizes)
  $effect(() => {
    if (!data) return;

    // Only reprocess if data or settings actually changed
    const currentSettingsKey = getSettingsKey(effectiveSettings);
    if (data === lastDataRef && currentSettingsKey === lastSettingsKey) return;
    lastDataRef = data;
    lastSettingsKey = currentSettingsKey;

    const s = effectiveSettings;

    // Reset zoom when data changes
    zoomedPath = null;
    zoomTransform.set({ x: 0, y: 0, scale: 1 }, { duration: 0 });

    // Build set of highlighted paths for pruning preservation
    const highlightedPathsSet = new Set([...filesChanged, ...filesCommitted, ...filesPR]);

    // Process tree - this calculates node sizes (uses current dimensions)
    processedNodes = processTree(data, width, height, {
      minFileRadius: s.minFileRadius,
      maxFileRadius: s.maxFileRadius,
      maxNodes: s.maxNodes,
      maxDepth: s.maxDepth,
      focusPath: zoomedPath,
      highlightedPaths: highlightedPathsSet,
    });

    // Run force simulation once (static layout)
    runForceSimulation(processedNodes, {
      width,
      height,
      collisionPadding: s.collisionPadding,
      folderPadding: s.folderPadding,
      blobPadding: s.blobPadding,
    }).then(({ nodes: resultNodes, scaleRatio }) => {
      nodes = resultNodes;
      // Draw blobs for all folders (including top-level) for visual hierarchy
      // Pass scaleRatio for elliptical hull constraints in landscape viewports
      blobs = computeBlobShapes(resultNodes, {
        basePadding: s.blobPadding,
        depthPaddingFactor: s.depthPaddingFactor,
        minDepthPaddingFactor: s.minDepthPaddingFactor,
        wobbleAmplitude: s.wobbleAmplitude,
        hullSubdivisions: s.hullSubdivisions,
        hullSmoothing: s.hullSmoothing,
        minDepth: 1,
        onlyLeafFolders: false,
        scaleRatio,
        zoomScale: 1, // Initial load at scale 1
        focusDepth: 0, // No focus initially
      });

      // Force simulation already fits to viewport, so reset zoom to identity
      zoomTransform.set({ x: 0, y: 0, scale: 1 }, { duration: 0 });
      lastFocusPath = null;

      draw();
    });
  });

  // Reflow when dimensions change (debounced, keeps existing sizes)
  $effect(() => {
    // Create reactive dependencies on width/height
    void width;
    void height;

    // Only reflow if we already have nodes (dimension change, not initial load)
    if (processedNodes && processedNodes.length > 0) {
      debouncedReflow();
    }

    // Cleanup timeout on unmount or re-run
    return () => {
      if (reflowTimeout) {
        clearTimeout(reflowTimeout);
        reflowTimeout = null;
      }
    };
  });

  // Setup canvas
  // Canvas sizing effect - only runs when canvas/dimensions change
  $effect(() => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    // Schedule a redraw after canvas resize
    scheduleDraw();
  });

  // Resolve colors when container is ready
  $effect(() => {
    if (container) resolveCSSColors();
  });

  function draw() {
    // Use untrack to prevent draw() from creating reactive dependencies
    // All state access is intentional and controlled via the effect
    untrack(() => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, width * dpr, height * dpr);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Apply pan/zoom transform
      const currentTransform = $zoomTransform;
      const scale = currentTransform.scale;
      ctx.translate(currentTransform.x, currentTransform.y);
      ctx.scale(scale, scale);

      // === VIEWPORT CULLING ===
      // Calculate visible area in canvas coordinates for culling off-screen elements
      const viewportLeft = -currentTransform.x / scale;
      const viewportTop = -currentTransform.y / scale;
      const viewportRight = (width - currentTransform.x) / scale;
      const viewportBottom = (height - currentTransform.y) / scale;
      const viewportPadding = 50 / scale; // Extra padding for blobs/labels

      // Check if a circle/point is visible in the viewport
      function isVisible(x: number, y: number, r: number): boolean {
        return (
          x + r >= viewportLeft - viewportPadding &&
          x - r <= viewportRight + viewportPadding &&
          y + r >= viewportTop - viewportPadding &&
          y - r <= viewportBottom + viewportPadding
        );
      }

      // Minimum screen radius to render (skip sub-pixel files)
      const MIN_SCREEN_RADIUS = 0.5;

      // Layer 1: Draw blobs (folder backgrounds) - organic hull shapes
      // Sort by depth ascending so parent folders (lower depth) are drawn first
      // and child folders (higher depth) are drawn on top
      const s = effectiveSettings;
      const hoveredPath = hoveredNode?.path;
      const hoveredIsFolder = hoveredNode?.isFolder;
      const blobBounds = cachedBlobBounds;

      // Calculate visible depth based on current zoom level
      const visibleDepth = getVisibleDepthForZoom(scale, s.maxDepth);

      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];

        // Skip blobs deeper than the visible depth for current zoom
        if (blob.depth > visibleDepth) continue;

        // Quick bounds check using cached blob bounds
        const bounds = blobBounds[i];
        if (bounds && !isVisible(bounds.centerX, bounds.centerY, bounds.radius)) continue;

        // Higher depth = more opacity for nested folders to stand out against parents
        const baseOpacity = s.hullFillOpacity + blob.depth * 0.04;
        const opacity = Math.min(baseOpacity, 0.3);

        const isHoveredFolder = hoveredPath === blob.path && !!hoveredIsFolder;

        // Draw blob shape - 1px border, configurable opacity
        // Pass zoom scale, base padding, depth, and contraction for hull rendering
        drawBlobToCanvas(
          ctx,
          blob.hull,
          cssColors.muted,
          isHoveredFolder ? 'rgba(139, 92, 246, 0.8)' : cssColors.border,
          isHoveredFolder ? 0.3 : opacity,
          (isHoveredFolder ? 2 : 1) / scale,
          scale,
          s.blobPadding,
          blob.depth,
          s.hullContraction,
        );
      }

      // Layer 2: Folder labels (drawn after blobs, before files)
      // Use blob hulls for accurate bounding box positioning
      // Build set of hovered ancestors for label visibility
      const hoveredAncestorPaths = new Set<string>();
      if (hoveredNode) {
        let current = hoveredNode.parent;
        while (current) {
          hoveredAncestorPaths.add(current.path);
          current = current.parent;
        }
      }

      const isHovering = !!hoveredNode;

      // Prepare label candidates with computed metrics for collision detection
      type LabelCandidate = {
        blob: BlobShape;
        centerX: number;
        minY: number;
        screenWidth: number;
        isHoveredFolder: boolean;
        isAncestorOfHovered: boolean;
        isSearchMatch: boolean;
        priority: number; // Higher = more important to show
      };
      const labelCandidates: LabelCandidate[] = [];

      for (const blob of blobs) {
        if (!blob.hull || blob.hull.length < 3) continue;

        // Skip blobs deeper than the visible depth for current zoom
        if (blob.depth > visibleDepth) continue;

        // Compute bounding box from hull
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const [px, py] of blob.hull) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }

        const blobWidth = maxX - minX;
        const blobHeight = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const effectiveR = Math.max(blobWidth, blobHeight) / 2;

        // Account for hull contraction when positioning labels
        // Contraction moves minY down toward center
        const contractionAmount = s.hullContraction + blob.depth * 1.5;
        const contractedMinY = minY + contractionAmount;

        // Viewport culling
        if (!isVisible(centerX, centerY, effectiveR)) continue;

        const screenWidth = blobWidth * scale;
        // More aggressive threshold - only show labels for really prominent folders
        const isLargeEnough = screenWidth >= 150;
        const isHoveredFolder = hoveredPath === blob.path && !!hoveredIsFolder;
        const isAncestorOfHovered = hoveredAncestorPaths.has(blob.path) ?? false;
        const isSearchMatch = searchMatchPaths.has(blob.path) ?? false;

        // Show labels based on hover state:
        // - When hovering: only show hovered folder + ancestors of hovered item
        // - When not hovering: show labels for large folders
        const shouldShowLabel = isHovering
          ? isHoveredFolder || isAncestorOfHovered
          : isSearchMatch || isLargeEnough;

        if (!shouldShowLabel) continue;

        // Priority: hovered > ancestor > search > size-based (larger = higher priority)
        // Very heavily penalize deeper folders to reduce clutter
        let priority = screenWidth; // Base priority is screen size
        if (isHoveredFolder) priority += 100000;
        else if (isAncestorOfHovered) priority += 50000;
        else if (isSearchMatch) priority += 10000;
        // Exponential depth penalty - depth 2 = -2000, depth 3 = -4500, depth 4 = -8000
        priority -= blob.depth * blob.depth * 500;

        labelCandidates.push({
          blob,
          centerX,
          minY: contractedMinY,
          screenWidth,
          isHoveredFolder,
          isAncestorOfHovered,
          isSearchMatch,
          priority,
        });
      }

      // Sort by priority (highest first) so important labels get placed first
      labelCandidates.sort((a, b) => b.priority - a.priority);

      // Limit total labels to prevent overcrowding (except for hover/search forced labels)
      const MAX_LABELS = 15;

      // Track placed label bounding boxes for collision detection (in screen coordinates)
      const placedLabels: { x1: number; y1: number; x2: number; y2: number }[] = [];
      let labelCount = 0;

      // Check if a label rect overlaps with any placed labels
      function labelsOverlap(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        padding: number = 24, // Generous padding to prevent crowding
      ): boolean {
        for (const placed of placedLabels) {
          // Check for overlap with padding
          if (
            x1 - padding < placed.x2 &&
            x2 + padding > placed.x1 &&
            y1 - padding < placed.y2 &&
            y2 + padding > placed.y1
          ) {
            return true;
          }
        }
        return false;
      }

      for (const candidate of labelCandidates) {
        // Stop if we've placed enough labels (unless forced)
        const forceShowCandidate =
          candidate.isHoveredFolder || candidate.isAncestorOfHovered || candidate.isSearchMatch;
        if (labelCount >= MAX_LABELS && !forceShowCandidate) break;
        const { blob, centerX, minY, screenWidth, isHoveredFolder, isAncestorOfHovered } =
          candidate;

        // Get folder name from path
        const folderName = blob.path.split('/').pop() || blob.path;
        if (!folderName) continue;

        // Truncate based on screen width
        const maxChars =
          screenWidth < 120 ? Math.floor(screenWidth / 8) + 2 : Math.floor(screenWidth / 6);
        const label =
          folderName.length > maxChars ? folderName.slice(0, maxChars) + '…' : folderName;

        // Font size relative to screen width (clamped between 10-14px on screen)
        const baseFontSize = Math.min(Math.max(screenWidth * 0.08, 10), 14);
        const fontSize = baseFontSize / scale;
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;

        // Measure text width for collision detection
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;

        // Position label ABOVE the blob bounding box (outside, not inside)
        const labelX = centerX;
        const labelY = minY - fontSize * 0.3;

        // Convert to screen coordinates for collision detection
        const screenLabelX = labelX * scale + currentTransform.x;
        const screenLabelY = labelY * scale + currentTransform.y;
        const screenTextWidth = textWidth * scale;
        const screenTextHeight = textHeight * scale;

        // Label bounding box in screen coords (centered horizontally, above baseline)
        const labelRect = {
          x1: screenLabelX - screenTextWidth / 2,
          y1: screenLabelY - screenTextHeight,
          x2: screenLabelX + screenTextWidth / 2,
          y2: screenLabelY,
        };

        // Always show hovered/ancestor labels, skip collision check for those
        const forceShow = isHoveredFolder || isAncestorOfHovered;

        // Skip if overlaps with existing labels (unless forced)
        if (!forceShow && labelsOverlap(labelRect.x1, labelRect.y1, labelRect.x2, labelRect.y2)) {
          continue;
        }

        // Record this label's position
        placedLabels.push(labelRect);
        labelCount++;

        // Draw label
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Strong background stroke for readability
        ctx.strokeStyle = cssColors.bg;
        ctx.lineWidth = 4 / scale;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeText(label, labelX, labelY);

        // Foreground text
        ctx.fillStyle = cssColors.mutedFg;
        ctx.globalAlpha = isHoveredFolder || isAncestorOfHovered ? 1 : 0.6;
        ctx.fillText(label, labelX, labelY);
        ctx.globalAlpha = 1;
      }

      // Layer 3: Files (leaf nodes) - use cached leaf nodes
      const files = cachedLeafNodes;

      // Minimum screen pixel size for files - only boost at high zoom levels
      // Below scale 3: use natural size (no minimum boost to avoid overlap)
      // At scale 3-5: gentle boost to 6-10px
      // At scale 5+: boost to 10-16px for visibility
      const MIN_FILE_SCREEN_PX = scale < 3 ? 0 : Math.min(4 + (scale - 3) * 2, 16);

      for (const node of files) {
        const r = node.r;

        // === SCREEN SIZE CULLING ===
        // Skip files that are smaller than MIN_SCREEN_RADIUS pixels on screen
        const screenRadius = r * scale;
        if (screenRadius < MIN_SCREEN_RADIUS) continue;

        // === VIEWPORT CULLING ===
        if (!isVisible(node.x, node.y, r)) continue;

        const highlighted = isHighlighted(node.path);
        const fillColor = getFillColor(node);
        const isHovered = hoveredNode?.path === node.path;

        // Calculate final radius - only apply minimum size at high zoom
        let finalRadius = r;
        if (MIN_FILE_SCREEN_PX > 0) {
          const minWorldRadius = MIN_FILE_SCREEN_PX / scale;
          finalRadius = Math.max(finalRadius, minWorldRadius);
        }
        if (highlighted && hasChanges) finalRadius = Math.max(finalRadius, 4 / scale);
        if (isHovered) finalRadius = Math.max(finalRadius, 4 / scale);

        // Draw solid circle with fill
        ctx.beginPath();
        ctx.arc(node.x, node.y, finalRadius, 0, Math.PI * 2);
        // When there are changes, mute non-highlighted files
        ctx.fillStyle = hasChanges && !highlighted ? cssColors.mutedFg : fillColor;
        ctx.globalAlpha = hasChanges && !highlighted ? 0.3 : 1;
        ctx.fill();

        // Add subtle stroke
        ctx.strokeStyle = hasChanges && !highlighted ? cssColors.mutedFg : fillColor;
        ctx.lineWidth = 0.5 / scale;
        ctx.globalAlpha = hasChanges && !highlighted ? 0.2 : 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw highlight rings for hovered/changed/searched files (styled like repo-visualizer)
      const searchPaths = searchMatchPaths;
      const focusedPath = searchFocusedPath;

      for (const node of files) {
        const nodeIsHovered = hoveredPath === node.path;
        const highlighted = highlightedFilesSet.has(node.path);
        const isSearchMatch = searchPaths.has(node.path);
        const isSearchFocused = node.path === focusedPath;

        if (!nodeIsHovered && !highlighted && !isSearchMatch) continue;

        // Viewport culling for highlight rings
        if (!isVisible(node.x, node.y, node.r)) continue;

        const r = node.r;

        // Different ring colors based on context
        let ringColor = 'rgba(139, 92, 246, 0.6)'; // Default purple for hover/change
        let ringWidth = 2 / scale; // Maintain consistent stroke width

        if (isSearchFocused) {
          ringColor = 'rgba(59, 130, 246, 1)'; // Bright blue for search focus
          ringWidth = 3 / scale;
        } else if (isSearchMatch) {
          ringColor = 'rgba(59, 130, 246, 0.5)'; // Lighter blue for other search matches
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = ringWidth;
        ctx.stroke();
      }

      // Hover label is handled by the HTML hover card, not canvas

      ctx.restore();
    }); // end untrack
  }

  // Single consolidated draw effect - uses RAF to batch all redraws
  let drawScheduled = false;
  let lastDrawnNodes: ProcessedNode[] | null = null;
  let lastDrawnBlobs: BlobShape[] | null = null;
  let lastDrawnHover: ProcessedNode | null = null;
  let lastDrawnTransform = { x: 0, y: 0, scale: 1 };

  function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      draw();
    });
  }

  // Single effect to track all draw dependencies
  $effect(() => {
    // Track dependencies - reading these creates reactive subscriptions
    const currentNodes = nodes;
    const currentBlobs = blobs;
    const currentHover = hoveredNode;
    const currentTransform = $zoomTransform;
    void cssColors; // Track color changes too

    // Only schedule redraw if something actually changed
    const nodesChanged = currentNodes !== lastDrawnNodes;
    const blobsChanged = currentBlobs !== lastDrawnBlobs;
    const hoverChanged = currentHover !== lastDrawnHover;
    const transformChanged =
      currentTransform.x !== lastDrawnTransform.x ||
      currentTransform.y !== lastDrawnTransform.y ||
      currentTransform.scale !== lastDrawnTransform.scale;

    if (nodesChanged || blobsChanged || hoverChanged || transformChanged) {
      lastDrawnNodes = currentNodes;
      lastDrawnBlobs = currentBlobs;
      lastDrawnHover = currentHover;
      lastDrawnTransform = { ...currentTransform };
      scheduleDraw();
    }
  });

  /**
   * Convert screen coordinates to canvas coordinates (accounting for pan/zoom)
   */
  function screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const t = $zoomTransform;
    return {
      x: (screenX - t.x) / t.scale,
      y: (screenY - t.y) / t.scale,
    };
  }

  // Throttled hover detection for performance
  let hoverThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHoverCoords: { x: number; y: number; scale: number } | null = null;

  function processHover() {
    if (!pendingHoverCoords) return;
    const { x, y, scale } = pendingHoverCoords;
    pendingHoverCoords = null;
    hoveredNode = findNodeAtPosition(nodes, x, y, scale, blobs);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!canvas) return;

    // Handle panning
    if (isPanning) {
      handlePanMove(event);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Track mouse position for hover card positioning
    mousePosition = { x: screenX, y: screenY };

    // Convert to canvas coordinates
    const { x, y } = screenToCanvas(screenX, screenY);
    const scale = $zoomTransform.scale;

    // Throttle hover detection to 60fps max (16ms)
    pendingHoverCoords = { x, y, scale };
    if (!hoverThrottleTimer) {
      processHover(); // Process immediately on first move
      hoverThrottleTimer = setTimeout(() => {
        hoverThrottleTimer = null;
        processHover(); // Process any pending coords
      }, 16);
    }
  }

  function handleMouseLeave() {
    hoveredNode = null;
    handlePanEnd();
  }

  function handleClick() {
    // Don't trigger click after panning
    if (isPanning) return;

    if (hoveredNode) {
      if (hoveredNode.isFolder) {
        // Click on folder to zoom into it
        zoomToFolder(hoveredNode.path);
      } else if (onFileClick) {
        onFileClick(hoveredNode.path);
      }
    }
  }

  function handleMouseDown(event: MouseEvent) {
    handlePanStart(event);
  }

  function handleMouseUp() {
    handlePanEnd();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={container}
  class="relative flex flex-col max-w-full overflow-hidden"
  style="width: {width}px;"
>
  <!-- Breadcrumb navigation (above canvas, like repo-visualizer) -->
  {#if zoomedPath}
    <div class="flex items-center gap-1 px-2 py-1.5 text-xs text-subtle overflow-x-auto">
      {#each breadcrumbs as crumb, i (`crumb-${i}-${crumb.path}`)}
        {#if i > 0}
          <span class="opacity-40">/</span>
        {/if}
        <button
          class="hover:text-foreground transition-colors truncate max-w-[120px] cursor-pointer {i ===
          breadcrumbs.length - 1
            ? 'text-foreground font-medium'
            : ''}"
          onclick={() => handleBreadcrumbClick(crumb.path)}
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
      class:cursor-grab={!isPanning}
      class:cursor-grabbing={isPanning}
      style="width: {width}px; height: {height}px;"
      onmousemove={handleMouseMove}
      onmouseleave={handleMouseLeave}
      onclick={handleClick}
      onmousedown={handleMouseDown}
      onmouseup={handleMouseUp}
      onwheel={handleWheel}
      aria-label={m.ecosystem_canvas_visualization_ariaLabel()}
    ></canvas>

    <!-- Hover card (follows mouse, like repo-visualizer) -->
    {#if hoveredNode}
      {@const cardX = Math.min(mousePosition.x + 12, width - 220)}
      {@const cardY = Math.min(mousePosition.y + 12, height - 100)}
      <div
        class="absolute pointer-events-none bg-popover/95 backdrop-blur-sm border border-border rounded-md shadow-lg px-3 py-2 text-xs max-w-[220px] z-10"
        style="left: {cardX}px; top: {cardY}px;"
      >
        <div class="flex items-start gap-1.5">
          <i class="fa fa-{hoveredNode.isFolder ? 'folder-o' : 'file-o'} text-ghost mt-0.5 shrink-0"
          ></i>
          <div class="min-w-0">
            <div class="font-medium text-foreground break-words">{hoveredNode.name}</div>
            {#if hoveredNode.path}
              <div class="text-subtle text-ui break-words line-clamp-3">
                {hoveredNode.path}
              </div>
            {/if}
          </div>
        </div>
        {#if hoveredNode.size > 0 && !hoveredNode.isFolder}
          <div class="mt-1 pt-1 border-t border-border/50 text-subtle">
            {m.ecosystem_canvas_fileSize_label({ size: (hoveredNode.size / 1024).toFixed(1) })}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Search overlay - top left corner (like repo-visualizer) -->
    <div class="absolute top-2 left-2 z-20">
      {#if searchOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="bg-popover/95 backdrop-blur-sm border border-border rounded-md shadow-lg w-72"
          onkeydown={handleSearchKeydown}
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
            <svg
              class="w-3 h-3 text-subtle shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              bind:this={searchInputRef}
              bind:value={searchQuery}
              type="text"
              placeholder={m.ecosystem_canvas_search_placeholder()}
              class="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground focus:outline-none! focus:ring-0!"
              onblur={() => !searchQuery.trim() && closeSearch()}
            />
            <button
              class="text-muted-foreground hover:text-foreground text-xs"
              onclick={closeSearch}
            >
              {m.ecosystem_canvas_esc_label()}
            </button>
          </div>
          {#if searchResults.length > 0}
            <div class="max-h-64 overflow-y-auto py-1">
              {#each searchResults as result, idx (result.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors group cursor-pointer {idx ===
                  searchSelectedIndex
                    ? 'bg-muted/20'
                    : 'hover:bg-muted-foreground/10'}"
                  onclick={() => handleSearchSelect(result)}
                  onmouseenter={() => (searchSelectedIndex = idx)}
                >
                  <span
                    class="w-3 h-3 shrink-0 text-{result.isFolder
                      ? 'amber-500'
                      : 'muted-foreground'}"
                  >
                    {result.isFolder ? '📁' : '📄'}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate font-medium">{result.name}</span>
                      {#if isHighlighted(result.path)}
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          style="background-color: {getChangeTypeColor(result.path)}"
                        ></span>
                      {/if}
                    </div>
                    <div class="text-ui text-subtle truncate">
                      {result.path}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else if searchQuery}
            <div class="px-3 py-4 text-center text-sm text-subtle">
              {m.ecosystem_canvas_noResults_label({ query: searchQuery })}
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs bg-background/70 text-muted-foreground hover:bg-background/90 hover:text-foreground transition-all cursor-pointer"
          onclick={openSearch}
        >
          <svg
            class="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <span>{m.ecosystem_canvas_search_label()}</span>
          <kbd class="text-ui px-1 py-0.5 rounded bg-muted ml-1">/</kbd>
        </button>
      {/if}
    </div>

    <!-- Legend overlay - bottom right corner (like repo-visualizer) -->
    <div class="absolute bottom-2 right-2 flex flex-col items-end gap-1.5">
      <!-- Changes toggle (when there are any changes) -->
      {#if hasAnyChanges}
        <button
          class="flex items-center gap-3 px-2.5 py-1.5 rounded text-xs cursor-pointer border {showChangesMode
            ? 'bg-background/95 text-foreground shadow-sm border-border'
            : 'bg-background/70 text-muted-foreground hover:bg-background/90 border-border/10'}"
          onclick={() => (showChangesMode = !showChangesMode)}
          title={showChangesMode ? m.ecosystem_canvas_showFileTypes_tooltip() : m.ecosystem_canvas_highlightChanges_tooltip()}
        >
          <span class="opacity-60"
            >{showChangesMode ? m.ecosystem_canvas_highlightingChanged_label() : m.ecosystem_canvas_highlightChanged_label()}</span
          >
          {#if filesChanged.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.local}"
              ></span>
              <span>{m.ecosystem_canvas_localCount_label({ count: filesChanged.length })}</span>
            </span>
          {/if}
          {#if filesCommitted.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.committed}"
              ></span>
              <span>{m.ecosystem_canvas_unpushedCount_label({ count: filesCommitted.length })}</span>
            </span>
          {/if}
          {#if filesPR.length > 0}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" style="background-color: {CHANGE_COLORS.pr}"
              ></span>
              <span>{m.ecosystem_canvas_inPrCount_label({ count: filesPR.length })}</span>
            </span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>
