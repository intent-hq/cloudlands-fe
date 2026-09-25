<script lang="ts">
  /**
   * Header avatar stack of the other people currently viewing this note, fed
   * by the shared note-presence session (the daemon's viewer roster). Renders
   * nothing while the viewer is alone.
   */
  import { joinNotePresence, type RemoteNoteViewer } from './note-presence-service';
  import * as Menu from '$lib/components/ui/menu';
  import { faUser } from '@fortawesome/free-solid-svg-icons';
  import NotePresenceAvatars from './NotePresenceAvatars.svelte';

  interface Props {
    workspaceId: string;
    noteId: string;
    maxVisible?: number;
    embedded?: boolean;
  }

  let { workspaceId, noteId, maxVisible = 3, embedded = false }: Props = $props();

  let viewers = $state<RemoteNoteViewer[]>([]);

  $effect(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous lease on the transient presence stream (ephemeral UI state, not Redux domain data)
    const session = joinNotePresence(workspaceId, noteId);
    viewers = session.getViewers();
    const off = session.subscribe((next) => {
      viewers = next;
    });
    return () => {
      off();
      session.release();
      viewers = [];
    };
  });
</script>

{#if embedded}
  {#each viewers as viewer (viewer.principalId)}
    <Menu.CommandItem
      icon={faUser}
      label={viewer.displayName ?? viewer.login ?? viewer.principalId}
      disabled
    />
  {/each}
{:else}
  <NotePresenceAvatars {viewers} {maxVisible} />
{/if}
