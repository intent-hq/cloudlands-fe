<script lang="ts">
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { ToastCloseButton } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import {
    canUndoNoteDelete,
    checkNoteDeleteFromUi,
    selectNoteDeletion,
    selectNoteDeletionPaused,
    matchesNoteDeleteTarget,
    undoNoteDeleteFromUi,
    type NoteDeleteUiTarget,
  } from './note-delete-ui';

  let {
    target,
    title,
    onClose,
  }: { target: NoteDeleteUiTarget; title?: string; onClose?: () => void } = $props();
  const workspaceIdStore = writable(target.workspaceId);
  const noteIdStore = writable(target.noteId);
  const selected = selectNoteDeletion(workspaceIdStore, noteIdStore);
  const workspacePaused = selectNoteDeletionPaused(workspaceIdStore);
  $effect(() => {
    workspaceIdStore.set(target.workspaceId);
    noteIdStore.set(target.noteId);
  });
  const view = $derived(matchesNoteDeleteTarget($selected, target) ? $selected : undefined);
  let now = $state(performance.now());
  let busy = $state(false);
  let failed = $state(false);
  const paused = $derived(
    !!view && ($workspacePaused || view.failureCode === 'registration-limit'),
  );
  const undoAvailable = $derived(!paused && canUndoNoteDelete(view, now));
  $effect(() => {
    const deadline = view?.deadline;
    const observedNow = performance.now();
    now = observedNow;
    if (deadline === undefined || deadline <= observedNow) return;
    const timeout = setTimeout(
      () => {
        now = performance.now();
      },
      Math.ceil(deadline - observedNow),
    );
    return () => clearTimeout(timeout);
  });
  const message = $derived.by(() => {
    if (!view) return m.notes_delete_changed_label();
    if (paused) return m.notes_delete_registrationPaused_label();
    if (view.failureCode === 'replaced') return m.notes_delete_replaced_label();
    if (view.phase === 'preparing') return m.notes_delete_preparing_label();
    if (view.phase === 'cancelled')
      return view.held || view.hidden
        ? m.notes_delete_uncertain_label()
        : m.notes_delete_cancelled_label();
    if (view.phase === 'deleted') return m.notes_delete_deleted_label();
    if (view.phase === 'failed')
      return view.failureCode === 'unavailable'
        ? m.notes_delete_unavailable_label()
        : m.notes_delete_failed_label();
    if (view.phase === 'pending')
      return view.deadline !== undefined && now >= view.deadline
        ? m.notes_delete_expired_label()
        : m.notes_delete_pending_label();
    return m.notes_delete_uncertain_label();
  });
  async function act(undo: boolean) {
    if (busy || (undo && paused)) return;
    busy = true;
    failed = false;
    try {
      if (undo) await undoNoteDeleteFromUi(target);
      else await checkNoteDeleteFromUi(target);
    } catch {
      failed = true;
    } finally {
      busy = false;
      now = performance.now();
    }
  }
</script>

<section class="flex min-w-0 items-start gap-2 p-2" aria-label={m.notes_delete_status_ariaLabel()}>
  <div class="min-w-0 flex-1">
    {#if title}<p class="truncate font-medium">{title}</p>{/if}
    <p role="status" class="text-sm text-muted-foreground">{message}</p>
    {#if failed}<p role="alert" class="text-sm">{m.notes_delete_checkFailed_error()}</p>{/if}
    {#if view && (paused || (view.phase !== 'preparing' && (view.phase !== 'cancelled' || view.held || view.hidden) && (view.phase !== 'deleted' || view.error)))}
      <div class="flex flex-wrap gap-2 pt-2">
        {#if undoAvailable}
          <Button size="sm" variant="outline" disabled={busy} onclick={() => void act(true)}
            >{m.ui_workspaceActions_undo_label()}</Button
          >
        {/if}
        <Button size="sm" variant="ghost" disabled={busy} onclick={() => void act(false)}
          >{m.notes_delete_check_label()}</Button
        >
      </div>
    {/if}
  </div>
  {#if onClose}<ToastCloseButton
      inline
      onclick={onClose}
      ariaLabel={m.ui_toast_close_ariaLabel()}
    />{/if}
</section>
