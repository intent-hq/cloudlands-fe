<script lang="ts">
  import type { Note, TaskStatus } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';

  interface Props {
    notes: Note[];
    onStickerClick?: (noteId: string) => void;
    onStickerHover?: (noteId: string | null) => void;
    hoveredNoteId?: string | null;
    hasUnreadChanges?: (noteId: string) => boolean;
  }

  let {
    notes = [],
    onStickerClick,
    onStickerHover,
    hoveredNoteId = null,
    hasUnreadChanges = () => false,
  }: Props = $props();

  // Build flat list of task notes (excluding spec and cancelled)
  function getTaskNotes(notesList: Note[]): Note[] {
    const seenIds = new Set<string>();

    return notesList.filter((n) => {
      if (!n.metadata?.task || isSpecNote(n.id as string) || n.metadata.task.status === 'cancelled')
        return false;
      if (!isSpecNote(n.parentId as string)) return false;
      const noteId = n.id as string;
      if (seenIds.has(noteId)) return false;
      seenIds.add(noteId);
      return true;
    });
  }

  // Generate consistent rotation for each note based on its id
  function getRotation(noteId: string): number {
    let hash = 0;
    for (let i = 0; i < noteId.length; i++) {
      hash = ((hash << 5) - hash + noteId.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 21) - 10; // Range: -10 to +10
  }

  function getStatusColor(status: TaskStatus): string {
    switch (status) {
      case 'complete':
        return 'bg-emerald-100 dark:bg-emerald-700';
      case 'in_progress':
        return 'bg-sky-100 dark:bg-sky-700';
      case 'review_required':
        return 'bg-blue-100 dark:bg-blue-700';
      case 'waiting':
        return 'bg-neutral-200 dark:bg-neutral-500';
      default:
        return 'bg-neutral-100 dark:bg-neutral-600';
    }
  }

  function getStatusAccent(status: TaskStatus): string {
    switch (status) {
      case 'complete':
        return 'bg-emerald-400 dark:bg-emerald-500';
      case 'in_progress':
        return 'bg-sky-400 dark:bg-sky-500';
      case 'review_required':
        return 'bg-blue-400 dark:bg-blue-500';
      default:
        return 'bg-neutral-400 dark:bg-neutral-500';
    }
  }

  const taskNotes = $derived(getTaskNotes(notes));

  // Track pressed state for animation
  let pressedNoteId: string | null = $state(null);

  function handleMouseDown(noteId: string) {
    pressedNoteId = noteId;
  }

  function handleMouseUp(noteId: string) {
    pressedNoteId = null;
    onStickerClick?.(noteId);
  }
</script>

{#if taskNotes.length > 0}
  <div class="flex items-center py-1">
    <div class="flex items-center -space-x-1.5">
      {#each taskNotes as note (note.id)}
        {@const noteId = note.id as string}
        {@const status = note.metadata?.task?.status ?? 'not_started'}
        {@const rotation = getRotation(noteId)}
        {@const isFocused = noteId === hoveredNoteId}
        {@const isPressed = noteId === pressedNoteId}
        {@const isUnread = hasUnreadChanges(noteId)}

        <button
          type="button"
          class="relative w-5 h-6 border-2 border-background rounded-xs cursor-pointer
                 transition-all duration-150 ease-out
                 hover:z-10 focus:z-10 focus:outline-none
                 {getStatusColor(status)}"

          class:z-10={isFocused}
          style="
            transform: rotate({rotation}deg) scale({isPressed ? 0.85 : isFocused ? 1.15 : 1});
            anchor-name: --task-{noteId};
          "
          onmousedown={() => handleMouseDown(noteId)}
          onmouseup={() => handleMouseUp(noteId)}
          onmouseleave={() => {
            pressedNoteId = null;
            onStickerHover?.(null);
          }}
          onmouseenter={() => onStickerHover?.(noteId)}
          aria-label={note.title}
        >
          <!-- Document lines decoration -->
          <div class="absolute inset-x-1 top-1.5 flex flex-col gap-0.5">
            <div class="h-px w-full {getStatusAccent(status)} opacity-60"></div>
            <div class="h-px w-3/4 {getStatusAccent(status)} opacity-40"></div>
            <div class="h-px w-1/2 {getStatusAccent(status)} opacity-30"></div>
          </div>

          <!-- Corner fold effect -->
          <div
            class="absolute top-0 right-0 w-1.5 h-1.5 border-l border-b rounded-bl-xs
                   bg-background/80 {getStatusColor(status)}"
          ></div>

          <!-- Unread dot -->
          {#if isUnread}
            <span class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-primary rounded-full"></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
