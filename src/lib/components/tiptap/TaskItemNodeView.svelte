<!--
  TaskItemNodeView - Svelte component for rendering task items in TipTap

  Supports two modes:
  1. Normal mode: Regular checkbox with 3-state toggle (todo → in-progress → done)
  2. Linked task mode: When content contains a intent://local/task/{noteId} link,
     displays the Task Note's title and status, with checkbox syncing to the Task Note.
-->
<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import {
  NodeViewWrapper,
  NodeViewContent,
} from '$lib/utils/tiptap/svelte-node-view';
  import TaskAgentStatus from './TaskAgentStatus.svelte';
  import TaskNotePreview from './TaskNotePreview.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToNote } from '$lib/utils/workspace-navigation';
  import Fa from 'svelte-fa';
  import {
  faPlay,
  faLinkSlash,
  faListCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { slide } from 'svelte/transition';
  import { taskNoteUrl } from '$shared/constants/intent-links';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import {
  selectSelectedNoteId,
  selectNoteById,
  selectNotesVersion,
} from '$lib/store/slices/workspace-notes/workspace-notes-selectors';

  import {
  reloadNotes,
  updateTaskStatus,
} from '$lib/store/slices/workspace-notes/workspace-notes-slice';
  import { delegateExistingTaskRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import { writable } from 'svelte/store';
  import { notesIpc } from '$lib/store/slices/workspace-notes/sagas/notes-ipc';
  import { NOTES_CHANNELS } from '$shared/ipc/channels';
  import type { NoteId, TaskStatus, Note, AgentSession } from '$shared/types';
  import {
  NoteId as NoteIdBrand,
  WorkspaceId,
} from '$shared/types/branded-ids';
  import TaskStatusIcon from './TaskStatusIcon.svelte';
  import { toPromptToken } from '$lib/services/mentions/format';
  import Checkbox from '../ui/checkbox/checkbox.svelte';
  import { store as appStore } from '$lib/store/store';

  const logger = createLogger('TaskItemNodeView');
  const TASK_LINK_REGEX = /^intent:\/\/local\/task\/(.+)$/;

  // Redux state access - called at component init time for reactive subscriptions
  const activeWorkspaceId = selectActiveWorkspaceId();
  const wsIdStore = writable<string>('');
  $effect(() => {
    wsIdStore.set($activeWorkspaceId ?? '');
  });
  const notesVersion = selectNotesVersion(wsIdStore);

  let { node, selected, updateAttributes, getPos, editor }: NodeViewProps = $props();

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

  let linkedTaskNote = $derived.by(() => {
    if (!linkedTaskNoteId) return null;
    // Access notesVersion to trigger reactivity when notes map changes
    void $notesVersion;
    const wsId = $activeWorkspaceId;
    if (!wsId) return null;
    const state = appStore.state;
    return selectNoteById.select(state, wsId, linkedTaskNoteId) ?? null;
  });

  let linkedTaskTitle = $derived(
    linkedTaskNote?.title ?? `Task not found: ${linkedTaskNoteId ?? 'unknown'}`,
  );
  let linkedTaskStatus = $derived(linkedTaskNote?.metadata?.task?.status ?? null);
  let linkedTaskNotFound = $derived(isLinkedTask && !linkedTaskNote);
  let linkedTaskChecked = $derived(linkedTaskStatus === 'complete');

  let linkedTaskAgentId = $derived.by(() => {
    const agentIds = linkedTaskNote?.metadata?.task?.assignedAgentIds;
    if (!agentIds || agentIds.length === 0) return null;
    return agentIds[agentIds.length - 1];
  });

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
      const workspaceId = linkedTaskNote?.workspaceId;
      if (!workspaceId) return;
      appStore.dispatch(updateTaskStatus(workspaceId, linkedTaskNoteId, newStatus));
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

  async function handleOpenLinkedNote(event?: MouseEvent) {
    if (linkedTaskNoteId) {
      const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
      // Find the panel ID by looking up the DOM for the data-panel-id attribute
      const target = event?.target as HTMLElement | null;
      const panelElement = target?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

      // Stop propagation when opening in adjacent panel to prevent the source panel
      // from being re-focused by the Panel's onclick handler
      if (openInAdjacentPanel && event) {
        event.stopPropagation();
      }

      await navigateToNote(linkedTaskNoteId, { openInAdjacentPanel, sourcePanelId });
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
    // Prefer the linked note's own workspaceId (it may differ from the active workspace
    // if the task lives in a different workspace), fall back to the active workspace.
    const wsId = (linkedTaskNote?.workspaceId as string | undefined) ?? $activeWorkspaceId;
    if (!wsId) return;
    appStore.dispatch(delegateExistingTaskRequested(wsId, linkedTaskNoteId, linkedTaskTitle, false));
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

    const wsId = $activeWorkspaceId;
    if (!wsId) return;
    const reduxState = appStore.state;
    const currentNoteId = selectSelectedNoteId.select(reduxState, wsId);
    if (!currentNoteId) return;
    const currentNote = selectNoteById.select(reduxState, wsId, currentNoteId);
    if (!currentNote) return;

    try {
      const result = await notesIpc<{ note: Note; agent?: AgentSession }>(
        NOTES_CHANNELS.CREATE_PREREQUISITE_NOTE,
        {
          workspaceId: WorkspaceId(currentNote.workspaceId),
          dependentNoteId: NoteIdBrand(currentNoteId),
          options: {
            title: taskText.slice(0, 100),
            content: taskText.length > 100 ? taskText : '',
            taskStatus: 'not_started',
          },
        },
      );
      if (!result.ok) return;

      const newNoteId = result.data.note.id;
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
      appStore.dispatch(reloadNotes(currentNote.workspaceId));
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
    <!-- Card layout for linked tasks or tasks with agents -->
    {#if isOptimistic}
      <!-- Non-clickable card for optimistic tasks -->
      <div
        class="my-0.5 flex flex-col w-full min-w-0 bg-transparent border border-border rounded-xs shadow-xs text-left transition-colors cursor-default {selected
          ? 'border-primary'
          : ''}"
        role="group"
        contenteditable="false"
      >
        <div class="flex items-center gap-1.5 w-full pl-2.5 pr-2 pt-1.5 pb-1.5">
          <span class="shrink-0" onclick={(e) => e.stopPropagation()} role="presentation">
            {#key status}
              <TaskStatusIcon
                status={displayStatus as TaskStatus}
                size={16}
                onclick={handleCheckboxClick}
              />
            {/key}
          </span>
          <span
            class="flex-1 min-w-0 pb-0.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap [&_p]:m-0"
          >
            <NodeViewContent />
          </span>
        </div>
        {#if effectiveAgentId}
          <div
            class="flex items-center pt-1 pl-8 w-full bg-muted/20 hover:bg-muted/50 rounded-b-md py-1"
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            <TaskAgentStatus agentId={effectiveAgentId} compact />
          </div>
        {/if}
      </div>
    {:else}
      <!-- Clickable card for linked tasks with hover preview -->
      <Tooltip
        side="bottom"
        align="start"
        sideOffset={2}
        delayDuration={400}
        class=" my-0.5 min-w-0 w-full"
        contentClass="p-0 bg-transparent border-0 shadow-none"
      >
        {#snippet content()}
          {#if linkedTaskNoteId && !linkedTaskNotFound}
            <TaskNotePreview noteId={linkedTaskNoteId} />
          {/if}
        {/snippet}
        <button
          type="button"
          class="flex flex-col w-full min-w-0 bg-transparent border border-border rounded-xs shadow-xs text-left transition-colors cursor-pointer {selected
            ? 'border-primary'
            : ''}"
          onclick={(e) => handleOpenLinkedNote(e)}
          contenteditable="false"
        >
          <div class="flex items-center gap-2 w-full pl-2.5 pr-2 pt-2">
            <span class="shrink-0" onclick={(e) => e.stopPropagation()} role="presentation">
              {#key linkedTaskStatus}
                <TaskStatusIcon
                  status={displayStatus as TaskStatus}
                  size={16}
                  onclick={linkedTaskNotFound ? undefined : handleCheckboxClick}
                />
              {/key}
            </span>
            <span
              class="flex-1 min-w-0 pb-1.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap {linkedTaskNotFound
                ? 'text-muted-foreground italic'
                : ''}"
            >
              {linkedTaskTitle}
            </span>
            {#if linkedTaskNotFound}
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="shrink-0"
                title="Convert to inline task"
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
                class="shrink-0 opacity-30 hover:opacity-100 transition-opacity pb-2"
                title="Assign to agent"
                onclick={(e) => {
                  e.stopPropagation();
                  emitLinkedTaskDelegateEvent();
                }}
              >
                <Fa icon={faPlay} />
              </Button>
            {/if}
          </div>
          {#if effectiveAgentId}
            <div
              class="flex items-center pt-1 pl-9 w-full bg-muted/20 hover:bg-muted/50 rounded-b-md py-1"
              transition:slide={{ axis: 'y', duration: 200 }}
            >
              <TaskAgentStatus agentId={effectiveAgentId} compact />
            </div>
          {/if}
        </button>
      </Tooltip>
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
          <Tooltip content="Convert to Task Note" side="top">
            <Button
              variant="ghost-light"
              size="icon-xs"
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
