<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { Note, Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import { TASK_LINK_REGEX_FLEXIBLE } from '$shared/constants/intent-links';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import Fa from 'svelte-fa';
  import {
    faEllipsisV,
    faArrowRight,
    faCodeBranch,
    faCodePullRequest,
    faCheck,
    faFileLines,
  } from '@fortawesome/free-solid-svg-icons';
  import SidebarIcon from '$lib/components/icons/SidebarIcon.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import TaskStatusIndicator from '$lib/components/workspace/TaskStatusIndicator.svelte';
  import TaskAgentStatus from '$lib/components/tiptap/TaskAgentStatus.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import WorkspaceActionsMenu, {
    type MenuAction,
  } from '$lib/components/ui/WorkspaceActionsMenu.svelte';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { goto } from '$app/navigation';
  import { tick, onMount } from 'svelte';
  import { logger, createLogger } from '$lib/utils/client-logger';
  import { notesClient } from '$features/notes/notes.client';
  import { createWorkspaceId, WorkspaceId } from '$shared/types/branded-ids';
  import { listenSync } from '$lib/electron-bridge';
  import { ChatServiceManager } from '$features/agent/services/chat.service';
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import type { WorkspaceGitStatus } from '$features/accept-changes/types';
  import FlameGraph from './FlameGraph.svelte';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import { hasRunningAgents, getRunningAgentNames } from '$lib/utils/delete-warning-utils';

  const readyLogger = createLogger('ReadyTasks');

  interface Props {
    notes?: Note[];
    workspace?: Workspace;
    workspaceId?: string;
    onOpenNote?: (noteId: string) => void;
    onAcceptChanges?: () => void;
    /** Compact mode for homepage cards - hides editing, skips git status loading */
    compact?: boolean;
    /** Click handler for the entire card (used in compact mode) */
    onClick?: () => void;
  }

  let {
    notes = [],
    workspace,
    workspaceId,
    onOpenNote,
    onAcceptChanges,
    compact = false,
    onClick,
  }: Props = $props();

  // Git status state for workflow awareness
  let gitStatus = $state<WorkspaceGitStatus | null>(null);
  let gitStatusLoading = $state(false);

  // Load git status when workspace is available
  async function loadGitStatus() {
    if (!workspaceId) return;

    const capturedWorkspaceId = workspaceId; // Capture for async guard
    gitStatusLoading = true;
    gitStatus = null; // Clear stale data from previous workspace immediately

    try {
      const result = await AcceptChangesClient.getStatus(WorkspaceId(capturedWorkspaceId));
      // Guard: only apply if workspace hasn't changed during async call
      if (workspaceId === capturedWorkspaceId) {
        gitStatus = result;
      }
    } catch {
      // Silently handle errors - git status is optional
      if (workspaceId === capturedWorkspaceId) {
        gitStatus = null;
      }
    } finally {
      if (workspaceId === capturedWorkspaceId) {
        gitStatusLoading = false;
      }
    }
  }

  // Load git status on mount and when workspace changes
  // Keep this as an effect since it needs to react to workspaceId changes
  // Skip in compact mode to avoid expensive GitHub API calls on homepage
  $effect(() => {
    if (workspaceId && !compact) {
      loadGitStatus();
    }
  });

  // Listen for git status changes to refresh
  // Using onMount with listenSync for proper cleanup on unmount
  onMount(() => {
    if (!workspaceId || compact) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 5000; // 5 seconds debounce to avoid rate limiting GitHub API

    // Capture workspaceId at mount time
    const mountedWorkspaceId = workspaceId;

    // Debounced version of loadGitStatus to prevent excessive GitHub API calls
    const debouncedLoadGitStatus = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        loadGitStatus();
        debounceTimer = null;
      }, DEBOUNCE_MS);
    };

    // Use listenSync for synchronous cleanup - no race conditions on unmount
    const unsubscribe1 = listenSync<{ workspaceId: string }>('git:status-changed', (event) => {
      if (event.payload?.workspaceId === mountedWorkspaceId) {
        debouncedLoadGitStatus();
      }
    });

    // Also listen for file tracking changes
    // NOTE: file-tracking:changes-updated can fire very frequently during agent activity.
    // We debounce this to avoid hitting GitHub API rate limits, since loadGitStatus
    // calls AcceptChangesClient.getStatus which fetches PR info from GitHub.
    const unsubscribe2 = listenSync<{ workspaceId: string }>(
      'file-tracking:changes-updated',
      (event) => {
        if (event.payload?.workspaceId === mountedWorkspaceId) {
          debouncedLoadGitStatus();
        }
      },
    );

    // Listen for workspace updates (e.g., PR discovered via refresh)
    const unsubscribe3 = listenSync<{ workspaceId: string; changes: Record<string, unknown> }>(
      'workspace:updated',
      (event) => {
        if (event.payload?.workspaceId === mountedWorkspaceId) {
          // Check if PR-related fields changed
          const changes = event.payload?.changes;
          if (
            changes &&
            ('activePullRequest' in changes ||
              'prStatus' in changes ||
              'prNumber' in changes ||
              'pullRequests' in changes)
          ) {
            debouncedLoadGitStatus();
          }
        }
      },
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  });

  // Header editing state
  let isDeleting = $state(false);
  let isEditingTitle = $state(false);
  let editedTitle = $state('');
  let titleInputRef: HTMLInputElement | null = $state(null);
  let dropdownOpen = $state(false);

  // Delete warning dialog state
  let showDeleteWarning = $state(false);
  let pendingDeleteWorkspace = $state<Workspace | null>(null);
  let runningAgentNamesForDelete = $state<string[]>([]);

  // Derive the workspace path display
  const workspacePath = $derived(workspace?.worktreePath || workspace?.repositoryPath || '');

  // Copy workspace repo path to clipboard
  let copiedRepoPath = $state(false);
  let repoTooltipOpen = $state(false);
  let copyRepoPathTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleRepoTooltipOpenChange(open: boolean) {
    // Don't close if we just copied (keep it open to show check)
    if (!open && copiedRepoPath) return;
    repoTooltipOpen = open;
  }

  async function copyRepoPath(event?: MouseEvent) {
    event?.stopPropagation(); // Prevent triggering parent click handlers in compact mode
    event?.preventDefault();
    if (!workspacePath) return;
    try {
      await navigator.clipboard.writeText(workspacePath);
      copiedRepoPath = true;
      repoTooltipOpen = true; // Keep tooltip open to show check
      if (copyRepoPathTimeout) clearTimeout(copyRepoPathTimeout);
      copyRepoPathTimeout = setTimeout(() => {
        copiedRepoPath = false;
        repoTooltipOpen = false;
      }, 2000);
    } catch (error) {
      logger.error('Failed to copy path:', error);
    }
  }

  // Check if workspace is archived
  let isArchived = $derived(workspace?.status === WorkspaceStatusEnum.Archived);

  async function handleDelete() {
    if (isDeleting || !workspace) return;

    // Check if workspace has running agents
    if (hasRunningAgents(workspace.id)) {
      // Show warning dialog instead of deleting immediately
      pendingDeleteWorkspace = workspace;
      runningAgentNamesForDelete = getRunningAgentNames(workspace.id);
      showDeleteWarning = true;
      return;
    }

    // No running agents, proceed with deletion
    await performDelete();
  }

  async function performDelete() {
    if (isDeleting || !workspace) return;

    try {
      isDeleting = true;
      // Navigate immediately to avoid UI stalling
      goto('/');

      await workspaceStore.deleteWithUndo(workspace.id, workspace.title);
    } catch (error) {
      logger.error('Failed to delete workspace:', error);
    } finally {
      isDeleting = false;
    }
  }

  async function handleArchive() {
    if (!workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = workspace.title || 'space';

    const result = await workspaceStore.archive(workspace.id);
    if (result.ok) {
      toast.warning(`Archived space ${workspaceTitle}`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await workspaceStore.unarchive(workspace.id);
          },
        },
      });
      goto('/');
    } else {
      toast.error('Failed to archive space');
    }
  }

  async function handleUnarchive() {
    if (!workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = workspace.title || 'space';

    const result = await workspaceStore.unarchive(workspace.id);
    if (result.ok) {
      toast.success(`Unarchived space ${workspaceTitle}`);
    } else {
      toast.error('Failed to unarchive space');
    }
  }

  function startEditingTitle() {
    if (!workspace) return;
    isEditingTitle = true;
    editedTitle = workspace.title || 'Untitled';
    tick().then(() => {
      if (titleInputRef) {
        titleInputRef.focus();
        titleInputRef.select();
      }
    });
  }

  async function saveTitle() {
    if (!workspace || !editedTitle.trim()) {
      isEditingTitle = false;
      return;
    }

    const newTitle = editedTitle.trim();
    if (newTitle !== workspace.title) {
      await workspaceStore.update(workspace.id, { title: newTitle });
    }
    isEditingTitle = false;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      isEditingTitle = false;
      editedTitle = workspace?.title || 'Untitled';
    }
  }

  function handleDropdownClose() {
    dropdownOpen = false;
  }

  const sidebarSideAction: MenuAction = $derived({
    label: layoutSettings.sidebarSide === 'left' ? 'Move sidebar to right' : 'Move sidebar to left',
    iconSnippet: sidebarSideIconSnippet,
    dividerBefore: true,
    onClick: () => {
      layoutSettings.toggleSidebarSide();
    },
  });

  function handleClickOutside(e: MouseEvent) {
    if (isEditingTitle && titleInputRef && !titleInputRef.contains(e.target as Node)) {
      saveTitle();
    }
  }

  $effect(() => {
    if (isEditingTitle) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  });

  // Hover state for progress segments
  let hoveredNoteId: string | null = $state(null);

  // Ready tasks state
  let readyTasks: Note[] = $state([]);
  let currentReadyIndex = $state(0);
  let isLoadingReadyTasks = $state(false);
  let readyTasksError: string | null = $state(null);
  let hasSearchedForReadyTasks = $state(false);

  // Deduplicate notes by ID
  function deduplicateNotes(notesList: Note[]): Note[] {
    const seen = new Set<string>();
    return notesList.filter((n) => {
      const noteId = n.id as string;
      if (seen.has(noteId)) return false;
      seen.add(noteId);
      return true;
    });
  }

  // Load all ready tasks using the backend service
  async function loadReadyTasks() {
    if (!workspaceId) return;

    isLoadingReadyTasks = true;
    readyTasksError = null;

    try {
      const wsId = createWorkspaceId(workspaceId);
      const result = await notesClient.findReadyTasks(wsId);

      if (result.ok) {
        // Deduplicate to prevent duplicate entries
        readyTasks = deduplicateNotes(result.data.ready);
        currentReadyIndex = 0;
        readyLogger.info('Loaded ready tasks', { count: readyTasks.length });
      } else {
        readyLogger.info('No ready tasks found');
        readyTasks = [];
      }
    } catch (error) {
      readyTasksError = error instanceof Error ? error.message : String(error);
      readyLogger.error('Error loading ready tasks', error);
      readyTasks = [];
    } finally {
      isLoadingReadyTasks = false;
      hasSearchedForReadyTasks = true;
    }
  }

  // Auto-load ready tasks on initial load (only once)
  // Keep this as an effect since it needs to react to notes changes
  // Skip in compact mode - ready tasks are not shown on homepage
  $effect(() => {
    if (
      workspaceId &&
      notes.length > 0 &&
      !isLoadingReadyTasks &&
      !hasSearchedForReadyTasks &&
      !compact
    ) {
      loadReadyTasks();
    }
  });

  // Listen for ready tasks changes from backend
  // Using onMount with listenSync for proper cleanup on unmount
  onMount(() => {
    if (!workspaceId || compact) return;

    // Capture workspaceId at mount time
    const mountedWorkspaceId = workspaceId;

    // Use listenSync for synchronous cleanup - no race conditions on unmount
    const unsubscribe = listenSync<{
      workspaceId: string;
      data: {
        readyTaskIds: string[];
        triggeredBy?: {
          noteId: string;
          previousStatus: string;
          newStatus: string;
        };
        computedAt: string;
      };
    }>('task:ready-tasks-changed', (event) => {
      const payload = event.payload;
      const eventWorkspaceId = payload?.workspaceId;
      const readyTaskIds = payload?.data?.readyTaskIds;

      if (eventWorkspaceId !== mountedWorkspaceId) return;

      // Update ready tasks from the notes we already have
      // Deduplicate to prevent duplicate entries if notes array has duplicates
      if (readyTaskIds) {
        const filtered = notes.filter((n) => readyTaskIds.includes(n.id as string));
        readyTasks = deduplicateNotes(filtered);
        // Reset index if current is out of bounds
        if (currentReadyIndex >= readyTasks.length) {
          currentReadyIndex = Math.max(0, readyTasks.length - 1);
        }
        readyLogger.info('Ready tasks updated from backend', { count: readyTasks.length });
      }
    });

    return unsubscribe;
  });

  // Check if a note has unread changes
  // NOTE: The refresh is triggered by the parent component (WorkspaceDetailSidebar)
  // to avoid duplicate IPC calls from multiple components.
  // We use the store's hasUnreadChanges method directly for consistency.
  const hasUnreadChanges = noteReadTrackingStore.hasUnreadChanges;

  // Get spec note
  const specNote = $derived(notes.find((n) => n.id === 'spec' || n.isDefault));

  // Compute task stats from tasks within the spec note only
  // Only counts direct children of the spec note (parentId === 'spec')
  // Note: Excludes cancelled tasks from total (they're abandoned, not contributing to progress)
  const taskStats = $derived.by(() => {
    // Filter to only task notes that are direct children of the spec note
    // Deduplicate by note ID to prevent double-counting
    const seenIds = new Set<string>();
    const taskNotes = notes.filter((n) => {
      if (!n.metadata?.task || isSpecNote(n.id as string)) return false;
      // Only count tasks that are direct children of the spec note
      if (!isSpecNote(n.parentId as string)) return false;
      const noteId = n.id as string;
      if (seenIds.has(noteId)) return false;
      seenIds.add(noteId);
      return true;
    });

    let total = 0;
    let completed = 0;
    let inProgress = 0;

    for (const note of taskNotes) {
      const status = note.metadata?.task?.status;
      // Skip cancelled tasks - they're abandoned and shouldn't count toward progress
      if (status === 'cancelled') {
        continue;
      }
      total++;
      if (status === 'complete') {
        completed++;
      } else if (status === 'in_progress') {
        inProgress++;
      }
    }

    return { completed, inProgress, total };
  });

  // Tree node with computed weight (leaf count)
  interface TaskTreeNode {
    note: Note;
    children: TaskTreeNode[];
    weight: number; // Number of leaf descendants (or 1 if leaf)
    isLeaf: boolean;
  }

  // Extract ordered task IDs from note content (order they appear in the markdown)
  function extractTaskOrderFromContent(content: string | undefined): string[] {
    if (!content) return [];
    const taskIds: string[] = [];
    // Use fresh regex instance to avoid lastIndex issues
    const taskLinkRegex = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');
    const matches = content.matchAll(taskLinkRegex);
    for (const match of matches) {
      const noteId = match[2];
      if (noteId && !taskIds.includes(noteId)) {
        taskIds.push(noteId);
      }
    }
    return taskIds;
  }

  // Sort notes by their order in the parent's content, falling back to peerOrder/createdAt
  function sortByContentOrder(notesToSort: Note[], parentContent: string | undefined): Note[] {
    const orderFromContent = extractTaskOrderFromContent(parentContent);
    const orderMap = new Map(orderFromContent.map((id, index) => [id, index]));

    return [...notesToSort].sort((a, b) => {
      const aId = a.id as string;
      const bId = b.id as string;
      const aOrder = orderMap.get(aId);
      const bOrder = orderMap.get(bId);

      // If both are in the content, sort by content order
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      // If only one is in the content, prioritize the one in content
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;

      // Neither in content - fall back to peerOrder then createdAt
      const aPeerOrder = a.metadata?.task?.peerOrder ?? 0;
      const bPeerOrder = b.metadata?.task?.peerOrder ?? 0;
      if (aPeerOrder !== bPeerOrder) {
        return aPeerOrder - bPeerOrder;
      }
      const aCreated = (a.createdAt || a.created_at || '') as string;
      const bCreated = (b.createdAt || b.created_at || '') as string;
      return aCreated.localeCompare(bCreated);
    });
  }

  // Build task tree from notes using parentId (for nested flame graph)
  // Only includes tasks within the spec note hierarchy
  // Orders tasks by their appearance in parent note content
  function buildTaskTree(notes: Note[]): TaskTreeNode[] {
    // Get spec note for ordering
    const specNote = notes.find((n) => isSpecNote(n.id as string));

    // First, find all task notes (excluding spec and cancelled)
    const seenIds = new Set<string>();
    const allTaskNotes = notes.filter((n) => {
      if (
        !n.metadata?.task ||
        isSpecNote(n.id as string) ||
        n.metadata.task.status === 'cancelled'
      ) {
        return false;
      }
      const noteId = n.id as string;
      if (seenIds.has(noteId)) {
        return false; // Skip duplicate
      }
      seenIds.add(noteId);
      return true;
    });

    // Find tasks that are descendants of the spec note
    // A task is in the spec hierarchy if:
    // 1. Its parentId is 'spec', OR
    // 2. Its parentId is another task that is in the spec hierarchy
    const specDescendantIds = new Set<string>();

    // First pass: find direct children of spec
    for (const note of allTaskNotes) {
      if (isSpecNote(note.parentId as string)) {
        specDescendantIds.add(note.id as string);
      }
    }

    // Subsequent passes: find children of spec descendants
    let foundNew = true;
    while (foundNew) {
      foundNew = false;
      for (const note of allTaskNotes) {
        const noteId = note.id as string;
        const parentId = note.parentId as string | undefined;
        if (!specDescendantIds.has(noteId) && parentId && specDescendantIds.has(parentId)) {
          specDescendantIds.add(noteId);
          foundNew = true;
        }
      }
    }

    // Filter to only tasks within the spec hierarchy
    const taskNotes = allTaskNotes.filter((n) => specDescendantIds.has(n.id as string));

    // Build parent -> children map
    const childrenMap = new Map<string | undefined, Note[]>();
    for (const note of taskNotes) {
      const rawParentId = note.parentId as string | undefined;
      // Normalize: spec parent → undefined (root level in flame graph)
      const parentId = rawParentId && !isSpecNote(rawParentId) ? rawParentId : undefined;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(note);
    }

    // Recursively build tree nodes with weights
    // Sort children by their order in the parent note's content
    function buildNode(note: Note): TaskTreeNode {
      const childNotes = childrenMap.get(note.id as string) || [];
      // Sort children by their order in this note's content
      const sortedChildren = sortByContentOrder(childNotes, note.content);
      const children = sortedChildren.map(buildNode);

      const isLeaf = children.length === 0;
      const weight = isLeaf ? 1 : children.reduce((sum, c) => sum + c.weight, 0);

      return { note, children, weight, isLeaf };
    }

    // Get root tasks (direct children of spec - their parentId is 'spec')
    const roots = taskNotes.filter((n) => isSpecNote(n.parentId as string));

    // Sort roots by their order in the spec note content
    const sortedRoots = sortByContentOrder(roots, specNote?.content);

    return sortedRoots.map(buildNode);
  }

  // Convert tree to rows for table rendering (flame graph style)
  interface RowCell {
    node: TaskTreeNode | null; // null for empty filler cells
    colspan: number;
  }

  function treeToRows(roots: TaskTreeNode[]): RowCell[][] {
    if (roots.length === 0) return [];

    const rows: RowCell[][] = [];

    // First row is the roots
    let currentRow: RowCell[] = roots.map((node) => ({ node, colspan: node.weight }));

    // Keep building rows until all cells are leaves or fillers
    while (currentRow.some((cell) => cell.node && !cell.node.isLeaf)) {
      rows.push(currentRow);

      const nextRow: RowCell[] = [];
      for (const cell of currentRow) {
        if (cell.node === null || cell.node.isLeaf) {
          // Filler or leaf becomes filler in next row
          nextRow.push({ node: null, colspan: cell.colspan });
        } else {
          // Expand children into this position
          for (const child of cell.node.children) {
            nextRow.push({ node: child, colspan: child.weight });
          }
        }
      }
      currentRow = nextRow;
    }

    // Add final row (all leaves or fillers)
    rows.push(currentRow);

    return rows;
  }

  // Reactive: build flame graph data
  const taskTree = $derived(buildTaskTree(notes));
  const flameRows = $derived(treeToRows(taskTree));

  // Calculate completion ratio
  const completionRatio = $derived(taskStats.total > 0 ? taskStats.completed / taskStats.total : 0);

  // Track if any agent is currently working (streaming or processing)
  let isAgentWorking = $state(false);

  // Check all active ChatService instances via ChatServiceManager to detect if ANY agent is working.
  // Uses a polling interval since services can be created/destroyed dynamically.
  // Skip in compact mode - we don't need agent working state on homepage.
  onMount(() => {
    if (!workspaceId || compact) {
      isAgentWorking = false;
      return;
    }

    const manager = ChatServiceManager.getInstance();

    const checkAgentWorking = () => {
      let anyWorking = false;
      for (const [, service] of manager.getActiveServices()) {
        const state = service.getState();
        if (state.isStreaming || state.isProcessing) {
          anyWorking = true;
          break;
        }
      }
      if (anyWorking !== isAgentWorking) {
        isAgentWorking = anyWorking;
      }
    };

    // Poll at ~1s interval — sufficient for a progress indicator
    const intervalId = setInterval(checkAgentWorking, 1000);
    // Also check immediately on mount
    checkAgentWorking();

    return () => {
      clearInterval(intervalId);
    };
  });

  // Workflow stage type for determining current state
  type WorkflowStage =
    | 'loading' // Loading git status
    | 'spec-empty' // Spec has no content and no agent working
    | 'spec-creating' // Agent working on spec
    | 'spec-ready' // Spec exists with content, no tasks
    | 'tasks-ready' // Tasks exist, none started
    | 'tasks-in-progress' // Some tasks in progress
    | 'pr-merged' // PR was merged, might have new changes
    | 'pr-approved' // PR approved, ready to merge
    | 'pr-open' // PR exists and open
    | 'commits-unpushed' // Local commits, ready to push/create PR
    | 'changes-staged' // Staged changes, ready to commit
    | 'changes-unstaged' // Unstaged changes to review
    | 'all-done'; // Nothing left to do

  // Check if spec has meaningful content
  const specHasContent = $derived.by(() => {
    if (!specNote?.content) return false;
    const trimmedContent = specNote.content.trim();
    return trimmedContent.length >= 20; // Need some actual content
  });

  // Determine current workflow stage based on git status and task progress
  const workflowStage = $derived.by<WorkflowStage>(() => {
    // Still loading git status - only show loading if we have no cached data to display
    if (gitStatusLoading && !gitStatus) {
      const activePR = workspace?.activePullRequest;
      const hasCachedPRData = activePR && (activePR.status === 'Open' || activePR.status === 'Draft' || activePR.status === 'Merged' || activePR.status === 'Closed');
      const hasTasks = taskStats.total > 0;

      if (!hasCachedPRData && !hasTasks) {
        return 'loading';
      }
      // Otherwise fall through - use cached data while git status loads
    }

    // Check for agent working first - this takes priority
    // If agent is working and no tasks yet, it's creating the spec
    if (isAgentWorking && taskStats.total === 0) {
      return 'spec-creating';
    }

    const hasUncommittedChanges = (gitStatus?.uncommittedCount ?? 0) > 0;
    const hasStagedChanges = (gitStatus?.stagedCount ?? 0) > 0;
    const hasUnpushedCommits =
      (gitStatus?.localCommits?.filter((c) => !c.isPushed).length ?? 0) > 0;
    const existingPR = gitStatus?.existingPR;

    // Check PR state - use workspace.activePullRequest as primary signal (available from cache immediately)
    // Fall back to gitStatus.existingPR for merged/closed detection
    const activePR = workspace?.activePullRequest;

    if (existingPR) {
      if (existingPR.state === 'merged') {
        // PR was merged - the workspace is complete
        // Note: Git might still show "unpushed" commits because the branch was merged via PR,
        // not directly pushed. These commits are actually already in the repo via the merge.
        // Only show new work if there are uncommitted changes (actual new work after merge)
        if (hasUncommittedChanges) {
          // New uncommitted changes after merge - fall through to check those states
        } else {
          // PR is merged, no new uncommitted work - we're done
          return 'all-done';
        }
      } else if (existingPR.state === 'closed') {
        // PR was closed without merging - still show as done for now
        return 'all-done';
      } else if (existingPR.state === 'open') {
        // Check review status from activePullRequest (enriched with GitHub data)
        if (activePR?.reviewDecision === 'APPROVED') {
          return 'pr-approved';
        }
        return 'pr-open';
      }
    } else if (activePR && (activePR.status === 'Open' || activePR.status === 'Draft')) {
      // gitStatus not loaded yet, but we have cached activePullRequest - use it
      // This prevents "Ready to start" flash when switching workspaces with an open PR
      if (activePR.reviewDecision === 'APPROVED') {
        return 'pr-approved';
      }
      return 'pr-open';
    }

    // Tasks exist but none started (must have tasks to be "tasks-ready")
    if (taskStats.total > 0 && completionRatio === 0 && taskStats.inProgress === 0) {
      return 'tasks-ready';
    }

    // Tasks in progress
    if (taskStats.inProgress > 0 || (taskStats.total > 0 && completionRatio < 1)) {
      return 'tasks-in-progress';
    }

    // Check for unpushed commits (ready to push or create PR)
    if (hasUnpushedCommits && !hasUncommittedChanges) {
      return 'commits-unpushed';
    }

    // Check for staged changes (ready to commit)
    if (hasStagedChanges) {
      return 'changes-staged';
    }

    // Check for unstaged changes
    if (hasUncommittedChanges) {
      return 'changes-unstaged';
    }

    // No git changes - check task status
    if (taskStats.total === 0) {
      // No tasks - check if spec has content
      if (specHasContent) {
        return 'spec-ready';
      }
      // Empty spec with no agent running
      return 'spec-empty';
    }

    // All tasks complete, no changes
    return 'all-done';
  });

  // Generate dynamic summary message based on workflow stage
  type SummaryMessage = {
    headline: string;
    subtext: string;
    action?: {
      label: string;
      icon?: typeof faArrowRight;
      onClick: () => void;
      tooltip?: string;
    };
  };

  const summaryMessage = $derived.by<SummaryMessage>(() => {
    const uncommittedCount = gitStatus?.uncommittedCount ?? 0;
    const stagedCount = gitStatus?.stagedCount ?? 0;
    const unpushedCommits = gitStatus?.localCommits?.filter((c) => !c.isPushed) ?? [];
    const existingPR = gitStatus?.existingPR;

    switch (workflowStage) {
      case 'loading':
        return { headline: 'Loading...', subtext: '' };

      case 'spec-empty':
        return { headline: 'Brainstorm with an agent or write the Spec.', subtext: '' };

      case 'spec-creating':
        return { headline: 'Agent working on spec.', subtext: '' };

      case 'spec-ready':
        return { headline: 'Ready to start.', subtext: '' };

      case 'tasks-ready':
        return { headline: 'Tasks ready to go.', subtext: '' };

      case 'tasks-in-progress': {
        if (completionRatio >= 0.75) {
          return {
            headline: `Almost there! ${taskStats.total - taskStats.completed} task${taskStats.total - taskStats.completed === 1 ? '' : 's'} remaining.`,
            subtext: '',
          };
        }
        if (completionRatio > 0.1) {
          return {
            headline: `Things are progressing nicely. We're ${Math.round(completionRatio * 100)}% through the work.`,
            subtext: '',
          };
        }
        return {
          headline: 'Making progress.',
          subtext:
            taskStats.completed > 0
              ? `${taskStats.completed} of ${taskStats.total} tasks done.`
              : '',
        };
      }

      case 'changes-unstaged':
        // Only show file changes summary if tasks have been worked on
        if (taskStats.completed > 0 || taskStats.inProgress > 0) {
          return {
            headline: `Review ${uncommittedCount} file change${uncommittedCount === 1 ? '' : 's'}`,
            subtext: 'Time to review the changes and push.',
            action: onAcceptChanges
              ? {
                  label: 'Review changes',
                  icon: faFileLines,
                  onClick: onAcceptChanges,
                  tooltip: 'Opens the changes panel to review, stage, and commit file changes.',
                }
              : undefined,
          };
        }
        // No tasks worked on yet - show appropriate message based on task state
        if (taskStats.total === 0) {
          return { headline: 'Ready to start.', subtext: '' };
        }
        return { headline: 'Tasks ready to go.', subtext: '' };

      case 'changes-staged':
        return {
          headline: `${stagedCount} file${stagedCount === 1 ? '' : 's'} staged. Ready to commit.`,
          subtext: '',
          action: onAcceptChanges
            ? {
                label: 'Commit',
                icon: faCheck,
                onClick: onAcceptChanges,
                tooltip: 'Opens the changes panel to commit your staged changes.',
              }
            : undefined,
        };

      case 'commits-unpushed':
        return {
          headline: `${unpushedCommits.length} commit${unpushedCommits.length === 1 ? '' : 's'} to push`,
          subtext: existingPR ? 'Push to update PR.' : 'Push to create a PR.',
          action: onAcceptChanges
            ? {
                label: existingPR ? 'Push changes' : 'Create PR',
                icon: faCodePullRequest,
                onClick: onAcceptChanges,
                tooltip: existingPR
                  ? 'Opens the changes panel to push commits to your existing PR.'
                  : 'Opens the changes panel to push commits and create a pull request.',
              }
            : undefined,
        };

      case 'pr-open': {
        const activePR = workspace?.activePullRequest;
        const parts: string[] = [];
        // Review status
        if (activePR?.reviewDecision === 'CHANGES_REQUESTED') {
          parts.push('changes requested');
        } else {
          parts.push('awaiting review');
        }
        // CI status
        if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
          if (activePR.ciStatus.failed > 0) {
            let ciPart = `${activePR.ciStatus.failed}/${activePR.ciStatus.total} checks failing`;
            if (activePR.ciStatus.pending > 0) ciPart += ` (${activePR.ciStatus.pending} running)`;
            parts.push(ciPart);
          } else if (activePR.ciStatus.pending > 0) {
            parts.push(`${activePR.ciStatus.pending}/${activePR.ciStatus.total} checks running`);
          } else {
            parts.push(`${activePR.ciStatus.passed}/${activePR.ciStatus.total} checks passing`);
          }
        }
        const statusDetails = parts.join(', ');
        const prNumber = activePR?.number ?? existingPR?.number;
        const prUrl = activePR?.url ?? existingPR?.htmlUrl;
        return {
          headline: `PR #${prNumber} open, ${statusDetails}.`,
          subtext: '',
          action: prUrl
            ? {
                label: 'View PR',
                icon: faCodeBranch,
                onClick: () => {
                  if (workspaceId) {
                    handleLink(prUrl, { workspaceId: WorkspaceId(workspaceId) });
                  }
                },
                tooltip: 'Opens the pull request on GitHub in your browser.',
              }
            : undefined,
        };
      }

      case 'pr-approved': {
        const activePR = workspace?.activePullRequest;
        let approvedBy = '';
        if (activePR?.approvedBy && activePR.approvedBy.length > 0) {
          approvedBy = ` by ${activePR.approvedBy.join(', ')}`;
        }
        let ciInfo = '';
        if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
          if (activePR.ciStatus.failed > 0) {
            ciInfo = `, ${activePR.ciStatus.failed}/${activePR.ciStatus.total} checks failing`;
          } else if (activePR.ciStatus.pending > 0) {
            ciInfo = `, ${activePR.ciStatus.pending}/${activePR.ciStatus.total} checks pending`;
          } else {
            ciInfo = `, ${activePR.ciStatus.passed}/${activePR.ciStatus.total} checks passing`;
          }
        }
        const prNumber = activePR?.number ?? existingPR?.number;
        const prUrl = activePR?.url ?? existingPR?.htmlUrl;
        return {
          headline: `PR #${prNumber} approved${approvedBy}, ready to merge${ciInfo}.`,
          subtext: '',
          action: prUrl
            ? {
                label: 'Merge PR',
                icon: faCodeBranch,
                onClick: () => {
                  if (workspaceId) {
                    handleLink(prUrl, { workspaceId: WorkspaceId(workspaceId) });
                  }
                },
                tooltip: 'Opens the pull request on GitHub to merge.',
              }
            : undefined,
        };
      }

      case 'pr-merged':
      case 'all-done':
        return { headline: 'All done!', subtext: '' };

      default:
        return { headline: 'Ready to start.', subtext: '' };
    }
  });
