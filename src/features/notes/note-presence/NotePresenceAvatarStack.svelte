<script lang="ts">
  /**
   * Header avatar stack of the other people currently viewing this note, fed
   * by the shared note-presence session (the daemon's viewer roster). Renders
   * nothing while the viewer is alone.
   */
  import { joinNotePresence, type RemoteNoteViewer } from './note-presence-service';
  import NotePresenceAvatars from './NotePresenceAvatars.svelte';

  interface Props {
    workspaceId: string;
    noteId: string;
    maxVisible?: number;
  }

  let { workspaceId, noteId, maxVisible = 3 }: Props = $props();

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

<NotePresenceAvatars {viewers} {maxVisible} />
