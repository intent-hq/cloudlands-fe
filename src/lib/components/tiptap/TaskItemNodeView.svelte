<!--
  TaskItemNodeView - Svelte component for rendering task items in TipTap

  Supports two modes:
  1. Normal mode: Regular checkbox with 3-state toggle (todo → in-progress → done)
  2. Linked task mode: When content contains a intent://local/task/{noteId} link,
     displays the Task Note's title and status, with checkbox syncing to the Task Note.
-->
<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import { NodeViewWrapper, NodeViewContent } from '$lib/utils/tiptap/svelte-node-view';
  import TaskAgentStatus from './TaskAgentStatus.svelte';
  import TaskRelationLink from '$lib/components/workspace/TaskRelationLink.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToNote } from '$lib/utils/workspace-navigation';
  import Fa from 'svelte-fa';
  import {
    faPlay,
    faLinkSlash,
    faListCheck,
    faHourglass,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { taskNoteUrl } from '$shared/constants/intent-links';
  import {
    selectSelectedNoteId,
    selectNoteById,
    selectWorkspaceNotesState,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';

  import {
    updateTaskNoteStatus,
    createPrerequisiteTask,
  } from '$features/tasks/tasks-write-service';
  import { delegateExistingTaskRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { writable } from 'svelte/store';
  import type { NoteId, TaskStatus } from '$shared/types';
  import TaskStatusIcon from './TaskStatusIcon.svelte';
  import { toPromptToken } from '$lib/services/mentions/format';
  import Checkbox from '../ui/checkbox/checkbox.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';

  const logger = createLogger('TaskItemNodeView');
  const TASK_LINK_REGEX = /^intent:\/\/local\/task\/(.+)$/;

  let { node, selected, updateAttributes, getPos, editor, extension }: NodeViewProps = $props();

  // Note editors configure an immutable owner on their task-item extension. Route
  // context is the explicit fallback for non-note editor callers.
  let owningWorkspaceId = $derived(extension?.options?.workspaceId as string | undefined);
  const routeWorkspaceId = getWorkspaceRouteContext()?.workspaceId;
  const wsIdStore = writable<string>('');
  $effect(() => {
    wsIdStore.set(owningWorkspaceId ?? routeWorkspaceId ?? '');
  });
  let workspaceId = $derived(owningWorkspaceId ?? routeWorkspaceId ?? '');

  // Core derived state
  let checked = $derived(node.attrs.checked ?? false);
  let status = $derived(node.attrs.status ?? 'todo');
  let delegatedAgentId = $derived(node.attrs.delegatedAgentId ?? null);

  // Extract linked task note ID from node content
  let linkedTaskNoteId = $derived.by(() => {
    let noteId: string | null = null;
    node.content.forEach((child: any) => {
      if (child.content) {
        child.content.forEach((grandchild: any) => {
          if (grandchild.isText && grandchild.marks) {
            for (const mark of grandchild.marks) {
              if (mark.type.name === 'link' && mark.attrs?.href) {
                const match = mark.attrs.href.match(TASK_LINK_REGEX);
                if (match) {
                  noteId = match[1];
                  return;
                }
              }
            }
          }
        });
      }
    });
    return noteId as NoteId | null;
  });

  let isLinkedTask = $derived(!!linkedTaskNoteId);
  const linkedTaskNoteIdStore = writable<NoteId | null>(null);
  $effect(() => {
    linkedTaskNoteIdStore.set(linkedTaskNoteId);
  });
  const linkedTaskNoteStore = selectNoteById(wsIdStore, linkedTaskNoteIdStore);
  const workspaceNotesStateStore = selectWorkspaceNotesState(wsIdStore);
  let linkedTaskNote = $derived($linkedTaskNoteStore ?? null);

  let linkedTaskTitle = $derived(
    linkedTaskNote?.title ??
      (!$workspaceNotesStateStore.initialized
        ? m.tiptap_taskNotePreview_loading_label()
        : m.tiptap_taskItem_taskNotFound_label({
            id: linkedTaskNoteId ?? m.tiptap_taskItem_unknownId_label(),
          })),
  );
  let linkedTaskStatus = $derived(linkedTaskNote?.metadata?.task?.status ?? null);
  let linkedTaskNotFound = $derived(
    isLinkedTask && $workspaceNotesStateStore.initialized && !linkedTaskNote,
  );
  let linkedTaskChecked = $derived(linkedTaskStatus === 'complete');

  let linkedTaskAgentId = $derived.by(() => {
    const agentIds = linkedTaskNote?.metadata?.task?.assignedAgentIds;
    if (!agentIds || agentIds.length === 0) return null;
    return agentIds[agentIds.length - 1];
  });

  // Task relations (PROTOCOL §5.2/§5.4, v6.8). `unmetDependsOn` is the
  // daemon-computed projection carried on note-shaped read/push payloads
  // (monorepo#1979) — a dep is unmet unless its task note is `complete`
  // (missing and cancelled deps count as unmet). A dependency status change
  // re-announces each dependent note via `note:updated`, so the refreshed
  // projection lands in the notes slice without any client-side derivation.
  let linkedTaskConflictsWith = $derived(linkedTaskNote?.metadata?.task?.conflictsWith ?? []);
  let unmetDependsOn = $derived(linkedTaskNote?.metadata?.task?.unmetDependsOn ?? []);

  // Computed display values
  let effectiveAgentId = $derived(isLinkedTask ? linkedTaskAgentId : delegatedAgentId);
  let effectiveChecked = $derived(isLinkedTask ? linkedTaskChecked : checked);
  let effectiveStatus = $derived(isLinkedTask ? (linkedTaskStatus ?? 'not_started') : status);
  let isCardLayout = $derived(isLinkedTask || !!effectiveAgentId);
  let isOptimistic = $derived(!isLinkedTask && !!effectiveAgentId);
  let displayStatus = $derived(
    isLinkedTask
      ? effectiveStatus
      : status === 'done'
        ? 'complete'
        : status === 'in-progress'
          ? 'in_progress'
          : 'not_started',
  );

  function handleNormalCheckboxClick(newChecked: boolean) {
    if (newChecked === checked) return;
    if (newChecked) {
      updateAttributes({ checked: newChecked, status: 'in-progress', delegatedAgentId });
      return;
    }
    updateAttributes({ checked: newChecked, status: 'todo', delegatedAgentId });
  }

  function handleLinkedTaskCheckboxClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTaskNoteId || linkedTaskNotFound) return;

    let newStatus: TaskStatus;
    if (linkedTaskStatus === 'complete') {
      newStatus = 'not_started';
    } else if (linkedTaskStatus === 'in_progress' || linkedTaskStatus === 'review_required') {
      newStatus = 'complete';
    } else {
      newStatus = 'in_progress';
    }

    try {
      if (!workspaceId) return;
      void updateTaskNoteStatus(workspaceId, linkedTaskNoteId, newStatus);
    } catch (error) {
      logger.error('Failed to update linked task status', error);
    }
  }

  function handleCheckboxClick(event: MouseEvent) {
    if (isLinkedTask) {
      handleLinkedTaskCheckboxClick(event);
    } else {
      handleNormalCheckboxClick(!checked);
    }
  }

  async function handleOpenLinkedNote(event?: MouseEvent | KeyboardEvent) {
    if (linkedTaskNoteId) {
      const openInAdjacentPanel = event ? isCmdClickModifier({ event }) : false;
      // Find the panel ID by looking up the DOM for the data-panel-id attribute
      const target = event?.target as HTMLElement | null;
      const panelElement = target?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

      // Stop propagation when opening in adjacent panel to prevent the source panel
      // from being re-focused by the Panel's onclick handler
      if (openInAdjacentPanel && event) {
        event.stopPropagation();
      }

      await navigateToNote(linkedTaskNoteId, {
        workspaceId: (linkedTaskNote?.workspaceId as string | undefined) ?? workspaceId,
        openInAdjacentPanel,
        openInNewAdjacentPanel: openInAdjacentPanel,
        sourcePanelId,
      });
    }
  }

  function getTaskText(): string {
    const parts: string[] = [];
    function serializeTextNode(textNode: any): string {
      if (textNode.marks) {
        for (const mark of textNode.marks) {
          if (mark.type.name === 'mention') {
            try {
              return toPromptToken({
                type: mark.attrs?.type,
                id: mark.attrs?.id,
                label: mark.attrs?.label,
                meta: mark.attrs?.meta,
              });
            } catch {
              return mark.attrs?.label || textNode.text || '';
            }
          }
        }
      }
      return textNode.text || '';
    }
    function processNode(n: any): string {
      if (n.isText) return serializeTextNode(n);
      const typeName = n.type?.name;
      if (typeName === 'hardBreak') return '\n';
      if (typeName === 'mention') {
        try {
          return toPromptToken({
            type: n.attrs?.type,
            id: n.attrs?.id,
            label: n.attrs?.label,
            meta: n.attrs?.meta,
          });
        } catch {
          return n.attrs?.label || '';
        }
      }
      if (typeName === 'bulletList') {
        const items: string[] = [];
        n.content?.forEach((child: any) => {
          const itemText = processNode(child);
          if (itemText) items.push('- ' + itemText);
        });
        return items.join('\n');
      }
      if (typeName === 'orderedList') {
        const items: string[] = [];
        let index = 1;
        n.content?.forEach((child: any) => {
          const itemText = processNode(child);
          if (itemText) {
            items.push(`${index}. ` + itemText);
            index++;
          }
        });
        return items.join('\n');
      }
      if (typeName === 'listItem') {
        const innerParts: string[] = [];
        n.content?.forEach((child: any) => {
          const text = processNode(child);
          if (text) innerParts.push(text);
        });
        return innerParts.join('\n');
      }
      if (n.content && n.content.size > 0) {
        const childTexts: string[] = [];
        n.content.forEach((child: any) => {
          const childText = processNode(child);
          if (childText) childTexts.push(childText);
        });
        return childTexts.join('');
      }
      return '';
    }
    node.content.forEach((child: any) => {
      const text = processNode(child);
      if (text) parts.push(text);
    });
    const richText = parts.join('\n').trim();
    const plainText = node.textContent?.trim() || '';
    if (richText.length < 20 && plainText.length > richText.length * 2) return plainText;
    return richText || plainText || '';
  }

  function emitLinkedTaskDelegateEvent() {
    if (!linkedTaskNoteId) return;
    // Prefer the linked note's own workspaceId (it may differ from the route
    // workspace if the task lives in a different workspace), then use the
    // immutable route context.
    const wsId = (linkedTaskNote?.workspaceId as string | undefined) ?? workspaceId;
    if (!wsId) return;
    // TODO(redux-remove): delegation creates an agent and assigns it atomically, which
    // the tasks seam (`task.assignAgent` assigns an EXISTING agent only) cannot express.
    // Stays on the agents-domain saga-trigger pending an AppClient agent-create+assign
    // capability; out of scope for the tasks Part C write-path migration.
    appStore.dispatch(
      delegateExistingTaskRequested(wsId, linkedTaskNoteId, linkedTaskTitle, false),
    );
  }

  function convertToInlineTask() {
    if (!editor || !linkedTaskNotFound) return;
    const pos = getPos();
    if (typeof pos !== 'number') return;

    let linkText = '';
    node.content.forEach((child: any) => {
      if (child.content) {
        child.content.forEach((grandchild: any) => {
          if (grandchild.isText && grandchild.marks) {
            for (const mark of grandchild.marks) {
              if (mark.type.name === 'link' && mark.attrs?.href?.match(TASK_LINK_REGEX)) {
                linkText = grandchild.text || '';
              }
            }
          }
        });
      }
    });
    if (!linkText) return;

    const tr = editor.state.tr;
    const schema = editor.schema;
    const paragraph = schema.nodes.paragraph.create({}, schema.text(linkText));
    const newTaskItem = schema.nodes.taskItem.create({ checked: false, status: 'todo' }, paragraph);
    tr.replaceWith(pos, pos + node.nodeSize, newTaskItem);
    editor.view.dispatch(tr);
  }

  async function convertToTaskNote() {
    if (!editor || isLinkedTask) return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const taskText = getTaskText();
    if (!taskText) return;

    const wsId = workspaceId;
    if (!wsId) return;
    const reduxState = appStore.state;
    const currentNoteId = selectSelectedNoteId.select(reduxState, wsId);
    if (!currentNoteId) return;
    const currentNote = selectNoteById.select(reduxState, wsId, currentNoteId);
    if (!currentNote) return;

    try {
      // Route through the tasks write-service (AppClient→intentd
      // `task.createPrerequisite`), which surfaces the new task note's id so we
      // can build the inline link. Store convergence is handled by the live
      // task/note subscribe→refetch loop (no `reloadNotes` saga-trigger needed).
      const newNoteId = await createPrerequisiteTask(currentNoteId, taskText.slice(0, 100), {
        content: taskText.length > 100 ? taskText : '',
        status: 'not_started',
      });
      if (!newNoteId) return;

      const schema = editor.schema;
      const linkMark = schema.marks.link.create({ href: taskNoteUrl(newNoteId) });
      const textNode = schema.text(taskText.slice(0, 100), [linkMark]);
      const paragraph = schema.nodes.paragraph.create({}, textNode);
      const newTaskItem = schema.nodes.taskItem.create(
        { checked: false, status: 'todo' },
        paragraph,
      );

      const tr = editor.state.tr;
      tr.replaceWith(pos, pos + node.nodeSize, newTaskItem);
      editor.view.dispatch(tr);
    } catch (error) {
      logger.error('Failed to convert checkbox to Task Note', error);
    }
  }
</script>

<NodeViewWrapper
  as="li"
  class="list-none my-0! ml-0! flex group {effectiveChecked ? 'task-checked' : ''} {selected
    ? 'bg-primary/10 rounded'
    : ''}"
  data-type="taskItem"
  data-checked={effectiveChecked || undefined}
  data-status={effectiveStatus}
  data-delegated-agent-id={delegatedAgentId || undefined}
  data-linked-task-note-id={linkedTaskNoteId || undefined}
