<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import { NodeViewWrapper, NodeViewContent } from '$lib/utils/tiptap/svelte-node-view';
  import Fa from 'svelte-fa';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import type { NoteId } from '$shared/types';
  import { onMount } from 'svelte';
  import { TASK_HREF_REGEX_FLEXIBLE } from '$shared/constants/intent-links';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectNoteById, selectNotesVersion } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';

  // Props from SvelteNodeViewRenderer
  let { node, editor }: NodeViewProps = $props();

  // Derive heading level
  let level = $derived(node.attrs.level ?? 1);

  // Task count state - updated via editor subscription
  let sectionTasks = $state<{
    incomplete: number;
    tasks: Array<{ noteId: NoteId; title: string }>;
  }>({
    incomplete: 0,
    tasks: [],
  });

  /**
   * Find the position of this heading in the document
   */
  function findHeadingPosition(): number {
    if (!editor) return -1;
    const nodeText = node.textContent;
    let foundPos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.textContent === nodeText && n.attrs.level === level) {
        foundPos = pos;
        return false;
      }
      return true;
    });
    return foundPos;
  }

  /**
   * Calculate linked tasks in this section that reference incomplete Task Notes
   * Looks for checkboxes with intent://local/task/{noteId} links between this heading
   * and the next heading of same or higher level
   */
  function calculateSectionTasks(): {
    incomplete: number;
    tasks: Array<{ noteId: NoteId; title: string }>;
  } {
    if (!editor) return { incomplete: 0, tasks: [] };

    const headingPos = findHeadingPosition();
    if (headingPos === -1) return { incomplete: 0, tasks: [] };

    const tasks: Array<{ noteId: NoteId; title: string }> = [];
    let foundHeading = false;
    let passedSection = false;
    const headingLevel = level;

    editor.state.doc.descendants((n, p) => {
      if (passedSection) return false;

      if (n.type.name === 'heading') {
        if (p === headingPos) {
          foundHeading = true;
        } else if (foundHeading && n.attrs.level <= headingLevel) {
          passedSection = true;
          return false;
        }
      }

      // Look for task items with linked Task Notes
      if (foundHeading && !passedSection && n.type.name === 'taskItem') {
        // Check if this task item has a link to a Task Note
        let linkedNoteId: string | null = null;

        n.descendants((child) => {
          if (child.isText && child.marks) {
            for (const mark of child.marks) {
              if (mark.type.name === 'link' && mark.attrs?.href) {
                const match = mark.attrs.href.match(TASK_HREF_REGEX_FLEXIBLE);
                if (match) {
                  linkedNoteId = match[1];
                }
              }
            }
          }
        });

        // If it's a linked task, check if the Task Note is incomplete
        if (linkedNoteId) {
          const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) ?? '';
          const taskNote = selectNoteById.select(getReduxStore().getState(), wsId, linkedNoteId);
          if (taskNote?.metadata?.task) {
            const status = taskNote.metadata.task.status;
            if (status !== 'complete' && status !== 'cancelled') {
              tasks.push({ noteId: linkedNoteId as NoteId, title: taskNote.title });
            }
          }
        }
      }
      return true;
    });

    return { incomplete: tasks.length, tasks };
  }

  // Subscribe to editor updates with debouncing for performance
  onMount(() => {
    if (!editor) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleUpdate = () => {
      // Debounce: only recalculate after 100ms of no changes
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        sectionTasks = calculateSectionTasks();
      }, 100);
    };

    // Initial calculation
    sectionTasks = calculateSectionTasks();

    // Subscribe to editor updates
    editor.on('update', handleUpdate);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      editor.off('update', handleUpdate);
    };
  });

  // Also recalculate when notes version changes (Task Note status updates)
  const notesVersion$ = selectNotesVersion(selectActiveWorkspaceId.select(getReduxStore().getState()) ?? '');
  $effect(() => {
    // Access notesVersion to track changes (void to suppress unused warning)
    void $notesVersion$;
    // Recalculate when notes change
    sectionTasks = calculateSectionTasks();
  });

  function handleStartAllTasks() {
    // Dispatch custom event for parent to handle with Task Note IDs
    const event = new CustomEvent('start-section-tasks', {
      detail: {
        headingText: node.textContent,
        tasks: sectionTasks.tasks,
      },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }
</script>

<NodeViewWrapper as="h{level}" class="heading-node-view group relative">
  <NodeViewContent class="inline" />
  {#if sectionTasks.incomplete > 0}
    <span
      class="section-start-btn ml-auto group-hover:opacity-100 transition-opacity inline-flex items-center"
      contenteditable="false"
    >
      <Button
        variant="ghost-light"
        size="xs"
        class="px-1.5 gap-1"
        onclick={handleStartAllTasks}
        title="Start all {sectionTasks.incomplete} tasks in this section"
      >
        <Fa icon={faPlay} class="opacity-30" />
        <span>Start {sectionTasks.incomplete} task{sectionTasks.incomplete === 1 ? '' : 's'}</span>
      </Button>
    </span>
  {/if}
</NodeViewWrapper>

<style>
  :global(.heading-node-view) {
    display: flex;
    align-items: baseline;
  }

  .section-start-btn {
    vertical-align: middle;
  }
</style>
