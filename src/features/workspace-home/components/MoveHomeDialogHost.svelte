<script lang="ts">
  /**
   * Store host for the Move home dialog. Each workspace surface mounts one,
   * outside its retired, loading and onboarding branches, and it opens only
   * for its own workspace, so retained surfaces never open duplicates. While
   * closed it subscribes to the dialog's workspace id only.
   */
  import MoveHomeDialogConnected from './MoveHomeDialogConnected.svelte';
  import { selectMoveHomeDialogWorkspaceId } from '../workspace-home-selectors';

  let { workspaceId }: { workspaceId: string } = $props();

  const dialogWorkspaceId$ = selectMoveHomeDialogWorkspaceId();
</script>

{#if workspaceId && $dialogWorkspaceId$ === workspaceId}
  <MoveHomeDialogConnected {workspaceId} />
{/if}
