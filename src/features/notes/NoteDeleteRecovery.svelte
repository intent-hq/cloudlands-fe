<script lang="ts">
  import { writable } from 'svelte/store';
  import { store } from '$store/renderer/store';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { noteDeleteDraftKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
  import {
    selectNoteDeleteRecoveryDrafts,
    noteDeleteRecoveryOwner,
    exportNoteDeleteRecovery,
    discardNoteDeleteRecovery,
  } from './note-delete-ui';

  let { workspaceId, noteId }: { workspaceId: string; noteId?: string } = $props();
  const generation = store.createSelector((state) => state.daemonHealth.connectionGeneration)();
  const workspaceIdStore = writable(workspaceId);
  const noteIdStore = writable<string | undefined>(noteId);
  const drafts = selectNoteDeleteRecoveryDrafts(workspaceIdStore, noteIdStore);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    noteIdStore.set(noteId);
  });
  let failed = $state(false);
</script>

{#if $drafts.length}
  <section aria-label={m.notes_delete_recovery_label()} class="mb-2 space-y-2 text-xs">
    <p class="font-medium">{m.notes_delete_recovery_label()}</p>
    {#each $drafts as draft (noteDeleteDraftKey(draft))}
      {@const owner = noteDeleteRecoveryOwner(draft)}
      <div class="space-y-1 rounded border p-2">
        <p class="break-words">{draft.noteId}</p>
        <p class="text-muted-foreground">
          {draft.backendGeneration === $generation
            ? m.notes_delete_recoveryCurrent_label()
            : m.notes_delete_recoveryEarlier_label()}
        </p>
        <div class="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            onclick={() => {
              failed = false;
              try {
                exportNoteDeleteRecovery(owner);
              } catch {
                failed = true;
              }
            }}>{m.notes_delete_recoveryExport_label()}</Button
          >
          <Button size="sm" variant="ghost" onclick={() => discardNoteDeleteRecovery(owner)}
            >{m.notes_delete_recoveryDiscard_label()}</Button
          >
        </div>
      </div>
    {/each}
    {#if failed}<p role="alert">{m.layout_fileTab_downloadFailed_error()}</p>{/if}
  </section>
{/if}
