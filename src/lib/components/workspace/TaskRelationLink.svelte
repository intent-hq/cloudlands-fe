<!--
  TaskRelationLink - Clickable chip linking to a related task note.

  Used by the task-note relations section (NoteMetadataBar) and by the
  task-row relation chip tooltips (TaskItemNodeView). Shows the related
  note's live status; `unmet` marks a dependency the daemon reports as not
  yet complete (PROTOCOL §5.4 unmetDependsOn) and `conflict` styles advisory
  conflict edges, both consistent with the existing task-row chip semantics.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faHourglassHalf, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import { navigateToNote, findSourcePanelId } from '$lib/utils/workspace-navigation';
  import type { NoteId } from '$shared/types';
  import {
    selectNoteById,
    selectNotesVersion,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';

  let {
    noteId,
    variant = 'dependency',
    unmet = false,
  }: {
    noteId: NoteId;
    variant?: 'dependency' | 'conflict';
    unmet?: boolean;
  } = $props();

  // Redux state access - called at component init time for reactive subscriptions
  const activeWorkspaceId = selectActiveWorkspaceId();
  const wsIdStore = writable<string>('');
  $effect(() => {
    wsIdStore.set($activeWorkspaceId ?? '');
  });
  const notesVersion$ = selectNotesVersion(wsIdStore);

  let relatedNote = $derived.by(() => {
    // Track notesVersion so title/status refresh when the related note changes.
    void $notesVersion$;
    const wsId = $activeWorkspaceId;
    if (!wsId) return null;
    return selectNoteById.select(appStore.state, wsId, noteId) ?? null;
  });

  let title = $derived(
    relatedNote?.title ?? m.workspace_taskRelationLink_notFound_label({ id: noteId }),
  );
  let status = $derived(relatedNote?.metadata?.task?.status ?? null);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    void navigateToNote(noteId, {
      openInAdjacentPanel: e.metaKey || e.ctrlKey,
      sourcePanelId: findSourcePanelId(e.target),
    });
  }
</script>

<button
  type="button"
  onclick={handleClick}
  class="inline-flex items-center gap-1.5 min-w-0 max-w-full rounded px-2 py-0.5 text-left cursor-pointer transition-colors {variant === 'conflict'
    ? 'bg-warning/10 text-warning hover:bg-warning/20'
    : unmet
      ? 'bg-muted text-subtle hover:bg-muted/80'
      : 'bg-muted/30 text-subtle hover:bg-muted/60'}"
>
  {#if variant === 'conflict'}
    <Fa icon={faTriangleExclamation} size="xs" class="shrink-0" />
  {:else}
    <!-- inert: TaskStatusIcon renders its own <button>; neutralize it so this
         chip's root button stays the only interactive/focusable control. -->
    <span class="contents" inert>
      {#key status}
        <TaskStatusIcon {status} size={14} />
      {/key}
    </span>
  {/if}
  <span class="truncate font-medium {relatedNote ? '' : 'italic'}">{title}</span>
  {#if variant === 'dependency' && unmet}
    <span
      class="shrink-0 inline-flex items-center"
      title={m.workspace_taskRelationLink_unmet_tooltip()}
    >
      <Fa icon={faHourglassHalf} size="xs" />
    </span>
  {/if}
</button>