</script>

{#snippet sidebarSideIconSnippet()}
  <SidebarIcon
    size={12}
    side={layoutSettings.sidebarSide === 'left' ? 'right' : 'left'}
    class="mr-1.5 opacity-50"
  />
{/snippet}

{#if compact}
  <!-- Compact mode for homepage cards -->
  <button
    class="w-full flex flex-col p-3 rounded-lg bg-card hover:bg-accent/50
           transition-colors duration-150 cursor-pointer text-left"
    onclick={onClick}
  >
    <!-- Header: Title and repo -->
    <div class="w-full">
      <div class="text-sm font-semibold text-foreground truncate">
        {workspace?.title || 'Untitled'}
      </div>
      <div class="text-sm text-subtle truncate mt-0.5 flex items-center gap-1">
        <Tooltip
          side="bottom"
          align="start"
          sideOffset={4}
          contentClass="max-w-xs relative"
          bind:open={repoTooltipOpen}
          onOpenChange={handleRepoTooltipOpenChange}
          disableCloseOnTriggerClick={true}
        >
          {#snippet content()}
            <span>
              {#if workspace?.skipWorktree}
                Working directly in your repo at
                <span class="underline underline-offset-2 break-all"
                  >{workspacePath.split('/').slice(-2).join('/')}</span
                >.
              {:else}
                We have an isolated copy of your repo in the
                <span class="underline underline-offset-2">{workspace?.id || 'workspace'}/repo</span
                >
                folder.
              {/if}
              <br /><span class="text-subtle"
                >Click to copy the path, or open in an app from the <Fa
                  icon={faEllipsisV}
                  class="inline mx-0.5"
                  size="xs"
                /> menu to the right.</span
              >
            </span>
            {#if copiedRepoPath}
              <span class="absolute top-2 right-2">
                <Fa icon={faCheck} class="text-green-500" size="xs" />
              </span>
            {/if}
          {/snippet}
          <button
            type="button"
            class="cursor-pointer bg-transparent border-none p-0 text-inherit font-inherit hover:underline"
            onclick={copyRepoPath}
          >
            {#if workspace?.repositoryOwner && workspace?.repositoryName}
              {workspace.repositoryOwner}/{workspace.repositoryName}
            {:else if workspace?.repositoryPath}
              {workspace.repositoryPath.split('/').pop()}
            {/if}
          </button>
        </Tooltip>
        {#if workspace?.branch}
          <span class="mx-1">·</span>
          <span>{workspace.branch}</span>
        {/if}
      </div>
    </div>

    <!-- Flame Graph Progress Section (compact) -->
    {#if flameRows.length > 0}
      <div class="w-full mt-3">
        <FlameGraph
          {notes}
          onCellClick={(noteId) => onOpenNote?.(noteId)}
          onCellHover={(noteId) => (hoveredNoteId = noteId)}
          onSpecClick={() => onOpenNote?.('spec')}
          {hoveredNoteId}
          {hasUnreadChanges}
        />
      </div>
    {/if}

    <!-- Summary message (compact) -->
    <div class="text-xs text-subtle mt-2 leading-tight">
      {summaryMessage.headline}
    </div>
  </button>
{:else}
  <!-- Full mode for sidebar -->
  <div class="w-full flex flex-col">
    <!-- Workspace Header -->
    <div class="w-full pl-1 pb-1">
      <div class="flex items-center justify-between group">
        <div class="flex-1 flex flex-col min-w-0">
          {#if isEditingTitle}
            <input
              bind:this={titleInputRef}
              type="text"
              bind:value={editedTitle}
              onblur={saveTitle}
              onkeydown={handleTitleKeydown}
              oninput={(e) => {
                const target = e.currentTarget;
                target.style.width = `${Math.max(80, Math.min(200, target.value.length * 8 + 20))}px`;
              }}
              class="text-xl font-semibold text-foreground bg-none
               py-0.5 rounded
               outline-none min-w-20 w-full leading-normal
               focus:ring-none! focus:outline-none!
               transition-all duration-150"
              placeholder="Untitled"
            />
          {:else}
            <button
              class="text-xl font-semibold text-foreground bg-transparent
               border-none py-0.5 pr-1 rounded cursor-pointer text-left
               max-w-full overflow-hidden text-ellipsis whitespace-nowrap
               transition-all duration-150 leading-normal
               focus-visible:outline-1 focus-visible:outline-primary/50 focus-visible:-outline-offset-1
               disabled:cursor-default disabled:opacity-50 truncate min-w-0"
              class:opacity-50={!workspace?.title}
              onclick={startEditingTitle}
              title="Click to edit space title"
              disabled={!workspace}
            >
              {#if workspace}
                {workspace.title || 'Untitled'}
              {/if}
            </button>
          {/if}
        </div>

        <div class="shrink-0 -mt-0.5">
          <DropdownMenu bind:open={dropdownOpen}>
            {#snippet trigger({ toggle }: { toggle: () => void })}
              <Button
                variant="ghost-light"
                size="icon-sm"
                class="-mr-1 opacity-50 group-hover:opacity-70 hover:opacity-100! transition-opacity duration-150"
                onclick={toggle}
                disabled={isDeleting}
              >
                {#if isDeleting}
                  <div
                    class="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full"
                  ></div>
                {:else}
                  <Fa icon={faEllipsisV} size="sm" />
                {/if}
              </Button>
            {/snippet}

            {#snippet content({ close: _close }: { close: () => void })}
              <div class="w-48">
                <WorkspaceActionsMenu
                  filePath={workspace?.worktreePath ||
                    workspace?.repositoryPath ||
                    workspace?.path ||
                    ''}
                  workspaceId={workspace?.id || workspaceId || ''}
                  isDirectory={true}
                  isWorkspaceRoot={true}
                  onDelete={handleDelete}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  {isArchived}
                  onClose={handleDropdownClose}
                  showDeleteOption={true}
                  showArchiveOption={true}
                  showFileNameCopy={false}
                  showFileActions={true}
                  additionalActions={[sidebarSideAction]}
                />
              </div>
            {/snippet}
          </DropdownMenu>
        </div>
      </div>
      <!-- repo -->
      <div class="w-full flex items-center -mt-1.5 gap-1">
        <Tooltip
          side="bottom"
          align="start"
          sideOffset={4}
          contentClass="max-w-xs relative"
          bind:open={repoTooltipOpen}
          onOpenChange={handleRepoTooltipOpenChange}
          disableCloseOnTriggerClick={true}
        >
          {#snippet content()}
            <span>
              {#if workspace?.skipWorktree}
                Working directly in your repo at
                <span class="underline underline-offset-2 break-all"
                  >{workspacePath.split('/').slice(-2).join('/')}</span
                >.
              {:else}
                We have an isolated copy of your repo in the
                <span class="underline underline-offset-2">{workspace?.id || 'workspace'}/repo</span
                >
                folder.
              {/if}
              <br /><span class="text-subtle"
                >Click to copy the path, or open in an app from the <Fa
                  icon={faEllipsisV}
                  class="inline mx-0.5"
                  size="xs"
                /> menu to the right.</span
              >
            </span>
            {#if copiedRepoPath}
              <span class="absolute top-2 right-2">
                <Fa icon={faCheck} class="text-green-500" size="xs" />
              </span>
            {/if}
          {/snippet}
          <button
            type="button"
            class="flex-1 text-muted-foreground text-sm truncate text-left cursor-pointer bg-transparent border-none p-0 font-inherit hover:underline"
            onclick={copyRepoPath}
          >
            {#if workspace?.repositoryOwner && workspace?.repositoryName}
              {workspace.repositoryOwner}/{workspace.repositoryName}
            {:else if workspace?.repositoryPath}
              {workspace.repositoryPath.split('/').pop()}
            {/if}
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="w-full pb-2 pl-1 text-left flex flex-col gap-1.5">
      <!-- Flame Graph Progress Section (always show task-focused view) -->
      {#if flameRows.length > 0}
        <div class="flex-1 shrink-0 flex mt-1" transition:slide={{ axis: 'y', duration: 200 }}>
          <FlameGraph
            {notes}
            onCellClick={(noteId) => onOpenNote?.(noteId)}
            onCellHover={(noteId) => (hoveredNoteId = noteId)}
            onSpecClick={() => onOpenNote?.('spec')}
            {hoveredNoteId}
            {hasUnreadChanges}
          />
        </div>
        <!-- Summary Section -->
        {#if notes.length > 0 || workflowStage !== 'loading'}
          <div class="flex-1 w-full" transition:slide={{ axis: 'y', duration: 200 }}>
            <div class="group w-full p-0 bg-transparent border-none text-left">
              <div class="w-full flex flex-1">
                <div
                  class="text-xs text-subtle leading-tight transition-colors duration-150"
                >
                  {summaryMessage.headline}
                </div>
              </div>
            </div>

            <!-- Workflow action button (styled like AI-assisted action prompts) -->
            {#if summaryMessage.action}
              <div class="mt-1">
                <Tooltip
                  content={summaryMessage.action.tooltip}
                  side="bottom"
                  align="start"
                  disabled={!summaryMessage.action.tooltip}
                >
                  <Button
                    variant="ghost-light"
                    size="xs"
                    class="w-full text-left justify-start px-0! -mb-1"
                    onclick={summaryMessage.action.onClick}
                  >
                    {#if summaryMessage.action.icon}
                      <Fa icon={summaryMessage.action.icon} size="xs" class="ml-1" />
                    {/if}
                    <span class="underline decoration-dotted underline-offset-2"
                      >{summaryMessage.action.label}</span
                    >
                  </Button>
                </Tooltip>
              </div>
            {/if}

            <!-- Contextual Action Prompts (AI-assisted actions) -->
            <!-- {#if onCreateAgentWithPrompt && (hasContentNoTasks || hasIdleTasks)}
          <div class="mt-1">
            {#if hasContentNoTasks}
              <Tooltip
                content="Creates an agent with a prompt to generate tasks from the spec. You can review and edit the prompt before sending."
                side="bottom"
                align="start"
              >
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="w-full text-left justify-start px-0! -mb-1"
                  onclick={() =>
                    onCreateAgentWithPrompt(
                      'Read through the spec and add a few tasks that are easy to delegate. Create focused, actionable task notes that can be assigned to other agents.',
                      'Task Planner',
                    )}
                >
                  <Fa icon={faWandMagicSparkles} size="xs" class="ml-1" />
                  <span class="underline decoration-dotted underline-offset-2"
                    >Generate tasks from spec</span
                  >
                </Button>
              </Tooltip>
            {:else if hasIdleTasks}
              <Tooltip
                content="Creates an agent with a prompt to delegate tasks. You can review and edit the prompt before sending."
                side="bottom"
                align="start"
              >
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="w-full text-left justify-start px-0! -mb-1"
                  onclick={() =>
                    onCreateAgentWithPrompt(
                      'Delegate the tasks in this workspace, running them in parallel when sensible. Assign agents to work on tasks that are ready to start.',
                      'Task Delegator',
                    )}
                >
                  <Fa icon={faWandMagicSparkles} size="xs" class="ml-1" />
                  <span class="underline decoration-dotted underline-offset-2">Delegate tasks</span>
                </Button>
              </Tooltip>
            {/if}
          </div>
        {/if} -->
          </div>
        {/if}
      {/if}

      <!-- Ready Tasks Section (excludes spec from display) -->
      <!-- {#if isLoadingReadyTasks}
    <div
      class="w-full px-4x pb-3 flex items-center gap-2 text-xs text-subtle"
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      <Fa icon={faSpinner} spin size="xs" />
      <span>Finding ready tasks...</span>
    </div>
  {:else if displayReadyTasks.length > 0 && currentDisplayReadyTask}
    <div class="w-full px-4x pb-3" transition:slide={{ axis: 'y', duration: 200 }}>
      <div class="flex items-center justify-between text-xs text-subtle">
        <span>{displayReadyTasks.length} ready task{displayReadyTasks.length > 1 ? 's' : ''}:</span>
        {#if displayReadyTasks.length > 1}
          <span class="flex items-center gap-1">
            <button
              class="p-0.5 hover:bg-muted rounded transition-colors text-ghost cursor-pointer"
              onclick={navigatePrev}
              disabled={displayReadyTasks.length <= 1}
              title="Previous ready task"
            >
              <Fa icon={faChevronLeft} size="xs" />
            </button>
            <button
              class="p-0.5 hover:bg-muted rounded transition-colors text-ghost cursor-pointer"
              onclick={navigateNext}
              disabled={displayReadyTasks.length <= 1}
              title="Next ready task"
            >
              <Fa icon={faChevronRight} size="xs" />
            </button>
          </span>
        {/if}
      </div>
      <button
        class="flex items-center gap-2 w-full text-left text-sm text-subtle transition-colors py-1 rounded cursor-pointer"
        onclick={() => onOpenNote?.(currentDisplayReadyTask.id as string)}
        onmouseenter={() => (highlightedNoteId = currentDisplayReadyTask.id as string)}
        onmouseleave={() => (highlightedNoteId = null)}
      >
        <span class="flex-1 truncate text-xs">{currentDisplayReadyTask.title}</span>
        <Fa icon={faArrowRight} size="xs" class="text-ghost" />
      </button>
    </div>
  {:else if readyTasksError}
    <div
      class="w-full px-4x pb-3 text-xs text-destructive-foreground mt-2"
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      Error: {readyTasksError}
    </div>
  {/if} -->
    </div>

    <!-- Hover Card for task segments -->
    {#if hoveredNoteId}
      {@const hoveredNote = notes.find((n) => n.id === hoveredNoteId)}
      {#if hoveredNote}
        {@const taskStatus = hoveredNote.metadata?.task?.status ?? 'not_started'}
        {@const assignedAgentIds = hoveredNote.metadata?.task?.assignedAgentIds}
        {@const latestAgentId = assignedAgentIds?.length
          ? assignedAgentIds[assignedAgentIds.length - 1]
          : null}
        <HoverCard anchor="--task-{hoveredNoteId}" position="bottom-right">
          <div class="p-3 flex flex-col gap-2">
            <!-- Task title -->
            <div class="text-sm font-medium text-foreground leading-tight line-clamp-3">
              {hoveredNote.title}
            </div>

            <!-- Status badge -->
            <div class="flex items-center">
              <TaskStatusIndicator status={taskStatus} readonly compact />
            </div>

            <!-- Agent row (if assigned) -->
            {#if latestAgentId}
              <div class="border-t border-border pt-2 mt-1">
                <TaskAgentStatus agentId={latestAgentId} compact />
              </div>
            {/if}
          </div>
        </HoverCard>
      {/if}
    {/if}
  </div>
{/if}

<!-- Delete Warning Dialog -->
<DeleteWarningDialog
  bind:open={showDeleteWarning}
  agentNames={runningAgentNamesForDelete}
  onDeleteAnyway={async () => {
    if (pendingDeleteWorkspace) {
      await performDelete();
      pendingDeleteWorkspace = null;
    }
  }}
  onCancel={() => {
    pendingDeleteWorkspace = null;
  }}
/>
