<script lang="ts">
  import type { Note, TaskStatus } from '$shared/types';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { cn } from '$lib/utils';
  import {
    getNoteIcon,
    getNoteTitle,
    sortNotes,
    isChildNote,
    isSpecNote,
    loadNoteOrder,
    saveNoteOrder,
    getChildNotes,
    getNoteDepth,
    isHiddenByAnyCollapsedAncestor,
    parseTaskStats,
    getNoteIconClass,
  } from './utils';
  import {
    faChevronDown,
    faPlus,
    faArrowUpRightFromSquare,
    faPencil,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { selectUnreadNoteIds } from '$lib/store/slices/note-read-tracking/note-read-tracking-selectors';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import {
    type AvatarState,
    getAvatarState,
    isAgentActivelyWorking,
  } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { AgentStatus } from '$shared/types/agent.types';
  import {
    WorkspaceId as WorkspaceIdFn,
    NoteId,
    type WorkspaceId,
  } from '$shared/types/branded-ids';
  import { onMount, tick } from 'svelte';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { notesClient } from '$features/notes/notes.client';
  import { getPanelLayoutManager, hasPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('NotesPanel');

  interface Props {
    notes: Note[];
    workspaceId: string;
    selectedNoteId?: string | null;
    onOpenNote?: (noteId: string) => void;
    onOpenAgent?: (agentId: string) => void;
    onReorderNotes?: (noteIds: string[]) => void;
    onCreateNote?: () => void;
    loading?: boolean;
    class?: string;
    indentSize?: number; // Size of each indent level in px (default: 22)
  }

  let {
    notes = [],
    workspaceId,
    selectedNoteId = null,
    onOpenNote,
    onOpenAgent,
    onReorderNotes,
    onCreateNote,
    loading = false,
    class: className,
    indentSize = 22,
  }: Props = $props();

  // Inline editing state
  let editingNoteId: string | null = $state(null);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Context menu state
  let contextMenu: { x: number; y: number; note: Note } | null = $state(null);

  // Start editing a note title
  async function startEditing(noteId: string, currentTitle: string) {
    editingNoteId = noteId;
    editingValue = currentTitle;
    await tick();
    editInputRef?.focus();
    editInputRef?.select();
  }

  // Save the edited title
  function saveEdit() {
    if (editingNoteId && editingValue.trim()) {
      const trimmed = editingValue.trim();
      const note = notes.find((n) => n.id === editingNoteId);
      if (note && trimmed !== getNoteTitle(note)) {
        notesStateManager.updateNoteTitle(editingNoteId as NoteId, trimmed);
      }
    }
    cancelEdit();
  }

  // Cancel editing
  function cancelEdit() {
    editingNoteId = null;
    editingValue = '';
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

  // Handle double-click on note title
  function handleDoubleClick(note: Note, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Don't allow editing spec notes
    if (isSpecNote(note.id)) return;
    startEditing(note.id, getNoteTitle(note));
  }

  // Context menu handlers
  function handleContextMenu(e: MouseEvent, note: Note) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, note };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function getContextMenuItems(note: Note): SidebarMenuEntry[] {
    const isSpec = isSpecNote(note.id);
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: 'Open',
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          onOpenNote?.(note.id);
          closeContextMenu();
        },
      },
    ];

    // Only allow rename and delete for non-spec notes
    if (!isSpec) {
      items.push({
        id: 'rename',
        label: 'Rename',
        icon: faPencil,
        onClick: () => {
          startEditing(note.id, getNoteTitle(note));
          closeContextMenu();
        },
      });
      items.push({ type: 'separator' });
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: faTrash,
        destructive: true,
        onClick: async () => {
          const savedNote = { ...note };
          const noteTitle = getNoteTitle(note);

          // Close related panel tabs before deleting
          if (hasPanelLayoutManager(workspaceId)) {
            const layoutManager = getPanelLayoutManager(workspaceId);
            layoutManager.closeTabsMatching((tab) => tab.type === 'note' && tab.noteId === note.id);
          }

          const result = await notesClient.delete(note.id as NoteId, workspaceId as WorkspaceId);
          closeContextMenu();

          if (result.ok) {
            const toastId = toast.warning(
              `Deleted "${noteTitle}"`,
              {
                duration: 15000,
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    try {
                      const result = await notesClient.create({
                        workspaceId: savedNote.workspaceId,
                        title: savedNote.title,
                        content: savedNote.content,
                        contentType: savedNote.contentType,
                        tags: savedNote.tags,
                        parentId: savedNote.parentId,
                        visibility: savedNote.visibility,
                      });
                      if (result.ok) {
                        toast.dismiss(toastId);
                      } else {
                        logger.error('Failed to restore note', result.error);
                        toast.error('Failed to restore note');
                      }
                    } catch (err) {
                      logger.error('Failed to restore note', err);
                      toast.error('Failed to restore note');
                    }
                  },
                },
              },
            );
          }
        },
      });
    }

    return items;
  }

  // Drag and drop state
  let draggedNoteId: string | null = $state(null);
  let dragOverNoteId: string | null = $state(null);

  // Collapsed notes state (persisted in localStorage)
  let collapsedNoteIds: Set<string> = $state(new Set());

  // Note order state (persisted in localStorage)
  let customNoteOrder: string[] = $state([]);

  // Load custom order and collapsed state from localStorage on mount
  $effect(() => {
    if (workspaceId) {
      customNoteOrder = loadNoteOrder(workspaceId);
      // Load collapsed state
      const storedCollapsed = localStorage.getItem(`workspace-collapsed-notes-${workspaceId}`);
      if (storedCollapsed) {
        try {
          collapsedNoteIds = new Set(JSON.parse(storedCollapsed));
        } catch {
          collapsedNoteIds = new Set();
        }
      }
    }
  });

  // Helper to toggle collapse state
  function toggleCollapse(noteId: string, e: MouseEvent) {
    e.stopPropagation();
    const newCollapsed = new Set(collapsedNoteIds);
    if (newCollapsed.has(noteId)) {
      newCollapsed.delete(noteId);
    } else {
      newCollapsed.add(noteId);
    }
    collapsedNoteIds = newCollapsed;
    // Persist to localStorage
    localStorage.setItem(
      `workspace-collapsed-notes-${workspaceId}`,
      JSON.stringify([...newCollapsed]),
    );
  }

  // Check if a note should be hidden (any ancestor is collapsed)
  function isHiddenByCollapsedParent(note: Note): boolean {
    if (!isChildNote(note, notes)) return false;
    return isHiddenByAnyCollapsedAncestor(note, notes, collapsedNoteIds);
  }

  // Sorted notes
  const sortedNotes = $derived(sortNotes(notes, customNoteOrder));

  // Check if a note has unread changes (reactive via store subscription)
  // NOTE: The refresh is triggered by the parent component (WorkspaceDetailSidebar)
  // to avoid duplicate IPC calls from multiple components.
  const unreadNoteIds = selectUnreadNoteIds();

  // Helper to check if a note can be dragged (only top-level non-spec notes)
  function canDrag(note: Note): boolean {
    return !isSpecNote(note.id) && !isChildNote(note, notes);
  }

  // Helper to check if a note can be a drop target (only top-level non-spec notes)
  function canBeDropTarget(note: Note): boolean {
    return !isSpecNote(note.id) && !isChildNote(note, notes);
  }

  // Drag and drop handlers
  function handleDragStart(e: DragEvent, note: Note) {
    if (!canDrag(note)) {
      e.preventDefault();
      return;
    }
    draggedNoteId = note.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', note.id);
    }
  }

  function handleDragOver(e: DragEvent, note: Note) {
    e.preventDefault();
    if (draggedNoteId && draggedNoteId !== note.id && canBeDropTarget(note)) {
      dragOverNoteId = note.id;
    }
  }

  function handleDragLeave() {
    dragOverNoteId = null;
  }

  function handleDrop(e: DragEvent, targetNote: Note) {
    e.preventDefault();
    if (!draggedNoteId || draggedNoteId === targetNote.id || !canBeDropTarget(targetNote)) {
      draggedNoteId = null;
      dragOverNoteId = null;
      return;
    }

    const currentOrder = sortedNotes.map((n) => n.id as string);
    const draggedIndex = currentOrder.indexOf(draggedNoteId);
    const targetIndex = currentOrder.indexOf(targetNote.id as string);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      currentOrder.splice(draggedIndex, 1);
      const insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
      currentOrder.splice(insertIndex, 0, draggedNoteId);

      customNoteOrder = currentOrder;
      saveNoteOrder(workspaceId, currentOrder);
      onReorderNotes?.(currentOrder);
    }

    draggedNoteId = null;
    dragOverNoteId = null;
  }

  function handleDragEnd() {
    draggedNoteId = null;
    dragOverNoteId = null;
  }

  // Reactive trigger for streaming state changes
  // This counter increments whenever any agent's streaming state changes
  let streamingStateVersion = $state(0);

  // Subscribe to streaming state changes from unified state store
  onMount(() => {
    const unsubscribe = unifiedStateStore.onStreamingChange(() => {
      // Increment version to trigger reactivity
      streamingStateVersion++;
    });

    return () => {
      unsubscribe();
    };
  });

  // Get active agents working on a note
  function getActiveAgentsForNote(note: Note): Array<{
    agentId: string;
    state: AvatarState;
    onClick: () => void;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
  }> {
    // Access streamingStateVersion to ensure reactivity
    void streamingStateVersion;

    const assignedAgentIds = note.metadata?.task?.assignedAgentIds || [];
    if (assignedAgentIds.length === 0) return [];

    const workspace = unifiedStateStore.getWorkspace(WorkspaceIdFn(workspaceId));
    if (!workspace) return [];

    const activeAgents: Array<{
      agentId: string;
      state: AvatarState;
      onClick: () => void;
      specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
    }> = [];

    for (const agentId of assignedAgentIds) {
      const agentState = workspace.agents.get(agentId);
      if (!agentState) continue;

      const agent = agentState.session;
      const isStreaming = agentState.streaming?.active ?? false;

      // Only show agents that are ACTIVELY working right now
      // Use centralized helper to check if agent is working
      const activelyWorking = isAgentActivelyWorking({
        isStreaming,
        isProcessing: agent.status === AgentStatus.Processing,
        isResponding: agent.isResponding,
      });

      if (!activelyWorking) continue;

      // Use centralized getAvatarState for consistent state calculation
      const state = getAvatarState(
        {
          isStreaming,
          isProcessing: agent.isProcessing,
          isResponding: agent.isResponding,
          status: agent.status,
        },
        {},
      );

      // Get specialist from agent metadata
      const specialistId = agent.metadata?.specialist || agent.agentMetadata?.specialist;
      const specialist =
        specialistId === 'spec-writer' ||
        specialistId === 'implementor' ||
        specialistId === 'verifier'
          ? specialistId
          : null;

      activeAgents.push({
        agentId,
        state,
        onClick: () => openAgent(agentId),
        specialist,
      });
    }

    return activeAgents;
  }

  // Open agent in drawer
  function openAgent(agentId: string) {
    if (onOpenAgent) {
      onOpenAgent(agentId);
    }
  }
