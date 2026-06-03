<script lang="ts">
/* eslint-disable max-lines */
  import {
  onMount,
  tick,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';
  import type {
    FileExplorerDisplayNode as FileNode,
    FlattenedFileNode,
  } from '$store/renderer/slices/file-explorer/file-explorer-types';
  import { ListItem } from '$lib/components/ui/list';
  import {
  faChevronDown,
  faPlus,
  faArrowUpRightFromSquare,
  faPencil,
  faFolderOpen,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import { getFileTypeIconSvg } from '$lib/utils/file-type-icons';
  import LineChangesBadge from '../shared/LineChangesBadge.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Fa from 'svelte-fa';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { invoke } from '$lib/electron-bridge';
  import { pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import { deleteWithUndo } from '$lib/utils/reversible-actions';
  import {
  track,
  getFileExtension,
} from '$lib/services/analytics';
  import {
  getPanelLayoutManager,
  hasPanelLayoutManager,
} from '$features/layout/panel-layout-adapter';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';

  // Sentinel path for inline creation node
  const CREATING_SENTINEL_PATH = '__creating_new_file__';

  interface Props {
    flattenedNodes: FlattenedFileNode[];
    selectedFile?: string;
    workspaceId?: string;
    onFileSelect?: (path: string) => void;
    onToggleDirectory?: (node: FileNode, flatNode?: FlattenedFileNode) => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onRenameFile?: (oldPath: string, newPath: string) => void | Promise<void>;
    onSelectAgent?: (agentId: string) => void;
    getGitStatusColor?: (status?: string) => string;
    isFileModified?: (path: string) => boolean;
    itemHeight?: number;
    overscan?: number;
    /** Callback when external files are dropped onto the tree */
    onExternalFilesDrop?: (files: File[], targetPath: string | null) => void;
  }

  let {
    flattenedNodes = [],
    selectedFile = '',
    workspaceId = '',
    onFileSelect,
    onToggleDirectory,
    onCreateFile,
    onRenameFile,
    onSelectAgent,
    getGitStatusColor = () => '',
    isFileModified = () => false,
    itemHeight = 25, // Match ListItem sm size
    overscan = 5,
    onExternalFilesDrop,
  }: Props = $props();

  const workspaceIdStore = writable(workspaceId);
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // ============================================================
  // External file drop zone detection
  // ============================================================

  // MIME type used for internal tab drags - ignore these
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  /** Whether external files are being dragged over the tree */
  let isExternalFileDragOver = $state(false);

  /** Path of the folder being targeted for drop (null = root level) */
  let dropTargetPath: string | null = $state(null);

  // Track drag enter/leave depth to handle nested elements correctly
  let dragEnterDepth = 0;

  // Auto-expand timer for hovering over collapsed folders during drag
  let hoverExpandTimeout: ReturnType<typeof setTimeout> | null = null;
  let hoverExpandTargetPath: string | null = null;

  /**
   * Checks if a drag event contains external files (not internal app drags)
   * Returns true for files from Finder/Explorer or VSCode file explorer
   */
  function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) return false;

    const types = dataTransfer.types;

    // Ignore internal tab drags
    if (types.includes(TAB_DRAG_MIME)) return false;

    // Accept files from Finder/Explorer or VSCode file paths
    return types.includes('Files') || types.includes('codefiles');
  }

  function handleFileDragEnter(e: DragEvent) {
    if (!isExternalFileDrag(e.dataTransfer)) return;

    dragEnterDepth++;
    if (dragEnterDepth === 1) {
      isExternalFileDragOver = true;
    }
  }

  /** Clears the auto-expand hover timer */
  function clearHoverExpandTimer() {
    if (hoverExpandTimeout !== null) {
      clearTimeout(hoverExpandTimeout);
      hoverExpandTimeout = null;
    }
    hoverExpandTargetPath = null;
  }

  function requestToggleDirectory(flatNode: FlattenedFileNode) {
    onToggleDirectory?.(flatNode.node, flatNode);
  }

  function handleFileDragLeave(e: DragEvent) {
    if (!isExternalFileDrag(e.dataTransfer)) return;

    dragEnterDepth--;
    if (dragEnterDepth === 0) {
      isExternalFileDragOver = false;
      dropTargetPath = null;
      clearHoverExpandTimer();
    }
  }

  function handleFileDragOver(e: DragEvent) {
    if (!isExternalFileDrag(e.dataTransfer)) return;

    // Prevent default to allow drop
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }

    // Calculate drop target based on mouse position
    updateDropTarget(e);
  }

  /**
   * Determines which folder should receive the dropped files based on mouse position.
   * - Hovering over a folder row = drop into that folder
   * - Hovering over a file row = drop into that file's parent folder (or root)
   * - Hovering in empty space = drop at root
   *
   * Also handles auto-expanding collapsed folders after hovering for 500ms.
   */
  function updateDropTarget(e: DragEvent) {
    if (!scrollEl) {
      dropTargetPath = null;
      clearHoverExpandTimer();
      return;
    }

    // Get mouse position relative to the scroll container
    const rect = scrollEl.getBoundingClientRect();
    const mouseY = e.clientY - rect.top + scrollEl.scrollTop;

    // Calculate which item index is being hovered
    const hoveredIndex = Math.floor(mouseY / itemHeight);

    // Check if hovering over empty space below all items
    if (hoveredIndex >= flattenedNodes.length) {
      dropTargetPath = null;
      clearHoverExpandTimer();
      return;
    }

    // Get the hovered node
    const hoveredNode = flattenedNodes[hoveredIndex];
    if (!hoveredNode) {
      dropTargetPath = null;
      clearHoverExpandTimer();
      return;
    }

    const node = hoveredNode.node;
    let newDropTargetPath: string | null = null;

    if (node.type === 'directory') {
      // Hovering over a folder - drop into this folder
      newDropTargetPath = node.path;
    } else {
      // Hovering over a file - find its parent folder
      const parentIndex = findParentDirectoryIndex(hoveredIndex);
      if (parentIndex >= 0) {
        newDropTargetPath = flattenedNodes[parentIndex].node.path;
      } else {
        // File is at root level
        newDropTargetPath = null;
      }
    }

    // Update the drop target path
    dropTargetPath = newDropTargetPath;

    // Auto-expand logic: start timer when hovering over a new collapsed directory
    if (node.type === 'directory' && !hoveredNode.isExpanded && onToggleDirectory) {
      // Check if we're hovering over a new collapsed folder
      if (hoverExpandTargetPath !== node.path) {
        // Clear any existing timer for the previous folder
        clearHoverExpandTimer();

        // Start a new timer for this folder
        hoverExpandTargetPath = node.path;
        hoverExpandTimeout = setTimeout(() => {
          // Find the node again in case flattenedNodes changed
          const targetNode = flattenedNodes.find((n) => n.node.path === hoverExpandTargetPath);
          if (targetNode && targetNode.node.type === 'directory' && !targetNode.isExpanded) {
            requestToggleDirectory(targetNode);
          }
          hoverExpandTimeout = null;
          hoverExpandTargetPath = null;
        }, 500);
      }
      // If already hovering the same collapsed folder, keep the timer running
    } else {
      // Not hovering over a collapsed directory, clear the timer
      clearHoverExpandTimer();
    }
  }

  /**
   * Find the parent directory index for a given item index.
   * Similar to findParentIndex but specifically looks for directories.
   */
  function findParentDirectoryIndex(currentIndex: number): number {
    if (currentIndex < 0 || currentIndex >= flattenedNodes.length) return -1;
    const currentDepth = flattenedNodes[currentIndex].depth;
    if (currentDepth === 0) return -1; // Already at root level

    // Walk backwards to find the first directory with lower depth
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (
        flattenedNodes[i].depth < currentDepth &&
        flattenedNodes[i].node.type === 'directory'
      ) {
        return i;
      }
    }
    return -1;
  }

  function handleFileDrop(e: DragEvent) {
    // Capture the drop target path BEFORE resetting state
    const targetPath = dropTargetPath;

    // Reset state regardless of whether we handle the drop
    dragEnterDepth = 0;
    isExternalFileDragOver = false;
    dropTargetPath = null;
    clearHoverExpandTimer();

    if (!isExternalFileDrag(e.dataTransfer)) return;

    e.preventDefault();
    e.stopPropagation();

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    // Extract files from the drop event
    const files = Array.from(dataTransfer.files);
    if (files.length > 0 && onExternalFilesDrop) {
      onExternalFilesDrop(files, targetPath);
    }
  }

  // Keyboard navigation: track focused path as the source of truth
  // This survives flattenedNodes changes (e.g., when folders expand/collapse)
  let focusedPath: string | null = $state(null);

  // Inline file creation state (declared here so effectiveNodes can reference it)
  let creatingInDir: string | null = $state(null);

  // Derived: effective nodes list that includes a sentinel creation row when active
  const effectiveNodes = $derived.by(() => {
    if (!creatingInDir) return flattenedNodes;

    // Find the target directory in the flattened list
    const dirIndex = flattenedNodes.findIndex((n) => n.node.path === creatingInDir);
    if (dirIndex < 0) {
      // Directory not visible (e.g., parent collapsed) — insert at top
      const sentinelNode: FlattenedFileNode = {
        node: {
          name: '',
          path: CREATING_SENTINEL_PATH,
          type: 'file',
          children: [],
        },
        depth: 0,
        isExpanded: false,
        isLoading: false,
      };
      return [sentinelNode, ...flattenedNodes];
    }

    const dirDepth = flattenedNodes[dirIndex].depth;
    const sentinelNode: FlattenedFileNode = {
      node: {
        name: '',
        path: CREATING_SENTINEL_PATH,
        type: 'file',
        children: [],
      },
      depth: dirDepth + 1,
      isExpanded: false,
      isLoading: false,
    };

    // Insert right after the directory entry
    const result = [...flattenedNodes];
    result.splice(dirIndex + 1, 0, sentinelNode);
    return result;
  });

  // Derive focusedIndex from focusedPath - recalculated when effectiveNodes changes
  const focusedIndex = $derived(() => {
    if (!focusedPath) return -1;
    const idx = effectiveNodes.findIndex((n) => n.node.path === focusedPath);
    return idx;
  });

  // Helper to set focus by index (updates the path), skipping sentinel nodes
  function setFocusedIndex(index: number) {
    if (index >= 0 && index < effectiveNodes.length) {
      const node = effectiveNodes[index];
      if (node.node.path === CREATING_SENTINEL_PATH) return;
      focusedPath = node.node.path;
    }
  }

  // Track previous selectedFile to detect external changes
  let prevSelectedFile: string | undefined = $state(undefined);

  // Sync focusedPath ONLY when selectedFile changes (external selection)
  // Not when flattenedNodes changes (folder expand/collapse)
  $effect(() => {
    // Only react to selectedFile changes
    if (selectedFile !== prevSelectedFile) {
      prevSelectedFile = selectedFile;

      if (selectedFile) {
        // Use untrack to read flattenedNodes without creating a dependency
        const nodes = untrack(() => flattenedNodes);
        if (nodes.length > 0) {
          const node = nodes.find((n) => pathMatches(n.node.path, selectedFile));
          if (node) {
            focusedPath = node.node.path;
          }
        }
      }
    }
  });

  // Get the focused node
  const focusedNode = $derived(
    focusedIndex() >= 0 && focusedIndex() < effectiveNodes.length
      ? effectiveNodes[focusedIndex()]
      : null,
  );

  // Find parent directory index for a given node
  function findParentIndex(currentIndex: number): number {
    if (currentIndex < 0 || currentIndex >= effectiveNodes.length) return -1;
    const currentDepth = effectiveNodes[currentIndex].depth;
    if (currentDepth === 0) return -1; // Already at root level

    // Walk backwards to find the first node with lower depth, skipping sentinel
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (effectiveNodes[i].node.path === CREATING_SENTINEL_PATH) continue;
      if (effectiveNodes[i].depth < currentDepth) {
        return i;
      }
    }
    return -1;
  }

  // Scroll focused item into view
  function scrollFocusedIntoView(index: number) {
    if (!scrollEl || index < 0) return;
    const targetScrollTop = index * itemHeight;
    const targetBottom = targetScrollTop + itemHeight;
    const viewTop = scrollEl.scrollTop;
    const viewBottom = viewTop + measuredHeight;

    if (targetScrollTop < viewTop) {
      scrollEl.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    } else if (targetBottom > viewBottom) {
      scrollEl.scrollTo({ top: targetBottom - measuredHeight, behavior: 'smooth' });
    }
  }

  // Handle keyboard navigation (VSCode-style)
  /** Exported so parent can forward keyboard events (e.g. from the search input). */
  export function handleKeydown(e: KeyboardEvent) {
    const currentIndex = focusedIndex();

    // Don't handle if we're editing or creating
    if (editingPath || creatingInDir) return;

    const nodeCount = effectiveNodes.length;
    if (nodeCount === 0) return;

    // Helper to find next navigable index (skips sentinel nodes)
    function nextIndex(from: number, direction: 1 | -1): number {
      let idx = from + direction;
      while (idx >= 0 && idx < nodeCount) {
        if (effectiveNodes[idx].node.path !== CREATING_SENTINEL_PATH) return idx;
        idx += direction;
      }
      return from; // No valid index found, stay put
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const newIndex = nextIndex(currentIndex, 1);
        if (newIndex !== currentIndex) {
          setFocusedIndex(newIndex);
          scrollFocusedIntoView(newIndex);
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const newIndex = nextIndex(currentIndex, -1);
        if (newIndex !== currentIndex || currentIndex === -1) {
          setFocusedIndex(newIndex);
          scrollFocusedIntoView(newIndex);
        }
        break;
      }

      case 'ArrowRight': {
        e.preventDefault();
        if (!focusedNode) break;
        const node = focusedNode.node;
        if (node.type === 'directory') {
          if (!focusedNode.isExpanded) {
            // Expand the directory
            requestToggleDirectory(focusedNode);
          } else if (node.children && node.children.length > 0) {
            // Move to first child
            setFocusedIndex(currentIndex + 1);
            scrollFocusedIntoView(currentIndex + 1);
          }
        } else {
          // For files, open the file
          onFileSelect?.(node.path);
        }
        break;
      }

      case 'ArrowLeft': {
        e.preventDefault();
        if (!focusedNode) break;
        const node = focusedNode.node;
        if (node.type === 'directory' && focusedNode.isExpanded) {
          // Collapse the directory
          requestToggleDirectory(focusedNode);
        } else {
          // Move to parent directory
          const parentIndex = findParentIndex(currentIndex);
          if (parentIndex >= 0) {
            setFocusedIndex(parentIndex);
            scrollFocusedIntoView(parentIndex);
          }
        }
        break;
      }

      case 'Enter': {
        // VSCode behavior: Enter renames file/folder if rename is enabled
        // Otherwise it opens the file or toggles the directory
        e.preventDefault();
        if (!focusedNode) break;
        const node = focusedNode.node;
        if (onRenameFile) {
          startEditing(node.path, node.name);
        } else if (node.type === 'directory') {
          requestToggleDirectory(focusedNode);
        } else {
          onFileSelect?.(node.path);
        }
        break;
      }

      case ' ': {
        // Space: open file for preview but keep focus in explorer (VSCode behavior)
        e.preventDefault();
        if (!focusedNode) break;
        const node = focusedNode.node;
        if (node.type === 'file') {
          onFileSelect?.(node.path);
          // Focus stays in explorer - don't blur
        } else {
          // For directories, toggle expansion
          requestToggleDirectory(focusedNode);
        }
        break;
      }

      case 'Home': {
        e.preventDefault();
        if (nodeCount > 0) {
          setFocusedIndex(0);
          scrollFocusedIntoView(0);
        }
        break;
      }

      case 'End': {
        e.preventDefault();
        if (nodeCount > 0) {
          setFocusedIndex(nodeCount - 1);
          scrollFocusedIntoView(nodeCount - 1);
        }
        break;
      }

      default: {
        // Type-ahead search: single printable character jumps to matching item
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          handleTypeAhead(e.key, currentIndex, nodeCount);
        }
        break;
      }
    }
  }

  // Type-ahead search state
  let typeAheadBuffer = $state('');
  let typeAheadTimeout: ReturnType<typeof setTimeout> | null = null;

  // Handle type-ahead search (VSCode-style)
  function handleTypeAhead(char: string, currentIndex: number, nodeCount: number) {
    // Clear previous timeout
    if (typeAheadTimeout) {
      clearTimeout(typeAheadTimeout);
    }

    // Add character to buffer
    typeAheadBuffer += char.toLowerCase();

    // Reset buffer after 500ms of no typing
    typeAheadTimeout = setTimeout(() => {
      typeAheadBuffer = '';
    }, 500);

    // Find matching item
    const searchStr = typeAheadBuffer;

    // Start searching from current position + 1, wrap around
    for (let offset = 1; offset <= nodeCount; offset++) {
      const idx = (currentIndex + offset) % nodeCount;
      const node = effectiveNodes[idx];
      if (node.node.path === CREATING_SENTINEL_PATH) continue;
      const name = node.node.name.toLowerCase();

      if (name.startsWith(searchStr)) {
        setFocusedIndex(idx);
        scrollFocusedIntoView(idx);
        return;
      }
    }

    // If no match found with multi-char, try just the last character
    // (allows quick repeated presses of same letter to cycle)
    if (searchStr.length > 1) {
      const lastChar = searchStr[searchStr.length - 1];
      for (let offset = 1; offset <= nodeCount; offset++) {
        const idx = (currentIndex + offset) % nodeCount;
        const node = effectiveNodes[idx];
        if (node.node.path === CREATING_SENTINEL_PATH) continue;
        const name = node.node.name.toLowerCase();

        if (name.startsWith(lastChar)) {
          setFocusedIndex(idx);
          scrollFocusedIntoView(idx);
          typeAheadBuffer = lastChar; // Reset buffer to just last char
          return;
        }
      }
    }
  }

  // Inline editing state
  let editingPath: string | null = $state(null);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Inline file creation value/ref (creatingInDir declared above with effectiveNodes)
  let creatingValue = $state('');
  let createInputRef: HTMLInputElement | null = $state(null);

  // Auto-focus the creation input when it appears
  $effect(() => {
    if (createInputRef) {
      createInputRef.focus();
    }
  });

  // Start inline file creation in a directory
  export async function startCreatingFile(dirPath?: string) {
    // Determine target directory
    let targetDir = dirPath;
    if (!targetDir) {
      // Use focused node's directory, or workspace root
      if (focusedPath) {
        const focusedFlatNode = flattenedNodes.find((n) => n.node.path === focusedPath);
        if (focusedFlatNode) {
          targetDir =
            focusedFlatNode.node.type === 'directory'
              ? focusedFlatNode.node.path
              : focusedFlatNode.node.path.substring(
                  0,
                  focusedFlatNode.node.path.lastIndexOf('/'),
                );
        }
      }
      if (!targetDir) {
        targetDir = $fileExplorerWorkspacePath;
      }
    }

    // Expand directory if collapsed
    const dirNode = flattenedNodes.find(
      (n) => n.node.path === targetDir && n.node.type === 'directory',
    );
    if (dirNode && !dirNode.isExpanded) {
      requestToggleDirectory(dirNode);
      // Wait for reactive update after expansion
      await tick();
    }

    creatingInDir = targetDir!;
    creatingValue = '';
  }

  // Save the new file
  async function saveCreate() {
    const trimmed = creatingValue.trim();
    if (trimmed && creatingInDir && onCreateFile) {
      await onCreateFile(creatingInDir, trimmed);
    }
    cancelCreate();
  }

  // Cancel inline file creation
  function cancelCreate() {
    creatingInDir = null;
    creatingValue = '';
    requestAnimationFrame(() => {
      treeContainer?.focus();
    });
  }

  // Handle keyboard events during creation
  function handleCreateKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCreate();
    }
  }

  // Context menu state
  let contextMenu: { x: number; y: number; node: FileNode | null } | null = $state(null);

  function handleContextMenu(e: MouseEvent, node: FileNode) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, node };
  }

  function handleBackgroundContextMenu(e: MouseEvent) {
    // Only show if click target is the tree container or scroll area (not a file item)
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, node: null };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  async function handleDeleteFile(filePath: string) {
    const fileName = filePath.split('/').pop() || 'file';
    // Read file content before deleting so we can undo
    let savedContent = '';
    try {
      const result = await invoke<{ content: string }>('file:read', { path: filePath });
      savedContent = result?.content ?? '';
    } catch {
      // If we can't read the file, proceed with delete but undo won't restore content
    }

    await deleteWithUndo(
      `"${fileName}"`,
      async () => {
        const result = await invoke<{ success: boolean; error?: string }>('file:delete', {
          path: filePath,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to delete file');
        }
        // Close related panel tabs after successful deletion
        if (workspaceId && hasPanelLayoutManager(workspaceId)) {
          const layoutManager = getPanelLayoutManager(workspaceId);
          layoutManager.closeTabsByType('file', 'filePath', filePath);
        }
        dispatchWindowEvent('file:changed', { workspaceId, type: 'delete', filePath });
        track('Deleted File', {
          workspace_id: workspaceId || '',
          file_extension: getFileExtension(filePath),
        });
      },
      async () => {
        await invoke('file:write', {
          path: filePath,
          content: savedContent,
          workspaceId,
        });
        dispatchWindowEvent('file:changed', { workspaceId, type: 'create', filePath });
      },
    );
  }

  function getBackgroundContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [];
    if (onCreateFile) {
      items.push({
        id: 'new-file',
        label: 'New File',
        icon: faPlus,
        onClick: () => {
          startCreatingFile($fileExplorerWorkspacePath);
          closeContextMenu();
        },
      });
    }
    return items;
  }

  function getContextMenuItems(node: FileNode): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [];

    if (node.type === 'file') {
      items.push({
        id: 'open',
        label: 'Open',
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          onFileSelect?.(node.path);
          closeContextMenu();
        },
      });
      if (onCreateFile) {
        const parentDir = node.path.substring(0, node.path.lastIndexOf('/')) || $fileExplorerWorkspacePath;
        items.push({
          id: 'new-file',
          label: 'New File',
          icon: faPlus,
          onClick: () => {
            startCreatingFile(parentDir);
            closeContextMenu();
          },
        });
      }
    } else {
      items.push({
        id: 'toggle',
        label: flattenedNodes.find((n) => n.node.path === node.path)?.isExpanded ? 'Collapse' : 'Expand',
        icon: faFolderOpen,
        onClick: () => {
          const flatNode = flattenedNodes.find((n) => n.node.path === node.path);
          if (flatNode) requestToggleDirectory(flatNode);
          closeContextMenu();
        },
      });
      if (onCreateFile) {
        items.push({
          id: 'new-file',
          label: 'New File',
          icon: faPlus,
          onClick: () => {
            startCreatingFile(node.path);
            closeContextMenu();
          },
        });
      }
    }

    if (onRenameFile) {
      items.push({
        id: 'rename',
        label: 'Rename',
        icon: faPencil,
        onClick: () => {
          startEditing(node.path, node.name);
          closeContextMenu();
        },
      });
    }

    if (node.type === 'file') {
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: faTrash,
        onClick: () => {
          handleDeleteFile(node.path);
          closeContextMenu();
        },
      });
    }

    // Add reveal in Finder option
    items.push({ type: 'separator' });
    items.push({
      id: 'reveal',
      label: 'Reveal in Finder',
      onClick: async () => {
        await invoke('shell:showItemInFolder', { path: node.path });
        closeContextMenu();
      },
    });

    return items;
  }

  // Start editing a file/folder name
  async function startEditing(path: string, currentName: string) {
    editingPath = path;
    editingValue = currentName;
    await tick();
    editInputRef?.focus();
    // Select just the filename without extension for files
    if (editInputRef) {
      const dotIndex = currentName.lastIndexOf('.');
      if (dotIndex > 0) {
        editInputRef.setSelectionRange(0, dotIndex);
      } else {
        editInputRef.select();
      }
    }
  }

  // Save the edited name
  async function saveEdit() {
    if (editingPath && editingValue.trim() && onRenameFile) {
      const trimmed = editingValue.trim();
      const oldName = editingPath.split('/').pop() || '';
      if (trimmed !== oldName) {
        const parentPath = editingPath.substring(0, editingPath.lastIndexOf('/'));
        const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
        // Wait for rename to complete before clearing edit state
        await onRenameFile(editingPath, newPath);
        // Move focus to the renamed item
        focusedPath = newPath;
      }
    }
    cancelEdit();
  }

  // Cancel editing
  function cancelEdit() {
    editingPath = null;
    editingValue = '';
    // Refocus the tree container so keyboard navigation continues to work
    requestAnimationFrame(() => {
      treeContainer?.focus();
    });
  }

  // Handle keyboard events during editing
  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  // Handle double-click on file/folder name
  function handleDoubleClick(node: FileNode, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (onRenameFile) {
      startEditing(node.path, node.name);
    }
  }

  // Check if a node path matches the selected file
  // Handles both absolute and relative paths
  function isSelected(nodePath: string): boolean {
    if (!selectedFile) return false;
    // Direct match (both absolute or both relative)
    if (nodePath === selectedFile) return true;
    const workspacePath = $fileExplorerWorkspacePath;
    // selectedFile is relative, nodePath is absolute
    if (workspacePath && nodePath === `${workspacePath}/${selectedFile}`) return true;
    // selectedFile is absolute, nodePath matches the end
    if (selectedFile.startsWith('/') && nodePath.endsWith(selectedFile)) return true;
    // nodePath is absolute and selectedFile is relative - check if nodePath ends with selectedFile
    if (nodePath.startsWith('/') && !selectedFile.startsWith('/')) {
      return nodePath.endsWith(`/${selectedFile}`);
    }
    return false;
  }

  // Scroll state
  let scrollTop = $state(0);
  let scrollEl: HTMLDivElement | undefined = $state();
  let rafId: number | undefined;
  let measuredHeight = $state(400); // Will be updated by ResizeObserver

  // Use ResizeObserver to track actual container height
  let resizeObserver: ResizeObserver | undefined;
  let resizeRafId: number | undefined;

  onMount(() => {
    if (scrollEl) {
      measuredHeight = scrollEl.clientHeight;
      resizeObserver = new ResizeObserver((entries) => {
        // Use RAF to debounce resize updates and avoid jank during panel resize
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          for (const entry of entries) {
            measuredHeight = entry.contentRect.height;
          }
        });
      });
      resizeObserver.observe(scrollEl);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      resizeObserver?.disconnect();
    };
  });

  // Virtual scroll calculations (use effectiveNodes to account for creation row)
  const visibleCount = $derived(Math.ceil(measuredHeight / itemHeight));
  const totalHeight = $derived(effectiveNodes.length * itemHeight);
  const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
  const endIndex = $derived(
    Math.min(effectiveNodes.length, startIndex + visibleCount + overscan * 2),
  );
  const visibleItems = $derived(effectiveNodes.slice(startIndex, endIndex));
  const offsetY = $derived(startIndex * itemHeight);

  // Handle scroll with RAF for performance
  function handleScroll(event: Event) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const target = event.target as HTMLDivElement;
      scrollTop = target.scrollTop;
    });
  }

  // Reference to the tree container for focus management
  let treeContainer: HTMLDivElement | undefined = $state();

  // Handle item click
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleItemClick(flatNode: FlattenedFileNode, index: number) {
    // Update focused path on click (use path directly for stability)
    focusedPath = flatNode.node.path;
    if (flatNode.node.type === 'file') {
      onFileSelect?.(flatNode.node.path);
    } else {
      requestToggleDirectory(flatNode);
    }
    // Refocus the tree container so keyboard navigation continues to work
    requestAnimationFrame(() => {
      treeContainer?.focus();
    });
  }

  // Check if a path matches a node path (helper for scrollToPath)
  function pathMatches(nodePath: string, targetPath: string): boolean {
    if (filePathsMatch(nodePath, targetPath)) return true;
    const workspacePath = $fileExplorerWorkspacePath;
    if (workspacePath && nodePath === `${workspacePath}/${targetPath}`) return true;
    return false;
  }

  // Scroll to a specific file path
  export function scrollToPath(path: string) {
    const index = effectiveNodes.findIndex((n) => pathMatches(n.node.path, path));
    if (index >= 0 && scrollEl) {
      const targetScrollTop = index * itemHeight - measuredHeight / 2 + itemHeight / 2;
      scrollEl.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    }
  }

  /**
   * Returns whether external files are currently being dragged over the tree.
   * Use this for external visual feedback (e.g., overlays).
   */
  export function getIsExternalFileDragOver(): boolean {
    return isExternalFileDragOver;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={treeContainer}
  class="relative h-full overflow-hidden outline-none transition-colors duration-150"
  class:file-drop-root={isExternalFileDragOver && dropTargetPath === null}
  style="contain: layout style;"
  tabindex="0"
  role="tree"
  aria-label="File explorer"
  onkeydown={handleKeydown}
  oncontextmenu={handleBackgroundContextMenu}
  ondragenter={handleFileDragEnter}
  ondragleave={handleFileDragLeave}
  ondragover={handleFileDragOver}
  ondrop={handleFileDrop}
>
  <div
    bind:this={scrollEl}
    class="h-full overflow-y-auto overflow-x-hidden"
    style="contain: content;"
    onscroll={handleScroll}
  >
    <!-- Total height spacer for correct scrollbar -->
    <div class="relative" style="height: {totalHeight}px;">
      <!-- Visible items positioned absolutely -->
      <div class="absolute top-0 left-0 right-0" style="transform: translateY({offsetY}px);">
        {#each visibleItems as flatNode, i (flatNode.node.path)}
          {@const absoluteIndex = startIndex + i}
          {@const node = flatNode.node}
          {@const depth = flatNode.depth}

          {#if node.path === CREATING_SENTINEL_PATH}
            <!-- Inline file creation input -->
            <div
              class="flex items-center"
              style="height: {itemHeight}px; padding-left: {depth * 16}px;"
            >
              <div
                class="relative min-w-0 flex items-center gap-2.5 py-1 rounded-md border border-border shadow-xs bg-background text-foreground"
                style="margin-left: 0.5px; padding-left: 9px; padding-right: 0.5px; width: calc(100% - 0.5px);"
              >
                <span class="shrink-0 flex items-center justify-center w-4 h-4 [&>svg]:w-full [&>svg]:h-full">
                  {@html getFileTypeIconSvg(creatingValue || '')}
                </span>
                <input
                  bind:this={createInputRef}
                  type="text"
                  bind:value={creatingValue}
                  onblur={saveCreate}
                  onkeydown={handleCreateKeydown}
                  placeholder="filename"
                  class="flex-1 text-sm leading-tight bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0"
                  onclick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          {:else}
            {@const isFocused = node.path === focusedPath}
            {@const displayName = flatNode.displayPath ?? node.name}
            {@const isIgnored = node.isGitignored === true}
            {@const gitColor =
              node.type === 'directory'
                ? flatNode.directoryHasChanges
                  ? 'text-yellow-700 dark:text-yellow-400'
                  : ''
                : getGitStatusColor(flatNode.gitStatus?.status)}
            {@const hasChanges =
              (flatNode.gitStatus?.additions ?? 0) > 0 ||
              (flatNode.gitStatus?.deletions ?? 0) > 0}
            {@const isModified = isFileModified(node.path) && node.type === 'file'}
            {@const isDropTarget =
              isExternalFileDragOver &&
              dropTargetPath !== null &&
              node.type === 'directory' &&
              node.path === dropTargetPath}
            {@const isInsideDropTarget =
              isExternalFileDragOver &&
              dropTargetPath !== null &&
              node.path !== dropTargetPath &&
              node.path.startsWith(dropTargetPath + '/')}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center transition-colors duration-150 {isIgnored ? 'opacity-50' : ''}"
              class:folder-drop-target={isDropTarget}
              class:inside-drop-target={isInsideDropTarget}
              style="height: {itemHeight}px; padding-left: {depth * 16}px;"
              data-file-path={node.path}
              ondblclick={(e) => handleDoubleClick(node, e)}
              oncontextmenu={(e) => handleContextMenu(e, node)}
            >
              {#if editingPath === node.path}
                <!-- Inline edit mode - matches ListItem sm size styling exactly -->
                <div
                  class="relative min-w-0 flex items-center gap-2.5 py-1 rounded-md border border-border shadow-xs bg-background text-foreground"
                  style="margin-left: 0.5px; padding-left: 9px; padding-right: 0.5px; width: calc(100% - 0.5px);"
                >
                  <span class={`shrink-0 flex items-center justify-center ${node.type === 'directory' ? `opacity-50 ${gitColor}` : `w-4 h-4 [&>svg]:w-full [&>svg]:h-full`}`}>
                    {#if node.type === 'directory'}
                      <Fa icon={faChevronDown} size="12" />
                    {:else}
                      {@html getFileTypeIconSvg(node.name)}
                    {/if}
                  </span>
                  <input
                    bind:this={editInputRef}
                    type="text"
                    bind:value={editingValue}
                    onblur={saveEdit}
                    onkeydown={handleEditKeydown}
                    class="flex-1 text-sm leading-tight bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0"
                    onclick={(e) => e.stopPropagation()}
                  />
                </div>
              {:else if node.type === 'directory'}
                <ListItem
                  active={isSelected(node.path)}
                  selected={isFocused}
                  tabindex={-1}
                  icon={faChevronDown}
                  iconClass={`opacity-50 [&>svg]:w-2! [&>svg]:mr-1! ${gitColor} transition-transform duration-150 ${flatNode.isExpanded ? '' : '-rotate-90'}`}
                  title={displayName}
                  titleClass={gitColor}
                  onclick={() => handleItemClick(flatNode, absoluteIndex)}
                  size="sm"
                  class="flex-1"
                  actions={onCreateFile
                    ? [
                        {
                          icon: faPlus,
                          label: 'New file',
                          tooltip: 'Create new file in this folder',
                          onClick: (e: MouseEvent) => {
                            e.stopPropagation();
                            startCreatingFile(node.path);
                          },
                        },
                      ]
                    : []}
                  actionsVisible="hover"
                />
              {:else}
                <ListItem
                  active={isSelected(node.path)}
                  selected={isFocused}
                  tabindex={-1}
                  iconClass={gitColor}
                  title={displayName}
                  titleClass={gitColor}
                  badge={isModified ? '•' : undefined}
                  badgeClass={isModified ? 'text-blue-500' : undefined}
                  onclick={() => handleItemClick(flatNode, absoluteIndex)}
                  size="sm"
                  class="flex-1"
                >
                  {#snippet iconSnippet()}
                    <span class="w-4 h-4 [&>svg]:w-full [&>svg]:h-full">
                      {@html getFileTypeIconSvg(node.name)}
                    </span>
                  {/snippet}
                </ListItem>
              {/if}
              {#if hasChanges}
                <LineChangesBadge
                  additions={flatNode.gitStatus?.additions ?? 0}
                  deletions={flatNode.gitStatus?.deletions ?? 0}
                  size="xs"
                  class=" ml-2"
                />
              {/if}
              {#if flatNode.agentEdits && flatNode.agentEdits.length > 0 && (node.type === 'file' || !flatNode.isExpanded)}
                <div class="flex items-center -space-x-1 mr-1 ml-2">
                  {#each flatNode.agentEdits.slice(0, 3) as agentId (agentId)}
                    <button
                      type="button"
                      class="rounded-full overflow-hidden cursor-pointer"
                      title="Click to open agent"
                      onclick={(e) => {
                        e.stopPropagation();
                        onSelectAgent?.(agentId);
                      }}
                    >
                      <AuggieAvatar {agentId} size={16} />
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.node ? getContextMenuItems(contextMenu.node) : getBackgroundContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}

<style>
  /* Visual feedback when dragging files to root level (no specific folder targeted) */
  .file-drop-root {
    outline: 2px dashed hsl(var(--primary));
    outline-offset: -2px;
    background-color: hsl(var(--primary) / 0.05);
  }

  /* Visual feedback when hovering over a specific folder */
  .folder-drop-target {
    background-color: hsl(var(--primary) / 0.15);
    border-radius: 2px;
  }

  /* Visual feedback for items inside the drop target folder */
  .inside-drop-target {
    background-color: hsl(var(--primary) / 0.08);
  }
</style>
