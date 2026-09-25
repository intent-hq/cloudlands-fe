<script lang="ts">
  import type { TaskStatus } from '$shared/types';
  import type { WorkspaceId, NoteId } from '$shared/types/branded-ids';
  import { Select } from '$lib/components/ui/select';
  import TaskStatusIcon from '../tiptap/TaskStatusIcon.svelte';

  import { updateTaskNoteStatus } from '$features/tasks/tasks-write-service';
  import { notify } from '$lib/components/patterns/notify';
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

  let menuOpen = $state(false);
  let pending = $state(false);

  const statusOptions: TaskStatus[] = [
    'not_started',
    'waiting',
    'discussion_needed',
    'blocked',
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
    get blocked() {
      return m.workspace_taskStatus_blocked_label();
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
    discussion_needed: 'bg-warning/10 text-warning-ink',
    blocked: 'bg-red-500/10 text-red-600',
    in_progress: 'bg-sky-400/10 text-sky-600',
    review_required: 'bg-blue-500/10 text-blue-600',
    complete: 'bg-emerald-500/10 text-emerald-700/70',
    cancelled: 'bg-gray-600/10 text-gray-500',
  };

  // Check if this is an interactive dropdown or readonly badge
  let isInteractive = $derived(!readonly && !!workspaceId && !!noteId);

  async function handleStatusSelect(value: string) {
    menuOpen = false;
    const newStatus = statusOptions.find((option) => option === value);
    if (!newStatus || newStatus === status || pending || !workspaceId || !noteId) return;
    pending = true;
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- sanctioned mutation seam owns optimistic updates, rollback and failure notification.
      await updateTaskNoteStatus(workspaceId, noteId, newStatus);
    } catch {
      notify.error(m.notes_writeService_updateFailed_error());
    } finally {
      pending = false;
    }
  }
</script>

{#if isInteractive}
  <Select.Root value={status} bind:open={menuOpen} disabled={pending} onchange={handleStatusSelect}>
    <Select.Trigger
      variant="ghost"
      aria-label={m.workspace_taskStatus_change_ariaLabel()}
      aria-busy={pending}
      class="inline-flex items-center cursor-pointer {compact ? 'py-0.5 gap-1.5' : 'py-1 gap-2'}"
    >
      <TaskStatusIcon {status} size={12} />
      {statusLabels[status]}
    </Select.Trigger>
    <Select.Content portal class="min-w-48">
      {#each statusOptions as option (option)}
        <Select.Item value={option} label={statusLabels[option]}>
          <span class="flex items-center gap-2">
            <TaskStatusIcon status={option} size={12} />
            {statusLabels[option]}
          </span>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
  <span role="status" class="sr-only">{pending ? m.workspace_taskStatus_updating_label() : ''}</span
  >
{:else}
  <span
    class="inline-flex items-center rounded-md font-semibold {compact
      ? 'px-2 py-0.5 text-[0.66rem] '
      : 'px-2 py-1 text-sm '} {statusColors[status]}"
  >
    {statusLabels[status]}
  </span>
{/if}