</script>

<div class={cn('w-full flex flex-col', className)}>
  {#if onCreateNote}
    <button
      onclick={onCreateNote}
      class="-mt-1 mb-2 text-muted-foreground hover:text-foreground p-1 cursor-pointer transition-colors flex items-center gap-1 text-xs"
      title="New note"
    >
      <Fa icon={faPlus} size="xs" />
      <span>Attach more context</span>
    </button>
  {/if}

  {#if loading}
    <!-- Skeleton loader while notes are loading -->
    <div class="space-y-1 py-1">
      {#each [65, 80, 55, 70] as width}
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="h-3.5 w-3.5 rounded flex-shrink-0" />
          <Skeleton class="h-3" style="width: {width}%;" />
        </div>
      {/each}
    </div>
  {:else}
    <ListContainer class="w-full">
      {#each sortedNotes as note (note.id)}
        {@const depth = getNoteDepth(note, notes)}
        {@const childNotes = getChildNotes(note, notes)}
        {@const hasChildren = childNotes.length > 0}
        {@const isCollapsed = collapsedNoteIds.has(note.id as string)}
        {@const isHidden = isHiddenByCollapsedParent(note)}
        {@const isDraggable = canDrag(note)}
        {@const isDragging = draggedNoteId === note.id}
        {@const isDragOver = dragOverNoteId === note.id}
        {@const taskStats = parseTaskStats(note.content, notes)}
        {@const hasTasks = taskStats.total > 0}
        {@const areChildrenFinished =
          hasChildren && childNotes.every((n) => n.metadata?.task?.status === 'complete')}
        {@const areChildrenNotStarted =
          hasChildren && childNotes.every((n) => n.metadata?.task?.status === 'not_started')}
        {@const areChildrenInProgress =
          hasChildren && !areChildrenNotStarted && !areChildrenFinished}
        {@const hasChildrenStatus = areChildrenFinished
          ? 'complete'
          : areChildrenInProgress
            ? 'in_progress'
            : areChildrenNotStarted
              ? 'not_started'
              : undefined}
        {@const isUnread = $unreadNoteIds.includes(note.id as string)}
        {#if !isHidden}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            role="listitem"
            data-note-id={note.id}
            draggable={isDraggable}
            ondragstart={(e) => handleDragStart(e, note)}
            ondragover={(e) => handleDragOver(e, note)}
            ondragleave={handleDragLeave}
            ondrop={(e) => handleDrop(e, note)}
            ondragend={handleDragEnd}
            ondblclick={(e) => handleDoubleClick(note, e)}
            oncontextmenu={(e) => handleContextMenu(e, note)}
            class={cn(
              'w-full transition-all duration-150 flex items-center group/note min-w-0',
              isDragging && 'opacity-50',
              isDragOver && 'border-t-2 border-accent',
            )}
          >
            {#if editingNoteId === note.id}
              <!-- Inline edit mode - matches ListItem sm size styling with active state -->
              {@const leftIndent = depth * Math.round(indentSize * 16 / 22)}
              <div
                class="flex items-center gap-2 py-0.5 px-2 rounded-md border border-border shadow-xs bg-background text-foreground"
                style="margin-left: {leftIndent}px; width: calc(100% - {leftIndent}px);"
              >
                {#if note?.metadata?.task?.status}
                  <TaskStatusIcon
                    status={hasChildrenStatus || (note.metadata!.task!.status as TaskStatus)}
                    size={14}
                  />
                {:else if hasTasks}
                  {@const size = 14}
                  {@const strokeWidth = 2.5}
                  {@const radius = (size - strokeWidth) / 2}
                  {@const circumference = 2 * Math.PI * radius}
                  {@const completedPctNorm = taskStats.completed / taskStats.total}
                  {@const completedOffset = circumference * (1 - completedPctNorm)}
                  <svg width={size} height={size} class="transform -rotate-90 shrink-0">
                    <circle
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      stroke-width={strokeWidth}
                      class="text-ghost"
                    />
                    {#if taskStats.completed > 0}
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="currentColor"
                        stroke-width={strokeWidth}
                        stroke-dasharray={circumference}
                        stroke-dashoffset={completedOffset}
                        stroke-linecap="round"
                        class="text-emerald-500"
                      />
                    {/if}
                  </svg>
                {:else}
                  <Fa icon={getNoteIcon(note)} class={cn('w-3.5 h-3.5', getNoteIconClass(note))} />
                {/if}
                <input
                  bind:this={editInputRef}
                  type="text"
                  bind:value={editingValue}
                  onblur={saveEdit}
                  onkeydown={handleEditKeydown}
                  class="flex-1 text-sm bg-transparent border-none outline-none ring-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none min-w-0"
                  onclick={(e) => e.stopPropagation()}
                />
              </div>
            {:else if note?.metadata?.task?.status}
              <!-- Task note with status - show TaskStatusIcon -->
              {@const activeAgents = getActiveAgentsForNote(note)}
              <div class="relative flex-1 w-full flex items-center gap-1">
                <ListItem
                  iconClass="text-ghost"
                  title={getNoteTitle(note)}
                  active={selectedNoteId === note.id}
                  indent={depth}
                  {indentSize}
                  badge={isCollapsed && hasChildren ? childNotes.length : undefined}
                  badgeClass="text-ui px-1 py-0"
                  onclick={() => onOpenNote?.(note.id)}
                  class="cursor-pointer flex-1"
                >
                  {#snippet iconSnippet()}
                    <TaskStatusIcon
                      status={hasChildrenStatus || (note.metadata!.task!.status as TaskStatus)}
                      size={14}
                    />
                  {/snippet}
                  {#if isUnread}
                    <span
                      class="absolute top-0 -left-1 w-1.5 h-1.5 bg-background border border-muted-foreground/50 rounded-full"
                      title="Has unread changes"
                    ></span>
                  {/if}
                </ListItem>

                <!-- Show active agents working on this note -->
                {#if activeAgents.length > 0}
                  <div class="flex items-center gap-0.5 pr-1 -space-x-1">
                    {#each activeAgents.slice(0, 3) as { agentId, state, onClick, specialist } (agentId)}
                      <button
                        type="button"
                        class="cursor-pointer hover:opacity-80 transition-opacity"
                        onclick={onClick}
                        title="Click to open agent"
                      >
                        <AugieAvatarWithState {agentId} size={16} {state} {specialist} />
                      </button>
                    {/each}
                    {#if activeAgents.length > 3}
                      <div class="text-ui text-subtle ml-1">
                        +{activeAgents.length - 3}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else if hasTasks}
              <!-- Note with task checkboxes (not a task note) - show progress ring -->
              {@const size = 14}
              {@const strokeWidth = 2.5}
              {@const radius = (size - strokeWidth) / 2}
              {@const circumference = 2 * Math.PI * radius}
              {@const completedPctNorm = taskStats.completed / taskStats.total}
              {@const inProgressPctNorm = taskStats.inProgress / taskStats.total}
              {@const completedOffset = circumference * (1 - completedPctNorm)}
              {@const inProgressOffset = circumference * (1 - inProgressPctNorm)}
              <div class="relative flex-1 w-full flex">
                <ListItem
                  iconClass="text-ghost"
                  title={getNoteTitle(note)}
                  active={selectedNoteId === note.id}
                  indent={depth}
                  {indentSize}
                  badge={isCollapsed && hasChildren ? childNotes.length : undefined}
                  badgeClass="text-ui px-1 py-0"
                  onclick={() => onOpenNote?.(note.id)}
                  class="cursor-pointer"
                >
                  {#snippet iconSnippet()}
                    <div
                      title="{taskStats.completed}/{taskStats.total} complete{taskStats.inProgress >
                      0
                        ? `, ${taskStats.inProgress} in progress`
                        : ''}"
                    >
                      <svg width={size} height={size} class="transform -rotate-90">
                        <!-- Background ring -->
                        <circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          stroke-width={strokeWidth}
                          class="text-ghost"
                        />
                        <!-- In progress arc -->
                        {#if taskStats.inProgress > 0}
                          <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            stroke-width={strokeWidth}
                            stroke-dasharray={circumference}
                            stroke-dashoffset={inProgressOffset}
                            stroke-linecap="round"
                            class="text-primary"
                            style="transform-origin: center; transform: rotate({completedPctNorm *
                              360}deg);"
                          />
                        {/if}
                        <!-- Completed arc -->
                        {#if taskStats.completed > 0}
                          <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            stroke-width={strokeWidth}
                            stroke-dasharray={circumference}
                            stroke-dashoffset={completedOffset}
                            stroke-linecap="round"
                            class="text-emerald-500"
                          />
                        {/if}
                      </svg>
                    </div>
                  {/snippet}
                  {#if isUnread}
                    <span
                      class="absolute top-0 -left-1 w-1.5 h-1.5 bg-background border border-muted-foreground/50 rounded-full"
                      title="Has unread changes"
                    ></span>
                  {/if}
                </ListItem>
              </div>
            {:else}
              {@const activeAgents = getActiveAgentsForNote(note)}
              <div class="relative flex-1 w-full flex items-center gap-1">
                <ListItem
                  icon={getNoteIcon(note)}
                  iconClass={getNoteIconClass(note)}
                  title={getNoteTitle(note)}
                  active={selectedNoteId === note.id}
                  indent={depth}
                  {indentSize}
                  badge={isCollapsed && hasChildren ? childNotes.length : undefined}
                  badgeClass="text-ui px-1 py-0"
                  onclick={() => onOpenNote?.(note.id)}
                  class="cursor-pointer flex-1"
                >
                  {#if isUnread}
                    <span
                      class="absolute top-0 -left-1 w-1.5 h-1.5 bg-background border border-muted-foreground/50 rounded-full"
                      title="Has unread changes"
                    ></span>
                  {/if}
                </ListItem>

                <!-- Show active agents working on this note -->
                {#if activeAgents.length > 0}
                  <div class="flex items-center gap-0.5 pr-1 -space-x-1">
                    {#each activeAgents.slice(0, 3) as { agentId, state, onClick, specialist } (agentId)}
                      <button
                        type="button"
                        class="cursor-pointer hover:opacity-80 transition-opacity"
                        onclick={onClick}
                        title="Click to open agent"
                      >
                        <AugieAvatarWithState {agentId} size={16} {state} {specialist} />
                      </button>
                    {/each}
                    {#if activeAgents.length > 3}
                      <div class="text-ui text-subtle ml-1">
                        +{activeAgents.length - 3}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
            {#if hasChildren}
              <button
                type="button"
                class="shrink-0 p-1 mr-1 text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer opacity-0 group-hover/note:opacity-100"
                onclick={(e) => toggleCollapse(note.id as string, e)}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <div
                  class="transition-transform duration-150 ease-out"
                  class:rotate-90={isCollapsed}
                >
                  <Fa icon={faChevronDown} size="10" />
                </div>
              </button>
            {/if}
          </div>
        {/if}
      {/each}
    </ListContainer>
  {/if}
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={getContextMenuItems(contextMenu.note)}
    onClickOutside={closeContextMenu}
  />
{/if}
