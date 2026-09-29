<script lang="ts">
  /**
   * Header avatar stack of the other people currently viewing this note, fed
   * by the owning tab's presence session (the daemon's viewer roster). Renders
   * nothing while the viewer is alone.
   */
  import type { RemoteNoteViewer } from './note-presence-service';
  import * as Menu from '$lib/components/ui/menu';
  import { faUser } from '@fortawesome/free-solid-svg-icons';
  import NotePresenceAvatars from './NotePresenceAvatars.svelte';

  interface Props {
    viewers: RemoteNoteViewer[];
    maxVisible?: number;
    embedded?: boolean;
  }

  let { viewers, maxVisible = 3, embedded = false }: Props = $props();
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
