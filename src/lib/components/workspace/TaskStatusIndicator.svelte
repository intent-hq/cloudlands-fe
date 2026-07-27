<script lang="ts">
  import { tick } from 'svelte';
  import type { TaskStatus } from '$shared/types';
  import type { WorkspaceId, NoteId } from '$shared/types/branded-ids';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import TaskStatusIcon from '../tiptap/TaskStatusIcon.svelte';

  import { updateTaskNoteStatus } from '$features/tasks/tasks-write-service';
  import { m } from '$shared/paraglide/messages.js';


  let {
    workspaceId,
    noteId,
    status,
    readonly = false,
    compact = false,
  }: {
    workspaceId?: WorkspaceId;
    noteId?: NoteId;
    status: TaskStatus;
    readonly?: boolean;
    compact?: boolean;
  } = $props();

  let selectedIndex = $state(0);
  let menuRef: HTMLDivElement | null = $state(null);

  const statusOptions: TaskStatus[] = [
    'not_started',
    'waiting',
    'discussion_needed',
    'in_progress',
    'review_required',
    'complete',
    'cancelled',
  ];

  const statusLabels: Record<TaskStatus, string> = {
    get not_started() {
      return m.workspace_taskStatus_notStarted_label();
    },
    get waiting() {
      return m.workspace_taskStatus_waiting_label();
    },
    get discussion_needed() {
      return m.workspace_taskStatus_discussionNeeded_label();
    },
    get in_progress() {
      return m.workspace_taskStatus_inProgress_label();
    },
    get review_required() {
      return m.workspace_taskStatus_reviewRequired_label();
    },
    get complete() {
      return m.workspace_taskStatus_complete_label();
    },
    get cancelled() {
      return m.workspace_taskStatus_cancelled_label();
    },
  };

  const statusColors: Record<TaskStatus, string> = {
    not_started: 'bg-gray-400/10 text-gray-400',
    waiting: 'bg-gray-300/10 text-gray-400',
    discussion_needed: 'bg-amber-500/10 text-amber-700/70',
    in_progress: 'bg-sky-400/10 text-sky-600',
    review_required: 'bg-blue-500/10 text-blue-600',
    complete: 'bg-emerald-500/10 text-emerald-700/70',
    cancelled: 'bg-gray-600/10 text-gray-500',
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const statusDotColors: Record<TaskStatus, string> = {
    not_started: 'bg-gray-400',
    waiting: 'bg-gray-300',
    discussion_needed: 'bg-amber-500',
    in_progress: 'bg-sky-400',
    review_required: 'bg-blue-500',
    complete: 'bg-emerald-500',
    cancelled: 'bg-gray-500',
  };

  // Check if this is an interactive dropdown or readonly badge
  let isInteractive = $derived(!readonly && !!workspaceId && !!noteId);

  function handleStatusSelect(newStatus: TaskStatus, close: () => void) {
    close();
    if (newStatus === status) return;
    if (!workspaceId || !noteId) return;

    // eslint-disable-next-line intent/no-component-async-data-fetch -- sanctioned post-saga tasks-write-service seam (dispatches optimistic store updates + AppClient mutation); not a component data fetch.
    void updateTaskNoteStatus(workspaceId, noteId, newStatus);
  }

  async function handleMenuOpen() {
    // Set initial selection to current status
    selectedIndex = statusOptions.indexOf(status);
    if (selectedIndex === -1) selectedIndex = 0;
    // Focus the menu after it renders
    await tick();
    menuRef?.focus();
  }

  function handleKeyDown(e: KeyboardEvent, close: () => void) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, statusOptions.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        handleStatusSelect(statusOptions[selectedIndex], close);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  }
</script>

{#if isInteractive}
  <DropdownMenu align="start" side="bottom">
    {#snippet trigger({ toggle, open }: { toggle: () => void; open: boolean })}
      <button
        onclick={() => {
          if (!open) handleMenuOpen();
          toggle();
        }}
        class="inline-flex font-mediumx text-subtlex items-center cursor-pointer {compact
          ? 'py-0.5 text-sm gap-1.5'
          : 'py-1 text-sm gap-2'}"
      >
            <TaskStatusIcon status={status} size={12} />
        {statusLabels[status]}
      </button>
    {/snippet}
    {#snippet content({ close }: { close: () => void })}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={menuRef}
        tabindex="0"
        onkeydown={(e) => handleKeyDown(e, close)}
        class="outline-none"
        role="listbox"
      >
        {#each statusOptions as option, i (option)}
          <button
            onclick={() => handleStatusSelect(option, close)}
            onmouseenter={() => (selectedIndex = i)}
            class="w-full text-left px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-2 cursor-pointer {i ===
            selectedIndex
              ? 'bg-muted/30'
              : ''} {option === status ? 'font-medium' : ''}"
            role="option"
            aria-selected={option === status}
          >
            <!-- <span class="size-2 rounded-full {statusDotColors[option]}"></span> -->
            <TaskStatusIcon status={option} size={12} />
            {statusLabels[option]}
          </button>
        {/each}
      </div>
    {/snippet}
  </DropdownMenu>
{:else}
  <span
    class="inline-flex items-center rounded-md font-semibold {compact
      ? 'px-2 py-0.5 text-[0.66rem] uppercase tracking-wide'
      : 'px-2 py-1 text-sm uppercase tracking-wide'} {statusColors[status]}"
  >
    {statusLabels[status]}
  </span>
{/if}