>
  {#if isCardLayout}
    <!-- Compact row for linked tasks or tasks with agents -->
    {#if isOptimistic}
      <div
        data-task-item-row
        data-density="compact"
        class="my-0.5 flex h-8 w-full min-w-0 items-center gap-1.5 overflow-hidden bg-transparent text-left transition-colors"
        role="group"
        contenteditable="false"
      >
        <span
          data-task-row-leading
          class="flex shrink-0 items-center"
          onclick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {#key status}
            <TaskStatusIcon
              status={displayStatus as TaskStatus}
              size={16}
              onclick={handleCheckboxClick}
            />
          {/key}
        </span>
        <span
          data-task-row-content
          data-task-row-title
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium [&_p]:m-0"
        >
          <NodeViewContent />
        </span>
        {#if effectiveAgentId}
          <div data-task-row-trailing class="ml-auto flex shrink-0 items-center">
            <TaskAgentStatus agentId={effectiveAgentId} {workspaceId} compact indicator />
          </div>
        {/if}
      </div>
    {:else}
      <div
        data-task-item-row
        data-density="compact"
        class="group/task my-0.5 flex h-8 w-full min-w-0 items-center gap-1.5 overflow-hidden bg-transparent text-left transition-colors"
        contenteditable="false"
      >
        <span
          data-task-row-leading
          class="flex shrink-0 items-center"
          onclick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {#key linkedTaskStatus}
            <TaskStatusIcon
              status={displayStatus as TaskStatus}
              size={16}
              onclick={linkedTaskNotFound ? undefined : handleCheckboxClick}
            />
          {/key}
        </span>
        <button
          type="button"
          data-testid="linked-task-title"
          data-task-row-content
          data-task-row-title
          class="min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {linkedTaskNotFound
            ? 'text-muted-foreground italic'
            : ''}"
          onclick={(e) => handleOpenLinkedNote(e)}
          onkeydown={(event) => {
            if (event.key === 'Enter' && isCmdClickModifier({ event })) {
              event.preventDefault();
              void handleOpenLinkedNote(event);
            }
          }}
        >
          {linkedTaskTitle}
        </button>
        <div data-task-row-trailing class="ml-auto flex shrink-0 items-center gap-1.5">
          {#if unmetDependsOn.length > 0 && !effectiveChecked}
            <Tooltip
              side="bottom"
              align="end"
              delayDuration={300}
              disableHoverableContent={false}
              class="shrink-0"
              contentClass="p-1.5"
            >
              {#snippet content()}
                <div class="flex flex-col items-stretch gap-1 min-w-0">
                  <div class="px-0.5 text-xs text-muted-foreground">
                    {m.tiptap_taskItem_waitsOnList_label()}
                  </div>
                  {#each unmetDependsOn as depId (depId)}
                    <TaskRelationLink {workspaceId} noteId={depId} unmet />
                  {/each}
                </div>
              {/snippet}
              <span
                data-task-row-waits-on
                class="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-subtle"
                contenteditable="false"
              >
                <Fa icon={faHourglass} size="xs" />
                {m.tiptap_taskItem_waitsOn_label({ count: unmetDependsOn.length })}
              </span>
            </Tooltip>
          {/if}
          {#if linkedTaskConflictsWith.length > 0 && !effectiveChecked}
            <Tooltip
              side="bottom"
              align="end"
              delayDuration={300}
              disableHoverableContent={false}
              class="shrink-0"
              contentClass="p-1.5"
            >
              {#snippet content()}
                <div class="flex flex-col items-stretch gap-1 min-w-0">
                  <div class="px-0.5 text-xs text-muted-foreground">
                    {m.tiptap_taskItem_conflictsList_label()}
                  </div>
                  {#each linkedTaskConflictsWith as conflictId (conflictId)}
                    <TaskRelationLink {workspaceId} noteId={conflictId} variant="conflict" />
                  {/each}
                </div>
              {/snippet}
              <span
                data-task-row-conflict
                class="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning"
                contenteditable="false"
              >
                <Fa icon={faTriangleExclamation} size="xs" />
                {m.tiptap_taskItem_conflicts_label({ count: linkedTaskConflictsWith.length })}
              </span>
            </Tooltip>
          {/if}
          {#if linkedTaskNotFound}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="shrink-0"
              title={m.tiptap_taskItem_convertToInline_tooltip()}
              onclick={(e) => {
                e.stopPropagation();
                convertToInlineTask();
              }}
            >
              <Fa icon={faLinkSlash} class="text-warning" />
            </Button>
          {/if}
          {#if !effectiveAgentId && !effectiveChecked}
            <Button
              variant="ghost-light"
              size="icon-xs"
              data-task-row-assign
              class="shrink-0 opacity-30 transition-opacity group-focus-within/task:opacity-100 group-hover/task:opacity-100"
              title={m.tiptap_taskItem_assignToAgent_tooltip()}
              onclick={(e) => {
                e.stopPropagation();
                emitLinkedTaskDelegateEvent();
              }}
            >
              <Fa icon={faPlay} />
            </Button>
          {/if}
          {#if effectiveAgentId}
            <TaskAgentStatus agentId={effectiveAgentId} {workspaceId} compact indicator />
          {/if}
        </div>
      </div>
      <span class="sr-only"><NodeViewContent /></span>
    {/if}
  {:else}
    <!-- Simple checkbox layout -->
    <div class="min-w-0 w-full flex items-start gap-1.5 py-1 pl-1">
      <span class="shrink-0 flex mt-1" contenteditable="false">
        <!-- <input type="checkbox" {checked} onclick={handleNormalCheckboxClick} /> -->
        <Checkbox {checked} onCheckedChange={handleNormalCheckboxClick} />
      </span>
      <div class="flex-1 min-w-0">
        <NodeViewContent />
      </div>
      <div class="flex gap-1 shrink-0 -my-1" contenteditable="false">
        {#if !effectiveChecked}
          <Tooltip content={m.tiptap_taskItem_convertToTaskNote_tooltip()} side="top">
            <Button
              variant="ghost-light"
              size="icon-xs"
              aria-label={m.tiptap_taskItem_convertToTaskNote_tooltip()}
              class="opacity-20 hover:opacity-100 transition-opacity"
              onclick={(e) => {
                e.stopPropagation();
                convertToTaskNote();
              }}
            >
              <Fa icon={faListCheck} />
            </Button>
          </Tooltip>
        {/if}
      </div>
    </div>
  {/if}
</NodeViewWrapper>
